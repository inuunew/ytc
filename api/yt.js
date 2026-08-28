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
  if (item.gridShelfViewModel) {
    return findAll(item.gridShelfViewModel, "shortsLockupViewModel").map(parseShort);
  }
  return null;
}

function parseShort(s) {
  const reel = s.onTap && s.onTap.innertubeCommand && s.onTap.innertubeCommand.reelWatchEndpoint;
  return {
    type: "short",
    id: reel && reel.videoId,
    title: s.accessibilityText ? s.accessibilityText.split(", ")[0] : null,
    thumbnail: thumbnail(s.thumbnail && s.thumbnail.sources),
  };
}

async function search(query, page = 1) {
  const payload = { context: { client: mweb() }, query };
  let json = await youtubei("search", payload);
  const items = collectItems(json);
  return { query, page, results: items };
}

function detectType(id) {
  if (!id || typeof id !== "string") return "unknown";
  if (/^UC[\w-]{22}$/.test(id)) return "channel";
  if (/^RDAM/.test(id)) return "mix";
  if (/^(PL|UU|FL|OLAK5uy_)/.test(id)) return "playlist";
  if (/^[\w-]{11}$/.test(id)) return "video";
  return "unknown";
}

async function info(id) {
  switch (detectType(id)) {
    case "video": return infoVideo(id);
    case "channel": return infoChannel(id);
    default: return infoVideo(id);
  }
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
    channelId: vd.channelId,
    durationSeconds: Number(vd.lengthSeconds) || 0,
    viewCount: vd.viewCount,
    keywords: vd.keywords || [],
    publishDate: mf.publishDate,
    uploadDate: mf.uploadDate,
    thumbnail: thumbnail(vd.thumbnail && vd.thumbnail.thumbnails),
  };
}

async function infoChannel(id) {
  const json = await youtubei("browse", { context: { client: mweb() }, browseId: id });
  const meta = findAll(json, "channelMetadataRenderer")[0] || {};
  return {
    type: "channel",
    id,
    title: meta.title || null,
    description: meta.description || null,
    avatar: thumbnail(meta.avatar && meta.avatar.thumbnails),
  };
}

async function related(videoId) {
  const json = await youtubei("next", { context: { client: mweb() }, videoId });
  return { videoId, results: collectItems(json) };
}

async function download(videoId) {
  const payload = {
    context: {
      client: { clientName: "ANDROID_VR", clientVersion: "1.58.24", androidSdkVersion: 30, hl: "en", gl: config.gl },
    },
    videoId, contentCheckOk: true, racyCheckOk: true,
  };
  const res = await fetch(`${API}/player?key=${ANDROID_VR_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: BASE, "X-Goog-Visitor-Id": config.visitorData },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.streamingData) throw new Error("Streaming URL tidak tersedia.");
  
  const label = (f) => {
    const codec = (f.mimeType || "").split(";")[0];
    const quality = f.width ? `${f.width}x${f.height}` : f.audioQuality || "";
    return `${codec}${quality ? " " + quality : ""}`;
  };
  
  const formats = [ ...(json.streamingData.formats || []), ...(json.streamingData.adaptiveFormats || []) ]
    .filter((f) => f.url)
    .map((f) => ({
      itag: f.itag,
      label: label(f),
      mimeType: f.mimeType,
      url: f.url,
    }));

  return { id: videoId, title: json.videoDetails?.title, formats };
}

// Handler Vercel Serverless
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { action, q, id } = req.query;

  try {
    await bootstrap();
    if (action === "search") return res.status(200).json(await search(q || "Trending Indonesia"));
    if (action === "info") return res.status(200).json(await info(id));
    if (action === "related") return res.status(200).json(await related(id));
    if (action === "download") return res.status(200).json(await download(id));

    return res.status(200).json({ error: "Action tidak valid" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
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
  if (item.gridShelfViewModel) {
    return findAll(item.gridShelfViewModel, "shortsLockupViewModel").map(parseShort);
  }
  return null;
}

function parseShort(s) {
  const reel = s.onTap && s.onTap.innertubeCommand && s.onTap.innertubeCommand.reelWatchEndpoint;
  return {
    type: "short",
    id: reel && reel.videoId,
    title: s.accessibilityText ? s.accessibilityText.split(", ")[0] : null,
    thumbnail: thumbnail(s.thumbnail && s.thumbnail.sources),
  };
}

async function search(query, page = 1) {
  const payload = { context: { client: mweb() }, query };
  let json = await youtubei("search", payload);
  const items = collectItems(json);
  return { query, page, results: items };
}

function detectType(id) {
  if (!id || typeof id !== "string") return "unknown";
  if (/^UC[\w-]{22}$/.test(id)) return "channel";
  if (/^RDAM/.test(id)) return "mix";
  if (/^(PL|UU|FL|OLAK5uy_)/.test(id)) return "playlist";
  if (/^[\w-]{11}$/.test(id)) return "video";
  return "unknown";
}

async function info(id) {
  switch (detectType(id)) {
    case "video": return infoVideo(id);
    case "channel": return infoChannel(id);
    default: return infoVideo(id);
  }
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
    channelId: vd.channelId,
    durationSeconds: Number(vd.lengthSeconds) || 0,
    viewCount: vd.viewCount,
    keywords: vd.keywords || [],
    publishDate: mf.publishDate,
    uploadDate: mf.uploadDate,
    thumbnail: thumbnail(vd.thumbnail && vd.thumbnail.thumbnails),
  };
}

async function infoChannel(id) {
  const json = await youtubei("browse", { context: { client: mweb() }, browseId: id });
  const meta = findAll(json, "channelMetadataRenderer")[0] || {};
  return {
    type: "channel",
    id,
    title: meta.title || null,
    description: meta.description || null,
    avatar: thumbnail(meta.avatar && meta.avatar.thumbnails),
  };
}

async function related(videoId) {
  const json = await youtubei("next", { context: { client: mweb() }, videoId });
  return { videoId, results: collectItems(json) };
}

async function download(videoId) {
  const payload = {
    context: {
      client: { clientName: "ANDROID_VR", clientVersion: "1.58.24", androidSdkVersion: 30, hl: "en", gl: config.gl },
    },
    videoId, contentCheckOk: true, racyCheckOk: true,
  };
  const res = await fetch(`${API}/player?key=${ANDROID_VR_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA, Origin: BASE, "X-Goog-Visitor-Id": config.visitorData },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.streamingData) throw new Error("Streaming URL tidak tersedia.");
  
  const label = (f) => {
    const codec = (f.mimeType || "").split(";")[0];
    const quality = f.width ? `${f.width}x${f.height}` : f.audioQuality || "";
    return `${codec}${quality ? " " + quality : ""}`;
  };
  
  const formats = [ ...(json.streamingData.formats || []), ...(json.streamingData.adaptiveFormats || []) ]
    .filter((f) => f.url)
    .map((f) => ({
      itag: f.itag,
      label: label(f),
      mimeType: f.mimeType,
      url: f.url,
    }));

  return { id: videoId, title: json.videoDetails?.title, formats };
}

// Handler Vercel Serverless
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const { action, q, id } = req.query;

  try {
    await bootstrap();
    if (action === "search") return res.status(200).json(await search(q || "Trending Indonesia"));
    if (action === "info") return res.status(200).json(await info(id));
    if (action === "related") return res.status(200).json(await related(id));
    if (action === "download") return res.status(200).json(await download(id));

    return res.status(200).json({ error: "Action tidak valid" });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
