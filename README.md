# COMP 4601A – Winter 2026 – Assignment #1

## Names

- Jamal Ismail (101240366)
- Evan Hall (202224133)
- Sulaiman Kamara (101284058)

## Completion Summary

All parts of the assignment have been completed successfully.

## Video Demonstration

https://youtu.be/-yaYunOf_yk

## URLs for TA to Query Search Engine

**OpenStack instance:** `http://134.117.134.57:3000`

### Browser-based client

- **Client UI:** http://134.117.134.57:3000/client.html

### Fruits dataset (`/fruitsA`)

- **Example search:** http://134.117.134.57:3000/fruitsA?q=apple&boost=false&limit=10
- **With PageRank boost:** http://134.117.134.57:3000/fruitsA?q=banana&boost=true&limit=10

### Personal dataset (`/personal`)

- **Example search:** http://134.117.134.57:3000/personal?q=book&boost=false&limit=10
- **With PageRank boost:** http://134.117.134.57:3000/personal?q=fiction&boost=true&limit=10

**Query parameters:**

- `q` – search query (required)
- `boost` – `true` or `false` (optional, defaults to false)
- `limit` – number of results, 1–50 (optional, defaults to 10)
