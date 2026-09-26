const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');

const app = express();

app.use(cors());
app.use(express.json());

const parser = new Parser({
  timeout: 20000
});

const PORT = process.env.PORT || 10000;


/* =========================================================
   HOME / HEALTH
========================================================= */

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Tamil News Proxy',
    message: 'News proxy server is running'
  });
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok'
  });
});


/* =========================================================
   RSS
========================================================= */

app.get('/fetch-rss', async (req, res) => {

  try {

    const rssUrl = req.query.url;

    if (!rssUrl) {
      return res.status(400).json({
        error: 'RSS URL ఇవ్వలేదు.'
      });
    }

    console.log('RSS request:', rssUrl);

    const feed = await parser.parseURL(rssUrl);

    const items = (feed.items || []).map(item => {

      let image = '';

      if (
        item.enclosure &&
        item.enclosure.url
      ) {
        image = item.enclosure.url;
      }

      if (
        !image &&
        item['media:content']
      ) {

        if (
          item['media:content'].$
        ) {
         
