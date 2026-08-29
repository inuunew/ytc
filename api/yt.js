const BASE = "https://m.youtube.com";
const API = "https://m.youtube.com/youtubei/v1";
const ANDROID_VR_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
let config = null;

async function bootstrap(force = false) {
  if (config && !force) return config;
  try {
    const res = await fetch(`${BASE}/`, { headers: { "User-Agent": UA, "Accept-Language": "id-ID,id;q=0.9" } });
    const html = await res.text();
    const keyMatch = html.match(/INNERTUBE_API_KEY":"([^"]+)"/);
    const verMatch = html.match(/INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/);
    const visMatch = html.match(/visitorData":"([^"]+)"/);
    config = {
      key: keyMatch ? keyMatch[1] : ANDROID_VR_KEY,
      version: verMatch ? verMatch[1] : "2.20231201.00.00",
      visitorData: visMatch ? visMatch[1] : "",
      gl: "ID",
    };
  } catch (err) {
    config = { key: ANDROID_VR_KEY, version: "2.20231201.00.00", visitorData: "", gl: "ID" };
  }
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
  return { clientName: "MWEB", clientVersion: config.version, visitorData: config.visitorData, hl: "id", gl: config.gl };
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
  // Parsing Video Biasa (Pencarian & Halaman Beranda)
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
  // Parsing Video Terkait (Sidebar Halaman Tonton)
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
  // Parsing Shorts (Untuk Halaman Shorts)
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

function collect(json, key = "itemSectionRenderer") {
  const items = [];
  for (const section of findAll(json, key)) {
    for (const item of section.contents || []) {
      const parsed = parseItem(item);
      if (parsed) items.push(parsed);
    }
  }
  return items;
}

async function search(query) {
  const json = await youtubei("search", { context: { client: mweb() }, query });
  return { results: collect(json) };
}

async function getShorts() {
  // Query unik untuk memancing Shorts dari Indonesia
  const json = await youtubei("search", { context: { client: mweb() }, query: "Shorts indonesia viral terbaru" });
  // Cari semua format reelItemRenderer dari hasil pencarian rak-rak Shorts
  const shorts = findAll(json, "reelItemRenderer").map(v => parseItem({ reelItemRenderer: v })).filter(i => i !== null);
  return { results: shorts };
}

async function related(videoId) {
  const json = await youtubei("next", { context: { client: mweb() }, videoId });
  return { results: collect(json) };
}

async function infoVideo(videoId) {
  const json = await youtubei("next", { context: { client: mweb() }, videoId });
  const vd = json.videoDetails || {};
  let title = vd.title;
  if (!title) {
    const slim = findAll(json, "slimVideoInformationRenderer");
    if (slim.length > 0) title = text(slim[0].title?.runs);
  }
  return { id: videoId, title: title || "Memutar Video..." };
}

// Handler Vercel Endpoint
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { action, q, id } = req.query;

  try {
    await bootstrap();
    if (action === "search") return res.status(200).json(await search(q || "Musik Pop Indonesia"));
    if (action === "shorts") return res.status(200).json(await getShorts());
    if (action === "info") return res.status(200).json(await infoVideo(id));
    if (action === "related") return res.status(200).json(await related(id));

    return res.status(400).json({ error: "Action tidak valid" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
