const express = require('express');
const cors = require('cors');
const axios = require('axios');
const Parser = require('rss-parser');

const app = express();
const parser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36'
  },
  timeout: 5000 // 5 సెకన్ల కంటే ఎక్కువ సమయం తీసుకుంటే సర్వర్ హ్యాంగ్ కాకుండా నిరోధిస్తుంది
});

app.use(cors());

app.get('/fetch-rss', async (req, res) => {
  const rssUrl = req.query.url;
  if (!rssUrl) return res.status(400).json({ error: 'URL అవసరం' });

  try {
    const response = await axios.get(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/122.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*'
      },
      timeout: 5000
    });

    const feed = await parser.parseString(response.data);
    return res.json({ items: feed.items });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    return res.status(500).json({ error: 'RSS ఫీడ్ లోడ్ అవ్వలేదు', details: err.message });
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
