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

let browserPromise = null;

async function getBrowser() {
  if (!browserPromise) {
    browserPromise = chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage"
      ]
    });
  }
  return browserPromise;
}

async function resolveGoogleNewsUrl(googleUrl) {
  if (!/news\.google\.com\/rss\/articles\//i.test(googleUrl)) {
    return googleUrl;
  }

  const browser = await getBrowser();
  const page = await browser.newPage({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36",
    locale: "ta-IN"
  });

  try {
    // పేజీ లోడ్ అయ్యే వరకు ఆగుతుంది
    await page.goto(googleUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30000
    });

    // రిడైరెక్షన్ పూర్తిగా జరిగే వరకు 3 సెకన్లు ఆగుతుంది
    await page.waitForTimeout(3000);

    const finalUrl = page.url();

    if (
      finalUrl &&
      !/news\.google\.com/i.test(finalUrl) &&
      /^https?:\/\//i.test(finalUrl)
    ) {
      return finalUrl;
    }

    // Execution context destroyed ఎర్రర్ రాకుండా సురక్షితంగా వెతకడం
    let candidates = [];
    try {
      candidates = await page.evaluate(() => {
        const out = [];

        document.querySelectorAll("a[href]").forEach(a => {
          const href = a.href;
          if (
            href &&
            /^https?:\/\//i.test(href) &&
            !/news\.google\.com/i.test(href) &&
            !/google\./i.test(new URL(href).hostname)
          ) {
            out.push(href);
          }
        });

        const canonical = document.querySelector('link[rel="canonical"]');
        if (canonical && canonical.href) out.unshift(canonical.href);

        const og = document.querySelector('meta[property="og:url"]');
        if (og && og.content) out.unshift(og.content);

        return [...new Set(out)];
      });
    } catch (evalErr) {
      // రిడైరెక్ట్ అవ్వడం వల్ల ఎర్రర్ వస్తే, రిడైరెక్ట్ అయిన తదుపరి పేజీ URL ని నేరుగా తీసుకుంటుంది
      const currentUrl = page.url();
      if (currentUrl && !/news\.google\.com/i.test(currentUrl)) {
        return currentUrl;
      }
    }

    for (const url of candidates) {
      if (!/news\.google\.com/i.test(url)) return url;
    }

    // ఏదీ కుదరకపోతే చివరిగా ప్రాసెస్ అయిన URL ని ఇస్తుంది
    const fallbackUrl = page.url();
    if (fallbackUrl && !/news\.google\.com/i.test(fallbackUrl)) {
      return fallbackUrl;
    }

    throw new Error("Google News నుంచి అసలు publisher URL పొందలేకపోయాం.");
  } finally {
    await page.close();
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
        "<h3 style='font-family:Arial;padding:20px'>" +
        "Google News నుంచి publisher URL పొందలేకపోయాం." +
        "</h3>"
      );
    }

    const response = await axios.get(publisherUrl, {
      timeout: 30000,
      maxRedirects: 10,
      responseType: "text",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) " +
          "AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/154.0.0.0 Safari/537.36",
        "Accept-Language": "ta-IN,ta;q=0.9,en;q=0.7"
      },
      validateStatus: s => s >= 200 && s < 500
    });

    const contentType = String(response.headers["content-type"] || "");

    if (!contentType.includes("text/html")) {
      return res.status(502).send(
        "Publisher returned a non-HTML response."
      );
    }

    const finalUrl =
      response.request?.res?.responseUrl || publisherUrl;

    const rewritten = rewriteHtml(response.data, finalUrl);

    res.status(response.status);
    res.set("Content-Type", "text/html; charset=utf-8");
    res.set("Cache-Control", "no-store");
    res.send(rewritten);

  } catch (e) {
    res.status(502).send(
      `<html><body style="font-family:Arial;padding:20px">
       <h3>వార్తను లోడ్ చేయలేకపోయాం</h3>
       <p>${String(e.message).replace(/[<>&"]/g, "")}</p>
       </body></html>`
    );
  }
});

process.on("SIGTERM", async () => {
  try {
    if (browserPromise) {
      const b = await browserPromise;
      await b.close();
    }
  } finally {
    process.exit(0);
  }
});

app.listen(PORT, () => {
  console.log("News iframe proxy running on port " + PORT);
});
