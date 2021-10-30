const express = require('express');
const redis = require('redis');
const axios = require('axios');
const natural = require('natural');
const router = express.Router();
const {promisify} = require('util');

// Twitter setup
const twtCreds = require('../my-twitter-keys.json');
const twtBearer = twtCreds.bearer_token;

// Local REDIS setup
const client = redis.createClient();
client.on('error', (err) => {
  console.log("Error " + err);
});

const getRedis = promisify(client.get).bind(client);
const saveRedis = promisify(client.setex).bind(client);

// Use of Natural for sentiment analysis was found
// https://blog.logrocket.com/natural-language-processing-for-node-js/
const tokenizer = new natural.WordTokenizer();
const Analyzer = natural.SentimentAnalyzer;
const stemmer = natural.PorterStemmer;
const analyzer = new Analyzer("English", stemmer, "afinn")

/* GET home page. */
router.get('/', function(req, res, next) {
  if (req.query.tweetFilters) {
    try {
      const query = req.query.tweetFilters;
      // Start storage checks before calling twitter api
      getRedis(`tweet:${query}`)
      .then((result) => {
        if (result) {
          console.log("Found key" );
          const resultJSON = JSON.parse(result);
          return resultJSON;
        }
        // else if (AMAZON S3 Bucket) {
        //
        // }
        else {
          return (
            axios.get(`https://api.twitter.com/1.1/search/tweets.json?q=${query}&lang=en`,{headers: {Authorization: 'Bearer ' + twtBearer}})
            .then((response) => {
              if (response.status == 200) {
                return response.data;
              }
              else throw Error("Status code " + response.status + " was received.")
            })
            .then()
          )
        }
      })
      .then((data) => {
        // Iterate and get the tweets' text
        console.log(data)
        let tweets = data.statuses;
        console.log("Query received>>" + req.query.tweetFilters + "<<");
        res.render('index', { title: 'Tweet Analyser', tweets_data: parseTweets(tweets)});
        return data
      })
      .then((data) => {
        Promise.all([saveRedis(`tweet:${query}`, 300, JSON.stringify({source:'Redis Cache',...data}))])
        .then(() => {
          return "Saved"
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
  console.log(tweets)
  return tweets;
}

// Checks redis for given query
function checkRedis(query) {
  console.log("Checking redis for" + query)
  return client.get(`tweet:${query}`,(err, result) => {
    console.log("Result is" + result);
    if (result) {
      const resultJSON = JSON.parse(result);
      console.log(resultJSON);
      return resultJSON;
    } else {
      console.log("RETURNING 0");
      return 0;
    }
  })
}

// Save data on query to local Redis for 5 minutes
function saveToRedis(query,data) {
  console.log("Saved to redis query " + query);
  client.setex(`tweet:${query}`, 300, JSON.stringify({source:'Redis Cache',...data}));
}

module.exports = router;
