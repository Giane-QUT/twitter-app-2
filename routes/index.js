const express = require('express');
const axios = require('axios');
const natural = require('natural');
const router = express.Router();

const twtCreds = require('../my-twitter-keys.json');
const twtBearer = twtCreds.bearer_token;

// Use of Natural for sentiment analysis was found
// https://blog.logrocket.com/natural-language-processing-for-node-js/
var tokenizer = new natural.WordTokenizer();
var Analyzer = natural.SentimentAnalyzer;
var stemmer = natural.PorterStemmer;
var analyzer = new Analyzer("English", stemmer, "afinn")

/* GET home page. */
router.get('/', function(req, res, next) {
  if (req.query.tweetFilters) {
    try {
      // COVID-19 is a test query
      axios.get("https://api.twitter.com/1.1/search/tweets.json?q=covid-19&lang=en",{headers: {Authorization: 'Bearer ' + twtBearer}})
      .then((response) => {
        if (response.status == 200) {
          return response.data;
        }
        else throw Error("Status code " + response.status + " was received.")
      })
      .then((data) => {
        // Iterate and get the tweets' text
        let tweets = data.statuses;
        parseTweets(tweets);
        console.log("Query received>>" + req.query.tweetFilters + "<<");
        res.render('index', { title: 'Tweet Analyser', opti: "AN option" });
      })
      .catch((e) => {
        console.error(e);
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

function parseTweets(tweets) {
  for (let tweet of tweets) {
    console.log("Username is<<: " + tweet.user.screen_name);
    console.log("Tweet is>>>> " + tweet.text + "\n");
    console.log("Sentiment is====");
    console.log(analyzer.getSentiment(tokenizer.tokenize(tweet.text)));
  }
}

module.exports = router;
