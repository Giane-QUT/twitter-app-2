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
  return saveRedis(`tweetFilter:${query}`, 300, JSON.stringify({source:'Redis Cache',...data}))
}

// AWS S3 Setup
AWS.config.getCredentials((err) => {
  if (err) {
    console.log(err.stack);
  }
  else {

  }
})
const bucketName = 'n10532935-twitterbucket';
const s3 = new AWS.S3({apiVersion:'2006-03-01'});
function saveToS3(query,data) {
  return s3.putObject({Bucket:bucketName, Key:query, Body:data}).promise();
}

// Use of Natural for sentiment analysis was found
// https://blog.logrocket.com/natural-language-processing-for-node-js/
const tokenizer = new natural.WordTokenizer();
const Analyzer = natural.SentimentAnalyzer;
const stemmer = natural.PorterStemmer;
const analyzer = new Analyzer("English", stemmer, "afinn")

/* GET home page. */
router.get('/', function(req, res) {
  // NOTE by Giane: Minimal error handling is currently used
  if (req.query.tweetFilters) {
    try {
      const query = req.query.tweetFilters;
      // Start storage checks before calling twitter api
      getRedis(`tweetFilter:${query}`)
      .then((result) => {
        let foundS3 = false;
        if (result) {
          console.log("Found key" );
          const resultJSON = JSON.parse(result);
          return resultJSON;
        }
        else {
          // Check bucket if no redis matches
          const params = {Bucket: bucketName, Key:`tweetFilter-${query}`}
          return(
            s3.getObject(params).promise()
            .then((result) =>{
              if (result) {
                const resultJSON = JSON.parse(result.Body);
                return resultJSON;
              }
            })
            .catch((err) => {
              console.error(err);
              if (err.statusCode === 404) {
                return (
                  axios.get(`https://api.twitter.com/1.1/search/tweets.json?q=${query}&lang=en`,{headers: {Authorization: 'Bearer ' + twtBearer}})
                  .then((response) => {
                    if (response.status == 200) {
                      return response.data;
                    }
                    else throw Error("Status code " + response.status + " was received.")
                  })
                )
              }
            }) // end then clause
          )
        } // end check s3 and api
      })
      .then((data) => {
        // Iterate and get the tweets' text
        //console.log(data)
        let tweets = data.statuses;
        console.log("Query received>>" + req.query.tweetFilters + "<<");
        res.render('index', { title: 'Tweet Analyser', tweets_data: parseTweets(tweets)});
        return data
      })
      .then((data) => {
        const body = JSON.stringify({source:'S3 Bucket',...data})
        Promise.all([saveToRedis(query,data),saveToS3(query,body)])
        .then((results) => {
          console.log("Saved to REDIS? " + results[0]);
          console.log("Saved to S3? " + results[1]);
        })
        .catch((err) => {
          console.log("Saving err");
          console.error(err);
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

function parseTweets(tweet_data) {
  let tweets = []
  for (let theTweet of tweet_data) {
    // Populate tweet obj to be added to tweet array
    tweet = {
      user: "",
      text: "",
      date: "",
      sentimentVal: 0,
    }
    tweet.user = theTweet.user.screen_name;
    tweet.text =  theTweet.text;
    tweet.date = theTweet.created_at;
    tweet.sentimentVal = analyzer.getSentiment(tokenizer.tokenize(theTweet.text))
    tweets.push(tweet);
    //console.log(tweet);
    // console.log("Username is<<: " + tweet.user.screen_name);
    // console.log("Tweet is>>>> " + tweet.text + "\n");
    // console.log("Sentiment is====");
    //console.log(analyzer.getSentiment(tokenizer.tokenize(tweet.text)));
  
  }
  return tweets;
}

module.exports = router;
