const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
const { chromium } = require("playwright");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const parser = new Parser({
  timeout: 15000,
  headers: {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
  }
});
const PORT = process.env.PORT || 10000;

app.use(cors({ origin: "*" }));

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-accelerated-2d-canvas",
        "--no-first-run",
        "--no-zygote",
        "--disable-gpu"
      ]
    });
  }
  return browser;
}

// 1. RSS ఫీడ్స్ తెచ్చే ఎండ్ పాయింట్
app.get("/fetch-rss", async (req, res) => {
  try {
    const rssUrl = req.query.url;
    if (!rssUrl) return res.status(400).json({ error: "Missing url" });

    // Axios తో ఫెచ్ చేసి Parser కి ఇవ్వడం వల్ల CORS & Header సమస్యలు రావు
    const response = await axios.get(rssUrl, {
      timeout: 15000,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });

    const feed = await parser.parseString(response.data);

    res.json({
      title: feed.title || "",
      items: (feed.items || []).map(item => ({
        title: item.title || "",
        link: item.link || "",
        pubDate: item.pubDate || item.isoDate || "",
        contentSnippet: item.contentSnippet || "",
        content: item.content || "",
        summary: item.summary || ""
      }))
    });
  } catch (e) {
    res.status(502).json({
      error: "RSS fetch failed",
      details: e.message
    });
  }
});

// 2. ఆర్టికల్స్ డిస్‌ప్లే చేసే ప్రొక్సీ
app.get("/article", async (req, res) => {
  try {
    const publisherUrl = req.query.url;
    if (!publisherUrl) return res.status(400).send("Missing article URL");

    const response = await axios.get(publisherUrl, {
      timeout: 20000,
      maxRedirects: 5,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      },
      validateStatus: s => s >= 200 && s < 500
    });

    const $ = cheerio.load(response.data, { decodeEntities: false });

    // CSP, Frame restrictions తొలగించడం
    $('meta[http-equiv]').each((_, el) => {
      const v = String($(el).attr("http-equiv") || "").toLowerCase();
      if (v === "content-security-policy" || v === "x-frame-options") {
        $(el).remove();
      }
    });

    $("base").remove();
    $("head").prepend(`<base href="${publisherUrl}">`);
    $("a[target='_blank']").attr("target", "_self");

    res.status(response.status);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send($.html());

  } catch (e) {
    res.status(502).send(
      `<html><body style="font-family:Arial;padding:20px">
       <h3 style="color:#ef4444">వార్తను లోడ్ చేయలేకపోయాం</h3>
       <p>${String(e.message).replace(/[<>&"]/g, "")}</p>
       </body></html>`
    );
  }
});

app.get("/", (req, res) => res.send("News proxy running."));
app.get("/health", (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log("Server running on port " + PORT));
