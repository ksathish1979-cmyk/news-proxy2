const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');

const app = express();

const parser = new Parser({
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
  },
  timeout: 15000
});

app.use(cors());


/* =========================================================
   GOOGLE NEWS URL RESOLVER
   ========================================================= */

async function resolveGoogleNewsUrl(googleUrl) {

  // ఇది Google News URL కాకపోతే నేరుగా return
  if (!googleUrl.includes('news.google.com/rss/articles/')) {
    return googleUrl;
  }

  console.log('Google News URL:', googleUrl);

  try {

    /*
     * Google News article page తెరవడం ద్వారా
     * article ID / signature / timestamp సమాచారం పొందుతాం.
     */

    const pageResponse = await axios.get(googleUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      timeout: 20000,
      maxRedirects: 5
    });

    const html = pageResponse.data;

    /*
     * Google News pageలోని decoding parameters
     */

    const idMatch =
      html.match(/data-n-a-id="([^"]+)"/) ||
      html.match(/data-n-a-id='([^']+)'/);

    const signatureMatch =
      html.match(/data-n-a-sg="([^"]+)"/) ||
      html.match(/data-n-a-sg='([^']+)'/);

    const timestampMatch =
      html.match(/data-n-a-ts="([^"]+)"/) ||
      html.match(/data-n-a-ts='([^']+)'/);

    /*
     * కొన్ని Google News versionsలో ID URL నుంచే తీసుకోవచ్చు
     */

    const urlParts = googleUrl.split('/rss/articles/');

    let articleId = null;

    if (urlParts.length > 1) {
      articleId = urlParts[1].split('?')[0];
    }

    const id = idMatch ? idMatch[1] : articleId;
    const signature = signatureMatch ? signatureMatch[1] : null;
    const timestamp = timestampMatch ? timestampMatch[1] : null;

    console.log('Google Article ID:', id);
    console.log('Signature found:', !!signature);
    console.log('Timestamp found:', !!timestamp);

    if (!id) {
      throw new Error('Google News article ID దొరకలేదు.');
    }


    /*
     * Google News internal resolution request
     */

    const rpcPayload = [
      [
        [
          'Fbv4je',
          JSON.stringify([
            'garturlreq',
            [
              [
                'en-US',
                'US',
                [
                  'FINANCE_TOP_INDICES',
                  'WEB_TEST_1_0_0'
                ],
                null,
                null,
                1,
                1,
                'US:en',
                null,
                180,
                null,
                null,
                null,
                null,
                null,
                0,
                null,
                null,
                [
                  1608992183,
                  723341000
                ]
              ],
              'en-US',
              'US',
              1,
              [2, 3, 4, 8],
              1,
              0,
              '655000234',
              0,
              0,
              null
            ],
            id
          ]),
          null,
          'generic'
        ]
      ]
    ];

    const rpcBody =
      'f.req=' +
      encodeURIComponent(JSON.stringify(rpcPayload));


    const rpcResponse = await axios.post(
      'https://news.google.com/_/DotsSplashUi/data/batchexecute?rpcids=Fbv4je',
      rpcBody,
      {
        headers: {
          'Content-Type':
            'application/x-www-form-urlencoded;charset=UTF-8',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
          'Accept':
            '*/*',
          'Origin':
            'https://news.google.com',
          'Referer':
            googleUrl
        },
        timeout: 20000
      }
    );


    const responseText = rpcResponse.data;

    console.log(
      'Google resolution response received:',
      responseText.length
    );


    /*
     * Responseలో publisher URL వెతుకుతాం
     */

    const urlMatches = responseText.match(
      /https?:\/\/[^"\\\s]+/g
    );

    if (urlMatches && urlMatches.length) {

      for (const possibleUrl of urlMatches) {

        let cleanUrl = possibleUrl
          .replace(/\\u003d/g, '=')
          .replace(/\\u0026/g, '&')
          .replace(/\\\//g, '/')
          .replace(/\\+"/g, '"')
          .replace(/["\\]+$/g, '');

        if (
          cleanUrl.startsWith('http') &&
          !cleanUrl.includes('google.com') &&
          !cleanUrl.includes('gstatic.com') &&
          !cleanUrl.includes('googleusercontent.com')
        ) {

          console.log(
            'Publisher URL found:',
            cleanUrl
          );

          return cleanUrl;
        }
      }
    }


    throw new Error(
      'Google News resolution responseలో publisher URL దొరకలేదు.'
    );

  } catch (err) {

    console.error(
      'Google News Resolver Error:',
      err.message
    );

    throw err;
  }
}


/* =========================================================
   RSS FEED
   ========================================================= */

app.get('/fetch-rss', async (req, res) => {

  const rssUrl = req.query.url;

  if (!rssUrl) {
    return res.status(400).json({
      error: 'RSS URL అవసరం'
    });
  }

  try {

    const response = await axios.get(rssUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept':
          'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 15000
    });

    const feed = await parser.parseString(response.data);

    return res.json({
      items: feed.items
    });

  } catch (err) {

    console.error('RSS Error:', err.message);

    return res.status(500).json({
      error: 'RSS ఫీడ్ లోడ్ అవ్వలేదు',
      details: err.message
    });
  }
});


/* =========================================================
   ARTICLE
   ========================================================= */

app.get('/article', async (req, res) => {

  const googleUrl = req.query.url;

  if (!googleUrl) {
    return res.status(400).send(
      'Article URL అవసరం'
    );
  }

  try {

    console.log('Article request:', googleUrl);

    /*
     * Google News → అసలు Publisher URL
     */

    const publisherUrl =
      await resolveGoogleNewsUrl(googleUrl);

    console.log(
      'Final Publisher URL:',
      publisherUrl
    );


    /*
     * Publisher page download
     */

    const articleResponse = await axios.get(
      publisherUrl,
      {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
          'Accept':
            'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language':
            'ta-IN,ta;q=0.9,en-US;q=0.8,en;q=0.7'
        },
        timeout: 30000,
        maxRedirects: 10
      }
    );


    let html = articleResponse.data;


    /*
     * iframe blocking meta tags తొలగింపు
     */

    html = html.replace(
      /<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi,
      ''
    );

    html = html.replace(
      /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
      ''
    );


    /*
     * Relative URLs పనిచేయడానికి base URL
     */

    if (!/<base\s/i.test(html)) {

      html = html.replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${publisherUrl}">`
      );

    }


    res.setHeader(
      'Content-Type',
      'text/html; charset=utf-8'
    );

    res.setHeader(
      'X-Frame-Options',
      'ALLOWALL'
    );

    return res.send(html);


  } catch (err) {

    console.error(
      'Article Error:',
      err.message
    );

    return res.status(500).send(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <title>వార్త లోపం</title>
      </head>
      <body style="
        font-family:Arial,sans-serif;
        padding:30px;
        line-height:1.6;
      ">
        <h3>వార్తను తెరవలేకపోయాం</h3>
        <p>${err.message}</p>
      </body>
      </html>
    `);
  }
});


/* =========================================================
   SERVER
   ========================================================= */

const PORT =
  process.env.PORT || 10000;

app.listen(PORT, () => {

  console.log(
    `Server running on port ${PORT}`
  );

});
