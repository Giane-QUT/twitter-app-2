const express = require('express');
const redis = require('redis');
const axios = require('axios');
const natural = require('natural');
const router = express.Router();
const {promisify} = require('util');
const AWS = require('aws-sdk');
require('dotenv').config();

// Twitter setup
const twtCreds = require('../my-twitter-keys.json');
const twtBearer = twtCreds.bearer_token;

// Local REDIS setup
const client = redis.createClient();
client.on('error', (err) => {
  console.log("Error " + err);
});
// Promisify REDIS callback functions
const getRedis = promisify(client.get).bind(client);
const saveRedis = promisify(client.setex).bind(client);
function saveToRedis(query,data) {
  return saveRedis(`tweetFilter:${query}`, 300, JSON.stringify({...data}))
}

//AWS S3 Setup
AWS.config.getCredentials((err) => {
  if (err) {
    console.log(err.stack);
  }
  else {
    console.log("Credentials")
  }
})
const bucketName = 'n10532935-twitterbucket';
const s3 = new AWS.S3({apiVersion:'2006-03-01'});
function saveToS3(query,data) {
  return s3.putObject({Bucket:bucketName, Key:`tweetFilter-${query}`, Body:data}).promise();
}

// Use of Natural for sentiment analysis was found
// https://blog.logrocket.com/natural-language-processing-for-node-js/
const tokenizer = new natural.WordTokenizer();
const Analyzer = natural.SentimentAnalyzer;
const stemmer = natural.PorterStemmer;
const analyzer = new Analyzer("English", stemmer, "afinn")

/* GET home page. */
router.get('/', function(req, res) {
  if (req.query.tweetFilters) {
    try {
      const query = (req.query.tweetFilters).trim();
      // Start storage checks before calling twitter api
      getRedis(`tweetFilter:${query}`)
      .then((result) => {
        let foundS3 = false;
        if (result) {
          console.log("MATCHED IN REDIS" );
          const resultJSON = JSON.parse(result);
          const sourceResult = {source: "REDIS",data: resultJSON};
          //console.log(Object.keys(sourceResult));
          return sourceResult;
        }
        else {
          // Check bucket if no redis matches
          const params = {Bucket: bucketName, Key:`tweetFilter-${query}`}
          console.log("S3 BEING CHECKED");
          return(
            s3.getObject(params).promise()
            .then((result) =>{
              if (result) {
                const resultJSON = JSON.parse(result.Body);
                let sourceResult = {source: "S3",data:resultJSON};
                //console.log("results" + sourceResult)
                console.log("RESU;TS" + Object.keys(sourceResult));
                return sourceResult;
              }
            })
            .catch((err) => {
              console.error(err);
              if (err.statusCode === 404) {
                console.log("TWITTER API BEING CALLED");
                return (
                  axios.get(`https://api.twitter.com/1.1/search/tweets.json?q=${query}&lang=en&count=100&result_type=recent`,{headers: {Authorization: 'Bearer ' + twtBearer}})
                  .then((response) => {
                    if (response.status == 200) {
                      const sourceResult = {source: "TWITTER",...response.data};
                      return sourceResult;
                    }
                    else throw Error("Status code " + response.status + " was received.")
                  })
                  .catch((err) => {
                    console.error(err);
                  })
                )
              }
            }) // end then clause
          )
        } // end check s3 and api
      })
      .then((data) => {
        //console.log(Object.keys(data));
        //console.log(data);
        let tweets = null;
        let source = data.source;
        if (source === "REDIS") {
          //console.log("redus data" + Object.keys(data.data))
          tweets = []
          for(let [key,value] of Object.entries(data.data)) {
            //console.log(value);
            if (key !== "source") {
              tweets.push(value);
            }
          }
        } else if (source === "TWITTER") {
          //console.log("TW KEYS ARE" + Object.keys(data))
          tweets = data.statuses
          //console.log(tweets)
        } else {
          console.log("AMAZON USED")
          //console.log(Object.keys(data))
          //tweets = data;
          tweets = []

          for(let [key,value] of Object.entries(data.data)) {
            //console.log("KEY"+ key + "TWEET" + value);
            if (key !== "source") {
              tweets.push(value);
            }
          }
        }
        res.render('index', { title: 'Tweet Analyser', tweets_data: parseTweets(source,tweets), query: query});
        return tweets
      })
      .then((data) => {
        const params = {Bucket: bucketName, Key:`tweetFilter-${query}`}
        const body = JSON.stringify(data); //for s3
        saveToRedis(query,data)
        .then(() => {
          console.log("Saved to redis");
        })
        .catch((err) => {
          console.log("REDIS saving err")
        })
        saveToS3(query,body)
        .then(() => {
          console.log("Saved to s3");
        })
        .catch((err) => {
          console.log("S3 Saving err");
        })
      })
      .catch((err) => {
        console.error(err);
      })
    }
    catch {
      console.log("Error")
      res.render('error');
    }
  }
  else {
    res.render('index', { title: 'Tweet Analyser' })
  }
});

function parseTweets(source,tweet_data) {
  let tweets = [];
  if (source === "REDIS" || source === "S3") {
    for(let [key,value] of Object.entries(tweet_data)) {
      if (key !== "source") {
        //console.log(value);
        const theTweet = value;
        // Populate tweet obj to be added to tweet array
        tweet = {
          user: "",
          text: "",
          date: "",
          sentimentValCol: "",
          sentimentValPic: ""
        }
        tweet.user = theTweet.user.screen_name;
        tweet.text =  theTweet.text;
        tweet.date = theTweet.created_at;
        const sentimentVal = Math.round(analyzer.getSentiment(tokenizer.tokenize(theTweet.text)));
        if (sentimentVal === -1) {
          tweet.sentimentValCol = "#ff3300";
          tweet.sentimentValPic = 'negative_face';
        } else if (sentimentVal === 0){
          tweet.sentimentValCol = "#ffffff";
          tweet.sentimentValPic = 'neutral_face';
        } else {
          tweet.sentimentValCol = "#00ff99";
          tweet.sentimentValPic = 'positive_face';
        }
        tweets.push(tweet);
        }
    }
      
  } else {
    for (let theTweet of tweet_data) {
      // Populate tweet obj to be added to tweet array
      tweet = {
        user: "",
        text: "",
        date: "",
        sentimentValCol: "",
        sentimentValPic: ""
      }
      tweet.user = theTweet.user.screen_name;
      tweet.text =  theTweet.text;
      tweet.date = theTweet.created_at;
      const sentimentVal = Math.round(analyzer.getSentiment(tokenizer.tokenize(theTweet.text)));
      if (sentimentVal === -1) {
        tweet.sentimentValCol = "#ff3300";
        tweet.sentimentValPic = 'negative_face';
      } else if (sentimentVal === 0){
        tweet.sentimentValCol = "#ffffff";
        tweet.sentimentValPic = 'neutral_face';
      } else {
        tweet.sentimentValCol = "#00ff99";
        tweet.sentimentValPic = 'positive_face';
      }
      tweets.push(tweet);
      console.log(tweet);
      console.log("Username is<<: " + tweet.user.screen_name);
      console.log("Tweet is>>>> " + tweet.text + "\n");
      console.log("Sentiment is====");
      console.log(analyzer.getSentiment(tokenizer.tokenize(tweet.text)));
  }

  
  }
  return tweets;
}

module.exports = router;
