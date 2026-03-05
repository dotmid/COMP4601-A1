import Crawler from "crawler";
import * as cheerio from "cheerio";
import { getDB } from "./db.js";
import { normalizeUrl, sameHost } from "./normalize.js";

// Crawl a dataset starting from seedUrl. Stores each page's html/text + outLinks in MongoDB.

export async function crawlDataset({ dataset, seedUrl, maxPages = 1500 }) {
  const db = getDB();
  const pagesCol = db.collection("pages");

  const visited = new Set();
  let storedCount = 0;

  // Optional: restrict crawl to a URL path prefix.
  // For pygame.org/docs/ we only want pages under that path.
  const seedParsed = new URL(seedUrl);
  const pathPrefix = seedParsed.pathname === "/" ? null : seedParsed.pathname;

  function isAllowed(url) {
    try {
      const u = new URL(url);
      // Must be same host
      if (u.host !== seedParsed.host) return false;
      // If seed has a path prefix (e.g. /docs/), restrict to it
      if (pathPrefix && !u.pathname.startsWith(pathPrefix)) return false;
      return true;
    } catch {
      return false;
    }
  }

  const c = new Crawler({
    maxConnections: 2,      // be polite — avoid 429s
    rateLimit: 300,         // ms between requests (≈3 req/sec)
    timeout: 15000,
    retries: 1,
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; Comp4601Crawler/1.0)"
    },
    callback: async (err, res, done) => {
      try {
        if (err) {
          console.error(`[${dataset}] fetch error:`, err.message);
          return done();
        }

        const url = res?.options?.url;
        console.log(`[${dataset}] (${storedCount}/${maxPages}) ${url}`);

        // hard stop if maxPages reached
        if (storedCount >= maxPages) return done();

        // skip if visited in-memory
        if (visited.has(url)) return done();
        visited.add(url);

        const html = res.body ?? "";
        const $ = cheerio.load(html);

        // extract outgoing links — constrained to allowed prefix
        const outLinks = [];
        $("a[href]").each((_, a) => {
          const raw = $(a).attr("href");
          const norm = normalizeUrl(raw, url);
          if (!norm) return;
          if (!isAllowed(norm)) return;
          outLinks.push(norm);
        });

        $("a").remove();

        const title = ($("title").text() || "").trim();
        const text = $("p, li, td, th, dt, dd, h1, h2, h3, h4")
          .map((_, el) => $(el).text())
          .get()
          .join(" ")
          .replace(/\s+/g, " ")
          .trim();

        const uniqueOut = [...new Set(outLinks)];

        // store page doc (unique index prevents duplicates)
        try {
          await pagesCol.insertOne({
            dataset,
            url,
            seedUrl,
            title,
            text,
            html,
            outLinks: uniqueOut,
            crawledAt: new Date()
          });
          storedCount++;

          // enqueue discovered links
          if (storedCount < maxPages) {
            uniqueOut.forEach((link) => {
              if (!visited.has(link)) c.queue(link);
            });
          }
        } catch (e) {
          // Duplicate key means it's already stored
          if (e.code !== 11000) console.error(`[${dataset}] db error:`, e.message);
        }

      } finally {
        done();
      }
    }
  });

  // start crawl
  c.queue(seedUrl);

  // wait until crawler is drained
  await new Promise((resolve) => c.on("drain", resolve));

  return { dataset, seedUrl, pagesStored: storedCount };
}