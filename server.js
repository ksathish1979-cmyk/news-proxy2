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
   BASIC HEALTH CHECK
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
   FETCH RSS
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

      if (item.enclosure && item.enclosure.url) {
        image = item.enclosure.url;
      }

      if (!image && item['media:content']) {
        if (item['media:content'].$) {
          image =
            item['media:content'].$.url || '';
        }
      }

      if (!image && item.content) {
        const imageMatch =
          item.content.match(
            /<img[^>]+src=["']([^"']+)["']/i
          );

        if (imageMatch) {
          image = imageMatch[1];
        }
      }

      return {
        title: item.title || '',
        link: item.link || '',
        pubDate: item.pubDate || item.isoDate || '',
        content: item.contentSnippet || item.content || '',
        image: image
      };

    });

    res.json({
      title: feed.title || '',
      items: items
    });

  } catch (err) {

    console.error(
      'RSS Error:',
      err.message
    );

    res.status(500).json({
      error: 'RSS feed చదవలేకపోయాం.',
      details: err.message
    });

  }

});


/* =========================================================
   GOOGLE NEWS URL RESOLVER
========================================================= */

async function resolveGoogleNewsUrl(googleUrl) {

  if (
    !googleUrl.includes(
      'news.google.com/rss/articles/'
    )
  ) {
    return googleUrl;
  }

  console.log(
    'Google News URL:',
    googleUrl
  );

  try {

    const pageResponse = await axios.get(
      googleUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',

          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',

          'Accept-Language':
            'en-US,en;q=0.9'
        },

        timeout: 20000,

        maxRedirects: 5
      }
    );

    const html = pageResponse.data;

    /* ---------------------------------------------
       ARTICLE ID
    --------------------------------------------- */

    const urlParts =
      googleUrl.split(
        '/rss/articles/'
      );

    if (!urlParts[1]) {

      throw new Error(
        'Google News Article ID దొరకలేదు.'
      );

    }

    const articleId =
      urlParts[1].split('?')[0];

    /* ---------------------------------------------
       SIGNATURE
    --------------------------------------------- */

    const signatureMatch =
      html.match(
        /data-n-a-sg="([^"]+)"/
      ) ||
      html.match(
        /data-n-a-sg='([^']+)'/
      );

    /* ---------------------------------------------
       TIMESTAMP
    --------------------------------------------- */

    const timestampMatch =
      html.match(
        /data-n-a-ts="([^"]+)"/
      ) ||
      html.match(
        /data-n-a-ts='([^']+)'/
      );

    const signature =
      signatureMatch
        ? signatureMatch[1]
        : null;

    const timestamp =
      timestampMatch
        ? timestampMatch[1]
        : null;

    console.log(
      'Google Article ID:',
      articleId
    );

    console.log(
      'Signature found:',
      !!signature
    );

    console.log(
      'Timestamp found:',
      !!timestamp
    );

    if (!signature || !timestamp) {

      throw new Error(
        'Google News signature లేదా timestamp దొరకలేదు.'
      );

    }

    /* ---------------------------------------------
       GOOGLE GARTURL REQUEST
    --------------------------------------------- */

    const articleRequest = [
      'garturlreq',

      [
        [
          'X',
          'X',
          ['X', 'X'],
          null,
          null,
          1,
          1,
          'US:en',
          null,
          1,
          null,
          null,
          null,
          null,
          null,
          0,
          1
        ],

        'X',
        'X',
        1,
        [1, 1, 1],
        1,
        1,
        null,
        0,
        0,
        null,
        0,
        0,
        null
      ],

      articleId,
      Number(timestamp),
      signature
    ];

    const rpcRequest = [
      [
        'Fbv4je',
        JSON.stringify(articleRequest),
        null,
        'generic'
      ]
    ];

    const formData =
      new URLSearchParams({
        'f
