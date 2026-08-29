const BASE = "https://m.youtube.com";
const API = "https://m.youtube.com/youtubei/v1";
// Menggunakan API Key default yang ringan dan stabil
const ANDROID_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Client Config statis agar tidak perlu scraping yang membuat lag
const mwebContext = {
  client: { 
    clientName: "WEB", 
    clientVersion: "2.20231201.00.00", 
    hl: "id", 
    gl: "ID" 
  }
};

async function youtubei(endpoint, payload) {
  const res = await fetch(`${API}/${endpoint}?key=${ANDROID_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: "https://www.youtube.com" },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message);
  return json;
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

function parseItem(item) {
  if (item.videoWithContextRenderer || item.videoRenderer) {
    const v = item.videoWithContextRenderer || item.videoRenderer;
    return {
      type: "video",
      id: v.videoId,
      title: v.headline ? text(v.headline.runs) : (v.title ? (v.title.simpleText || text(v.title.runs)) : ""),
      channel: text(v.shortBylineText && v.shortBylineText.runs) || text(v.ownerText && v.ownerText.runs),
      views: v.shortViewCountText ? text(v.shortViewCountText.runs) : (v.viewCountText ? text(v.viewCountText.runs) : ""),
      publishTime: v.publishedTimeText ? (v.publishedTimeText.simpleText || text(v.publishedTimeText.runs)) : "",
      duration: v.lengthText ? (v.lengthText.simpleText || text(v.lengthText.runs)) : "",
      thumbnail: thumbnail(v.thumbnail && v.thumbnail.thumbnails),
    };
  }
  if (item.compactVideoRenderer) {
    const v = item.compactVideoRenderer;
    return {
      type: "video",
      id: v.videoId,
      title: v.title ? (v.title.simpleText || text(v.title.runs)) : "",
      channel: text(v.shortBylineText && v.shortBylineText.runs) || text(v.longBylineText && v.longBylineText.runs),
      views: v.viewCountText ? (v.viewCountText.simpleText || text(v.viewCountText.runs)) : "",
      publishTime: v.publishedTimeText ? (v.publishedTimeText.simpleText || text(v.publishedTimeText.runs)) : "",
      duration: v.lengthText ? (v.lengthText.simpleText || text(v.lengthText.runs)) : "",
      thumbnail: thumbnail(v.thumbnail && v.thumbnail.thumbnails),
    };
  }
  if (item.reelItemRenderer) {
    const v = item.reelItemRenderer;
    return {
      type: "short",
      id: v.videoId,
      title: v.headline ? v.headline.simpleText : "",
      views: v.viewCountText ? v.viewCountText.simpleText : "",
      thumbnail: thumbnail(v.thumbnail && v.thumbnail.thumbnails)
    };
  }
  return null;
}

function collect(json, targetKey = "itemSectionRenderer") {
  const items = [];
  for (const section of findAll(json, targetKey)) {
    for (const item of section.contents || []) {
      const parsed = parseItem(item);
      if (parsed) items.push(parsed);
    }
  }
  return items;
}

// Handler Vercel
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { action, q, id } = req.query;

  try {
    if (action === "search") {
      const json = await youtubei("search", { context: mwebContext, query: q || "Musik Pop Indonesia" });
      return res.status(200).json({ results: collect(json) });
    }
    
    if (action === "shorts") {
      // Menggunakan hashtag untuk memaksa YT mengeluarkan Shorts
      const json = await youtubei("search", { context: mwebContext, query: "#shorts viral indonesia" });
      // Menarik paksa semua reelItemRenderer di manapun lokasinya di dalam JSON
      const shortsNodes = findAll(json, "reelItemRenderer");
      const shorts = shortsNodes.map(v => parseItem({ reelItemRenderer: v })).filter(i => i !== null);
      return res.status(200).json({ results: shorts });
    }
    
    if (action === "related") {
      const json = await youtubei("next", { context: mwebContext, videoId: id });
      return res.status(200).json({ results: collect(json) });
    }

    return res.status(400).json({ error: "Action tidak valid" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
