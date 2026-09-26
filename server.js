const express = require("express");
const cors = require("cors");
const Parser = require("rss-parser");
const { chromium } = require("playwright");
const axios = require("axios");
const cheerio = require("cheerio");

const app = express();
const parser = new Parser({ timeout: 30000 });
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

// Google News URL ని అసలు Publisher URL గా మార్చే మెరుగైన ఫంక్షన్
async function resolveGoogleNewsUrl(googleUrl) {
  if (!/news\.google\.com/i.test(googleUrl)) {
    return googleUrl;
  }

  let page = null;
  let context = null;

  try {
    const b = await getBrowser();
    context = await b.newContext({
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      locale: "en-US",
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9"
      }
    });

    page = await context.newPage();

    // అవసరం లేని ఇమేజ్‌లు మరియు CSS ని బ్లాక్ చేయడం ద్వారా వేగవంతం చేయడం
    await page.route("**/*.{png,jpg,jpeg,gif,svg,css,woff,woff2}", route => route.abort());

    // గూగుల్ రీడైరెక్ట్ కోసం అభ్యర్థనను పంపడం
    const response = await page.goto(googleUrl, {
      waitUntil: "commit",
      timeout: 20000
    });

    // రీడైరెక్షన్ పూర్తయ్యే వరకు గరిష్టంగా 4 సెకన్ల సమయం ఇవ్వడం
    for (let i = 0; i < 8; i++) {
      await page.waitForTimeout(500);
      const currentUrl = page.url();
      if (currentUrl && !/news\.google\.com/i.test(currentUrl) && /^https?:\/\//i.test(currentUrl)) {
        await context.close();
        return currentUrl;
      }
    }

    // DOM లోని Canonical లేదా HTML లింకుల నుండి ఒరిజినల్ URL ను వెతకడం
    const extractedUrl = await page.evaluate(() => {
      // 1. Anchor tags తో చెక్ చేయడం
      const links = Array.from(document.querySelectorAll("a[href]"));
      for (const a of links) {
        const href = a.href;
        if (href && /^https?:\/\//i.test(href) && !/google\.com/i.test(href)) {
          return href;
        }
      }
      // 2. Canonical Tag తో చెక్ చేయడం
      const canonical = document.querySelector('link[rel="canonical"]');
      if (canonical && canonical.href && !/google\.com/i.test(canonical.href)) {
        return canonical.href;
      }
      // 3. Open Graph URL తో చెక్ చేయడం
      const og = document.querySelector('meta[property="og:url"]');
      if (og && og.content && !/google\.com/i.test(og.content)) {
        return og.content;
      }
      return null;
    });

    await context.close();

    if (extractedUrl) {
      return extractedUrl;
    }

    throw new Error("Google News నుంచి అసలు publisher URL పొందలేకపోయాం.");
  } catch (err) {
    if (context) {
      await context.close().catch(() => {});
    }
    throw err;
  }
}

function rewriteHtml(html, finalUrl) {
  const $ = cheerio.load(html, { decodeEntities: false });

  $('meta[http-equiv]').each((_, el) => {
    const v = String($(el).attr("http-equiv") || "").toLowerCase();
    if (v === "content-security-policy" || v === "x-frame-options") {
      $(el).remove();
    }
  });

  $("base").remove();
  $("head").prepend(`<base href="${finalUrl}">`);
  $("a[target='_blank']").attr("target", "_self");

  return $.html();
}

app.get("/", (req, res) => {
  res.type("text").send("News iframe proxy is running.");
});

app.get("/health", (req, res) => {
  res.json({ ok: true });
});

app.get("/fetch-rss", async (req, res) => {
  try {
    const rssUrl = req.query.url;
    if (!rssUrl) return res.status(400).json({ error: "Missing url" });

    const feed = await parser.parseURL(rssUrl);

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

app.get("/article", async (req, res) => {
  try {
    const googleUrl = req.query.url;
    if (!googleUrl) return res.status(400).send("Missing article URL");

    const publisherUrl = await resolveGoogleNewsUrl(googleUrl);

    if (/news\.google\.com/i.test(publisherUrl)) {
      return res.status(409).send(
        "<h3 style='font-family:Arial;padding:20px;color:#ef4444'>" +
        "Google News నుంచి publisher URL పొందలేకపోయాం." +
        "</h3>"
      );
    }

    const response = await axios.get(publisherUrl, {
      timeout: 25000,
      maxRedirects: 10,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9"
      },
      validateStatus: s => s >= 200 && s < 500
    });

    const contentType = String(response.headers["content-type"] || "");

    if (!contentType.includes("text/html")) {
      return res.status(502).send("Publisher returned a non-HTML response.");
    }

    const finalUrl = response.request?.res?.responseUrl || publisherUrl;
    const rewritten = rewriteHtml(response.data, finalUrl);

    res.status(response.status);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send(rewritten);

  } catch (e) {
    res.status(502).send(
      `<html><body style="font-family:Arial;padding:20px">
       <h3 style="color:#ef4444">వార్తను లోడ్ చేయలేకపోయాం</h3>
       <p>${String(e.message).replace(/[<>&"]/g, "")}</p>
       </body></html>`
    );
  }
});

process.on("SIGTERM", async () => {
  if (browser) {
    await browser.close().catch(() => {});
  }
  process.exit(0);
});

app.listen(PORT, () => {
  console.log("News iframe proxy running on port " + PORT);
});
