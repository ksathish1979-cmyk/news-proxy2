const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  },
  timeout: 10000
});

app.use(cors());
app.use(express.json());

// Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime() });
});

// RSS Fetch Endpoint
app.get('/fetch-rss', async (req, res) => {
  const rssUrl = req.query.url;

  if (!rssUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    // 1. First try parsing directly with rss-parser
    const feed = await parser.parseURL(rssUrl);
    return res.json({ items: feed.items });

  } catch (firstErr) {
    console.log(`Direct RSS fetch failed for ${rssUrl}, retrying with Axios...`);

    try {
      // 2. Fallback using Axios if direct fetch hits CORS or User-Agent blockage
      const response = await axios.get(rssUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/rss+xml, application/xml, text/xml, */*'
        },
        timeout: 10000
      });

      const feed = await parser.parseString(response.data);
      return res.json({ items: feed.items });

    } catch (secondErr) {
      console.error(`Axios RSS fetch failed: ${secondErr.message}`);
      return res.status(500).json({
        error: 'RSS fetch failed',
        details: secondErr.message
      });
    }
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Lightweight Proxy Server running on port ${PORT}`);
});
