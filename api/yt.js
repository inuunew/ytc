const BASE = "https://m.youtube.com";
const API = "https://m.youtube.com/youtubei/v1";
const ANDROID_VR_KEY = "AIzaSyA8eiZmM1FaDVjRy-df2KTyQ_vz_yYM39w";
const UA = "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
let config = null;

async function bootstrap(force = false) {
  if (config && !force) return config;
  try {
    const res = await fetch(`${BASE}/`, {
      headers: { "User-Agent": UA, "Accept-Language": "en-US,en;q=0.9" },
    });
    const html = await res.text();
    
    const keyMatch = html.match(/INNERTUBE_API_KEY":"([^"]+)"/);
    const verMatch = html.match(/INNERTUBE_CONTEXT_CLIENT_VERSION":"([^"]+)"/);
    const visMatch = html.match(/visitorData":"([^"]+)"/);
    const glMatch = html.match(/"GL":"([^"]+)"/);

    config = {
      key: keyMatch ? keyMatch[1] : ANDROID_VR_KEY,
      version: verMatch ? verMatch[1] : "2.20231201.00.00",
      visitorData: visMatch ? visMatch[1] : "",
      gl: glMatch ? glMatch[1] : "US",
    };
  } catch (err) {
    // Fallback default jika scrapping awal gagal
    config = {
      key: ANDROID_VR_KEY,
      version: "2.20231201.00.00",
      visitorData: "",
      gl: "US",
    };
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
  return { clientName: "MWEB", clientVersion: config.version || "2.20231201.00.00", visitorData: config.visitorData, hl: "en", gl: config.gl };
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

async function search(query) {
  const payload = { context: { client: mweb() }, query };
  let json = await youtubei("search", payload);
  return { query, results: collectItems(json) };
}

async function infoVideo(videoId) {
  const json = await youtubei("player", {
    context: { client: mweb() },
    videoId,
    contentCheckOk: true,
    racyCheckOk: true,
  });
  const vd = json.videoDetails || {};
  const mf = (json.microformat || {}).playerMicroformatRenderer || {};
  return {
    type: "video",
    id: vd.videoId,
    title: vd.title,
    description: vd.shortDescription,
    author: vd.author,
    viewCount: vd.viewCount,
    publishDate: mf.publishDate,
  };
}

async function related(videoId) {
  const json = await youtubei("next", { context: { client: mweb() }, videoId });
  return { videoId, results: collectItems(json) };
}

async function download(videoId) {
  const payload = {
    context: {
      client: { clientName: "ANDROID_VR", clientVersion: "1.58.24", androidSdkVersion: 30, hl: "en", gl: "US" },
    },
    videoId, contentCheckOk: true, racyCheckOk: true,
  };
  const res = await fetch(`${API}/player?key=${ANDROID_VR_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: BASE },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.streamingData) throw new Error("Streaming URL tidak tersedia.");
  
  const formats = [ ...(json.streamingData.formats || []), ...(json.streamingData.adaptiveFormats || []) ]
    .filter((f) => f.url)
    .map((f) => ({
      itag: f.itag,
      label: f.qualityLabel || f.audioQuality || "Format Direct",
      mimeType: f.mimeType,
      url: f.url,
    }));

  return { id: videoId, formats };
}

// Handler Vercel
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');

  const { action, q, id } = req.query;

  try {
    await bootstrap();
    if (action === "search") return res.status(200).json(await search(q || "Musik Indonesia"));
    if (action === "info") return res.status(200).json(await infoVideo(id));
    if (action === "related") return res.status(200).json(await related(id));
    if (action === "download") return res.status(200).json(await download(id));

    return res.status(400).json({ error: "Action tidak valid" });
  } catch (err) {
    return res.status(500).json({ error: err.message || "Internal Server Error" });
  }
}
