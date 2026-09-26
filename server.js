const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,ta;q=0.8'
  },
  timeout: 15000
});

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.get('/fetch-rss', async (req, res) => {
  const rssUrl = req.query.url;

  if (!rssUrl) {
    return res.status(400).json({ error: 'URL parameter is required' });
  }

  try {
    // Attempt 1: Fetch using Axios with realistic browser headers
    const response = await axios.get(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cache-Control': 'no-cache'
      },
      timeout: 15000
    });

    const feed = await parser.parseString(response.data);
    return res.json({ items: feed.items });

  } catch (err) {
    console.log(`Axios failed for ${rssUrl}, trying direct parser fallback...`);
    
    try {
      // Attempt 2: Fallback to direct RSS parser
      const feed = await parser.parseURL(rssUrl);
      return res.json({ items: feed.items });
    } catch (fallbackErr) {
      console.error(`Fetch failed for ${rssUrl}: ${fallbackErr.message}`);
      return res.status(500).json({
        error: 'RSS fetch failed',
        details: fallbackErr.message
      });
    }
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => {
  console.log(`Robust Proxy Server running on port ${PORT}`);
});
