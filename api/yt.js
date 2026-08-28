const BASE = "https://m.youtube.com";
const API = "https://m.youtube.com/youtubei/v1";
const ANDROID_VR_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
let config = null;

async function bootstrap(force = false) {
  if (config && !force) return config;
  const res = await fetch(`${BASE}/`, {
    headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
  });
  const html = await res.text();
  config = {
    key: html.match(/INNERTUBE_API_KEY":"([^"]+)"/)[1],
    version: html.match(/INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/)[1],
    visitorData: html.match(/visitorData":"([^"]+)"/)[1],
    gl: (html.match(/"GL":"([^"]+)"/) || [])[1] || "US",
  };
  return config;
}

async function youtubei(endpoint, payload) {
  const { key } = await bootstrap();
  const res = await fetch(`${API}/${endpoint}?key=${key}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: BASE },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
}

function mweb() {
  return { clientName: "MWEB", clientVersion: config.version, visitorData: config.visitorData, hl: "en", gl: config.gl };
}

function text(runs) { return (runs || []).map((r) => r.text).join("").trim(); }

function thumbnail(thumbnails) {
  if (!thumbnails || !thumbnails.length) return null;
  const sorted = [...thumbnails].sort((a, b) => (b.width || 0) - (a.width || 0));
  return sorted[0].url;
}

function findAll(obj, key, out = []) {
  if (!obj || typeof obj !== "object") return out;
  if (Array.isArray(obj)) {
    for (const item of obj) findAll(item, key, out);
    return out;
  }
  for (const [k, v] of Object.entries(obj)) {
    if (k === key) out.push(v);
    else findAll(v, key, out);
  }
  return out;
}

function collectItems(json) {
  const items = [];
  for (const section of findAll(json, "itemSectionRenderer")) {
    for (const item of section.contents || []) {
      const parsed = parseSearchItem(item);
      if (!parsed) continue;
      if (Array.isArray(parsed)) items.push(...parsed);
      else items.push(parsed);
    }
  }
  return items;
}

async function search(query, page = 1) {
  const payload = { context: { client: mweb() }, query };
  let json = await youtubei("search", payload);
  const items = collectItems(json);
  return { query, page, results: items };
}

function parseSearchItem(item) {
  if (item.videoWithContextRenderer) {
    const v = item.videoWithContextRenderer;
    return {
      type: "video",
      id: v.videoId,
      title: text(v.headline && v.headline.runs),
      channel: text(v.shortBylineText && v.shortBylineText.runs),
      views: text(v.shortViewCountText && v.shortViewCountText.runs),
      thumbnail: thumbnail(v.thumbnail && v.thumbnail.thumbnails),
    };
  }
  return null;
}

// Vercel Serverless Function Handler
export default async function handler(req, res) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Credentials', true);
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');

  const { action, q, id } = req.query;

  try {
    await bootstrap();
    
    if (action === "search") {
      const data = await search(q || "podcast indonesia", 1);
      return res.status(200).json(data);
    }
    
    // Default fallback jika tidak ada action
    return res.status(200).json({ message: "API is running. Use ?action=search&q=keyword" });

  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}
