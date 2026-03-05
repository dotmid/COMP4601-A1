import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  connectDB, getIncomming, getPageInfo, getPageDetails,
  computeAndStorePageRank, getPageRankValue, searchDataset
} 
from "./db.js";
import { crawlDataset } from './crawler.js';


const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = await connectDB("mongodb://127.0.0.1:27017", "comp4601_a2");
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(__dirname));

//Datasets
const datasets = {
  "fruitsA":  "https://people.scs.carleton.ca/~avamckenney/fruitsA/N-0.html",
  "personal": "https://books.toscrape.com/"
};

// Helpers funcs
// Parse and validate the shared query params: boost, limit
function parseSearchParams(req) {
  const query  = (req.query.q || req.query.phrase || "").trim();
  const boost  = req.query.boost === "true";
  const rawLimit = parseInt(req.query.limit, 10);
  const limit  = isNaN(rawLimit) ? 10 : Math.min(50, Math.max(1, rawLimit));
  return { query, boost, limit };
}

app.get("/info", async (req, res) => {
  return res.json({ name: "HildaBrownlock4069" });
});

// PageRank lookup by URL
app.get("/pageranks", async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).send("url query parameter is required");

  const rank = await getPageRankValue(url);
  if (rank === null) return res.status(404).send("PageRank not found for the given URL");

  return res.type("text/plain").send(String(rank));
});

// Search: /fruitsA 
// GET /fruitsA?q=<query>[&boost=true][&limit=N]
app.get("/fruitsA", async (req, res) => {
  const { query, boost, limit } = parseSearchParams(req);
  if (!query) return res.status(400).json({ error: "Query parameter 'q' is required" });

  try {
    const results = await searchDataset("fruitsA", query, boost, limit);
    return res.json({ result: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Search failed" });
  }
});

// Search: /personal (pygame.org/docs)
// GET /personal?q=<query>[&boost=true][&limit=N]
app.get("/personal", async (req, res) => {
  const { query, boost, limit } = parseSearchParams(req);
  if (!query) return res.status(400).json({ error: "Query parameter 'q' is required" });

  try {
    const results = await searchDataset("personal", query, boost, limit);
    return res.json({ result: results });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Search failed" });
  }
});

// Page detail: incoming/outgoing links + word frequency
// GET /:datasetName/pagedata?url=<url>
app.get("/:datasetName/pagedata", async (req, res) => {
  const { datasetName } = req.params;
  const { url } = req.query;

  if (!url) return res.status(400).json({ error: "url query parameter is required" });

  try {
    const details = await getPageDetails(datasetName, url);
    if (!details) return res.status(404).json({ error: "Page not found in dataset" });
    return res.json(details);
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: "Failed to fetch page details" });
  }
});

// Incoming links for a page 
app.get("/:datasetName/page", async (req, res) => {
  const { datasetName } = req.params;
  const { url } = req.query;

  if (!url) return res.status(400).json({ error: "url query parameter is required" });

  const incomingLinks = await getPageInfo(datasetName, url);
  return res.json({ webUrl: url, incomingLinks });
});

// Crawl + PageRank 
// GET /:datasetName/crawl
app.get("/:datasetName/crawl", async (req, res) => {
  const { datasetName } = req.params;
  const seedUrl = datasets[datasetName];

  if (!seedUrl) return res.status(400).json({ error: `Unknown dataset: ${datasetName}` });

  const maxPages = datasetName === "fruitsA" ? 100 : 2500;

  console.log(`[Crawl] Starting crawl for ${datasetName} (maxPages=${maxPages})...`);
  const crawlResult = await crawlDataset({ dataset: datasetName, seedUrl, maxPages });
  console.log(`[Crawl] Done. Pages stored: ${crawlResult.pagesStored}`);

  console.log(`[PageRank] Computing for ${datasetName}...`);
  await computeAndStorePageRank(datasetName);
  console.log(`[PageRank] Done.`);

  return res.json({ status: "ok", dataset: datasetName, pagesStored: crawlResult.pagesStored });
});

// Popular pages by inlink count)
app.get("/:datasetName/popular", async (req, res) => {
  const { datasetName } = req.params;
  const baseUrl = `${req.protocol}://${req.get('host')}`;

  await crawlDataset({ dataset: datasetName, seedUrl: datasets[datasetName], maxPages: 1000 });
  const pages = await getIncomming(datasetName);

  const result = pages.slice(0, 10).map(([origUrl]) => ({
    url: `${baseUrl}/${datasetName}/page?url=${encodeURIComponent(origUrl)}`,
    origUrl
  }));

  return res.json({ result });
});

// ─Start server and crawl pages
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
  console.log(`  Client UI:  http://localhost:${PORT}/client.html`);
  console.log(`  Crawl fruitsA: http://localhost:${PORT}/fruitsA/crawl`);
  console.log(`  Crawl personal: http://localhost:${PORT}/personal/crawl`);
});