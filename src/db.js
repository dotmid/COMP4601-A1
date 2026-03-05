import { MongoClient } from "mongodb";

let client;
let db;

export async function connectDB(uri, dbName) {
  if (db) return db;

  client = new MongoClient(uri);
  await client.connect();
  db = client.db(dbName);

  // pages: one doc per (dataset, url)
  const pages = db.collection("pages");
  await pages.createIndex({ dataset: 1, url: 1 }, { unique: true });
  await pages.createIndex({ dataset: 1 });

  // pageranks: one doc per (dataset, url)
  const pageranks = db.collection("pageranks");
  await pageranks.createIndex({ dataset: 1, url: 1 }, { unique: true });
  await pageranks.createIndex({ url: 1 });

  return db;
}

export async function getIncomming(dataset) {
  const pages = await db.collection("pages").find({ "dataset": dataset }).toArray();
  let inlinks = {};
  pages.forEach(page => {
    page.outLinks.forEach(link => {
      inlinks[link] = (inlinks[link] + 1) || 1;
    });
  });
  const sorted = Object.entries(inlinks).sort(([, a], [, b]) => b - a);
  return sorted;
}

export async function getPageInfo(dataset, targetUrl) {
  const pages = await db.collection("pages").find({
    "dataset": dataset,
    "outLinks": targetUrl
  }).toArray();
  return pages.map(page => page.url);
}

// Returns rich detail for a single page: incoming links, outgoing links, word frequencies.
export async function getPageDetails(dataset, targetUrl) {
  // The page document itself
  const doc = await db.collection("pages").findOne({ dataset, url: targetUrl });
  if (!doc) return null;

  // Incoming links (pages that link TO this page)
  const incomingDocs = await db.collection("pages").find({
    dataset,
    outLinks: targetUrl
  }).toArray();
  const incomingLinks = incomingDocs.map(p => p.url);

  // Word frequency map from stored text
  const words = (doc.text || "").toLowerCase().split(/\s+/).filter(Boolean);
  const freqMap = {};
  words.forEach(w => { freqMap[w] = (freqMap[w] || 0) + 1; });

  // Sort by frequency descending, return top 50
  const wordFrequency = Object.entries(freqMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 50)
    .map(([word, count]) => ({ word, count }));

  // PageRank value
  const prDoc = await db.collection("pageranks").findOne({ dataset, url: targetUrl });

  return {
    url: doc.url,
    title: doc.title || "N/A",
    crawledAt: doc.crawledAt,
    incomingLinks,
    outgoingLinks: doc.outLinks || [],
    wordFrequency,
    pageRank: prDoc ? prDoc.rank : null
  };
}

export function getDB() {
  if (!db) throw new Error("DB not connected yet. Call connectDB first.");
  return db;
}

export async function closeDB() {
  if (client) await client.close();
  client = null;
  db = null;
}

// PageRank
// Compute PageRank for all pages in a dataset and persist results to Mongo.
// Uses alpha = 0.1, stops when Euclidean distance between iterations < 0.0001.
export async function computeAndStorePageRank(dataset) {
  const pages = await db.collection("pages").find({ dataset }).toArray();
  if (!pages.length) {
    console.log(`[PageRank] No pages found for dataset: ${dataset}`);
    return;
  }

  const N = pages.length;
  const alpha = 0.1;

  // Map each URL to an index
  const urlToIdx = new Map();
  pages.forEach((p, i) => urlToIdx.set(p.url, i));

  //adjacency matrix A 
  const A = new Float64Array(N * N);

  pages.forEach((page, i) => {
    const validOut = page.outLinks.filter(link => urlToIdx.has(link));
    if (validOut.length === 0) {
      for (let j = 0; j < N; j++) A[i * N + j] = 1 / N;
    } else {
      const weight = 1 / validOut.length;
      validOut.forEach(link => {
        const j = urlToIdx.get(link);
        A[i * N + j] = weight;
      });
    }
  });

  const teleport = alpha / N;
  const T = new Float64Array(N * N);
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      T[i * N + j] = (1 - alpha) * A[i * N + j] + teleport;
    }
  }

  let pr = new Float64Array(N).fill(1 / N);
  const THRESHOLD = 0.0001;
  let iteration = 0;

  while (true) {
    const prNew = new Float64Array(N);
    for (let i = 0; i < N; i++) {
      for (let j = 0; j < N; j++) {
        prNew[j] += pr[i] * T[i * N + j];
      }
    }

    let dist = 0;
    for (let i = 0; i < N; i++) dist += (prNew[i] - pr[i]) ** 2;
    dist = Math.sqrt(dist);
    pr = prNew;
    iteration++;

    if (dist < THRESHOLD) {
      console.log(`[PageRank] ${dataset}: converged after ${iteration} iterations (dist=${dist.toFixed(8)})`);
      break;
    }
  }

  const pageranksCol = db.collection("pageranks");
  const ops = pages.map((page, i) => ({
    updateOne: {
      filter: { dataset, url: page.url },
      update: { $set: { dataset, url: page.url, rank: pr[i] } },
      upsert: true
    }
  }));
  await pageranksCol.bulkWrite(ops);

  const sorted = [...pr.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`[PageRank] Top 10 for ${dataset}:`);
  sorted.slice(0, 10).forEach(([idx, rank], pos) => {
    console.log(`  #${pos + 1}. (${rank.toFixed(6)}) ${pages[idx].url}`);
  });

  return sorted.map(([idx, rank]) => ({ url: pages[idx].url, rank }));
}

// Look up the PageRank value for a given URL
export async function getPageRankValue(url) {
  const doc = await db.collection("pageranks").findOne({ url });
  return doc ? doc.rank : null;
}

// Search
export async function searchDataset(datasetName, query, boost = false, limit = 10) {
  const pages = await db.collection("pages").find({ dataset: datasetName }).toArray();
  if (!pages.length) return [];

  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const totalDocs = pages.length;
  const uniqueQueryTerms = [...new Set(queryTerms)];

  // Build DF map
  const dfMap = {};
  pages.forEach(p => {
    const words = new Set(p.text.toLowerCase().split(/\s+/).filter(Boolean));
    words.forEach(w => { dfMap[w] = (dfMap[w] || 0) + 1; });
  });

  // Filter query terms with IDF > 0
  const validQueryTerms = uniqueQueryTerms.filter(term =>
    Math.max(0, IDF(dfMap, totalDocs, term)) > 0
  );

  const queryWeights = validQueryTerms.map(term => {
    const tf = TF(queryTerms, term);
    const idf = Math.max(0, IDF(dfMap, totalDocs, term));
    return Math.log2(1 + tf) * idf;
  });

  console.log(`\nQuery for: "${query}" | dataset: ${datasetName} | boost: ${boost} | limit: ${limit}`);
  console.log("validQueryTerms:", validQueryTerms);

  // Fetch PageRanks for all pages in this dataset
  const rankDocs = await db.collection("pageranks").find({ dataset: datasetName }).toArray();
  const prMap = {};
  rankDocs.forEach(r => { prMap[r.url] = r.rank; });

  // Normalise PR: find max so we can scale to [0, 1]
  const prValues = Object.values(prMap);
  const maxPR = prValues.length ? Math.max(...prValues) : 1;

  // Score each document
  const results = pages.map(doc => {
    const docTerms = doc.text.toLowerCase().split(/\s+/).filter(Boolean);

    const docVector = validQueryTerms.map(term => {
      const tf = TF(docTerms, term);
      const idf = Math.max(0, IDF(dfMap, totalDocs, term));
      return Math.log2(1 + tf) * idf;
    });

    const queryMag = Math.sqrt(queryWeights.reduce((s, w) => s + w * w, 0));
    const docMag = Math.sqrt(docVector.reduce((s, w) => s + w * w, 0));
    let dotProduct = 0;
    docVector.forEach((w, i) => { dotProduct += w * queryWeights[i]; });

    const cosine = (queryMag * docMag) === 0 ? 0 : dotProduct / (queryMag * docMag);

    const pr = prMap[doc.url] || 0;
    const normalizedPR = maxPR > 0 ? pr / maxPR : 0;

    // Boosted score
    const score = boost
      ? 0.7 * cosine + 0.3 * normalizedPR
      : cosine;

    return {
      url: doc.url,
      title: doc.title || "N/A",
      score,
      pr: pr
    };
  });

  // Sort by score descending; return exactly `limit` results
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}

function IDF(dfmap, docs, term) {
  return Math.log2(docs / (1 + (dfmap[term] || 0)));
}

function TF(terms, term) {
  return terms.filter(t => t === term).length / terms.length;
}