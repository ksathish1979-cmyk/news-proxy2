const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');
const { chromium } = require('playwright');

const app = express();

const parser = new Parser({
  headers: {
    'User-Agent':
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
  },
  timeout: 15000
});

app.use(cors());

/* =========================
   RSS FEED
========================= */

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


/* =========================
   GOOGLE NEWS → PUBLISHER URL
========================= */

app.get('/article', async (req, res) => {

  const articleUrl = req.query.url;

  if (!articleUrl) {
    return res.status(400).send('Article URL అవసరం');
  }

  let browser;

  try {

    console.log('Original URL:', articleUrl);

    browser = await chromium.launch({
      headless: true
    });

    const page = await browser.newPage({
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36'
    });

    await page.goto(articleUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    await page.waitForTimeout(3000);

    const finalUrl = page.url();

    console.log('Publisher URL:', finalUrl);

    await browser.close();
    browser = null;

    if (!finalUrl || finalUrl.includes('news.google.com')) {
      return res.status(502).send(`
        <html>
        <body style="font-family:Arial;padding:30px;">
        <h3>వార్త వెబ్‌సైట్ URL పొందలేకపోయాం</h3>
        <p>Google News నుంచి అసలు publisher URL అందలేదు.</p>
        </body>
        </html>
      `);
    }


    /* =========================
       PUBLISHER PAGE DOWNLOAD
    ========================= */

    const response = await axios.get(finalUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/122.0.0.0 Safari/537.36',
        'Accept':
          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'ta-IN,ta;q=0.9,en-US;q=0.8,en;q=0.7'
      },
      timeout: 30000,
      maxRedirects: 10
    });


    let html = response.data;


    /* =========================
       REMOVE IFRAME BLOCKING HEADERS
    ========================= */

    html = html.replace(
      /<meta[^>]+http-equiv=["']?X-Frame-Options["']?[^>]*>/gi,
      ''
    );

    html = html.replace(
      /<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi,
      ''
    );


    /* =========================
       ADD BASE URL
    ========================= */

    if (!/<base\s/i.test(html)) {

      html = html.replace(
        /<head([^>]*)>/i,
        `<head$1><base href="${finalUrl}">`
      );

    }


    /* =========================
       REMOVE FRAME BLOCKING JS
    ========================= */

    html = html.replace(
      /if\s*\(\s*window\.top\s*!==\s*window\.self\s*\)[\s\S]*?;/gi,
      ''
    );


    res.setHeader(
      'Content-Type',
      'text/html; charset=utf-8'
    );

    res.setHeader(
      'X-Frame-Options',
      'ALLOWALL'
    );

    res.removeHeader('Content-Security-Policy');

    return res.send(html);


  } catch (err) {

    console.error('Article Error:', err.message);

    if (browser) {
      try {
        await browser.close();
      } catch (e) {}
    }

    return res.status(500).send(`
      <html>
      <body style="font-family:Arial;padding:30px;">
      <h3>వార్తను తెరవలేకపోయాం</h3>
      <p>${err.message}</p>
      </body>
      </html>
    `);
  }
});


/* =========================
   SERVER
========================= */

const PORT = process.env.PORT || 10000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
