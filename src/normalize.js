export function normalizeUrl(href, baseUrl) {
  try {
    const u = new URL(href, baseUrl);
    u.hash = "";

    if (u.pathname.length > 1 && u.pathname.endsWith("/")) {
      u.pathname = u.pathname.slice(0, -1);
    }

    return u.toString();
  } catch {
    return null;
  }
}

export function sameHost(url, seedUrl) {
  try {
    return new URL(url).host === new URL(seedUrl).host;
  } catch {
    return false;
  }
}