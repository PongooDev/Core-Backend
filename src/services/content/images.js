import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { httpsProxied } from "../../network.js";

// Pictures for Battle Royale's lobby news (Core-Backend #215). From 1.9 each news.messages[] entry has an image, a URL
// the CMS cache (CMSURLCache.cpp) downloads with an ordinary HTTP request ("Unknown image URL protocol in URL (%s)"
// for anything but http://, https:// and file://). An image URL is fetched where it points (through the backend's
// tunnel to that host for a client on -httpproxy, imagehosts.js): a picture on another site is fetched from there, and
// one the admin panel uploaded is served here, at the address the client already reached this backend on for the content page (newsImageOrigin).
// The cache keeps the files named in the page's _images_ array (each element a URL string, AsString, 0x3969250 on 1.9)
// and deletes the rest of its CMS folder, so a picture shown is listed there too. It refuses to decode an image whose
// width * height * 4 is over 10,000,000 bytes ("Image is too large to safely display", 0x3968FF6), so an upload over
// maxNewsImagePixels is turned away. Epic's own lobby news pictures were 1024x512 JPEGs.
export const newsImagePath = "/content/api/news-images";
export const maxNewsImageBytes = 4 * 1024 * 1024;
export const maxNewsImagePixels = 2_500_000;
const maxImageUrlLength = 2048;

const types = { png: "image/png", jpg: "image/jpeg" };
const storedName = /^[0-9a-f]{32}\.(png|jpg)$/;

export const newsImageDir = (dataDir) => (dataDir ? path.join(dataDir, "news-images") : null);

// A stored upload's file name from a panel value ("/content/api/news-images/<name>"), or null for anything else.
export function storedImageName(value) {
  const text = String(value ?? "");
  if (!text.startsWith(`${newsImagePath}/`)) return null;
  const name = text.slice(newsImagePath.length + 1);
  return storedName.test(name) ? name : null;
}

// The image a news message may name: "" for none, an http(s):// URL, or an upload stored in dataDir. null when it is none
// of these.
export function newsImageValue(value, dataDir) {
  const text = String(value ?? "").trim();
  if (text === "") return "";
  const name = storedImageName(text);
  if (name) {
    const dir = newsImageDir(dataDir);
    return dir && fs.existsSync(path.join(dir, name)) ? text : null;
  }
  if (text.length > maxImageUrlLength || /\s/.test(text)) return null;
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname ? text : null;
  } catch {
    return null;
  }
}

// Width and height of a JPEG from its first frame header (SOF0-SOF15, but DHT, JPG and DAC).
function jpegSize(data) {
  let i = 2;
  while (i + 9 < data.length) {
    if (data[i] !== 0xff) return null;
    const marker = data[i + 1];
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: data.readUInt16BE(i + 5), width: data.readUInt16BE(i + 7) };
    }
    i += 2 + data.readUInt16BE(i + 2);
  }
  return null;
}

// What an uploaded file is, from its own bytes (not its name or a stated type): { ext, width, height } for a PNG or a
// JPEG, else null.
export function imageInfo(data) {
  if (!Buffer.isBuffer(data) || data.length < 24) return null;
  if (data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) && data.toString("latin1", 12, 16) === "IHDR") {
    return { ext: "png", width: data.readUInt32BE(16), height: data.readUInt32BE(20) };
  }
  if (data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    const size = jpegSize(data);
    return size ? { ext: "jpg", ...size } : null;
  }
  return null;
}

// Stores an upload under dataDir/news-images, named by its content's hash: { image } (the value the news takes) or
// { error }.
export function saveNewsImage(dataDir, data) {
  const dir = newsImageDir(dataDir);
  if (!dir) return { error: "The backend has no data folder to keep images in" };
  if (!Buffer.isBuffer(data) || data.length === 0) return { error: "The image is empty" };
  if (data.length > maxNewsImageBytes) return { error: `The image is over ${maxNewsImageBytes / 1024 / 1024} MB` };
  const info = imageInfo(data);
  if (!info) return { error: "Only PNG and JPEG images can be used" };
  if (!info.width || !info.height) return { error: "The image has no size" };
  if (info.width * info.height > maxNewsImagePixels) {
    return { error: `The image is ${info.width}x${info.height}; the game won't show one over ${maxNewsImagePixels.toLocaleString("en-US")} pixels (1024x512 is the usual size)` };
  }
  const name = `${crypto.createHash("sha256").update(data).digest("hex").slice(0, 32)}.${info.ext}`;
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  if (!fs.existsSync(file)) fs.writeFileSync(file, data);
  return { image: `${newsImagePath}/${name}`, width: info.width, height: info.height };
}

// Deletes the stored uploads no news uses any more.
export function pruneNewsImages(dataDir, keep = []) {
  const dir = newsImageDir(dataDir);
  if (!dir || !fs.existsSync(dir)) return;
  const kept = new Set(keep.map(storedImageName).filter(Boolean));
  for (const name of fs.readdirSync(dir)) {
    if (storedName.test(name) && !kept.has(name)) fs.rmSync(path.join(dir, name), { force: true });
  }
}

// Where the client that asked for the content page reaches this backend: the proxy's https host behind an https reverse
// proxy (network.js httpsProxied), else the Host it sent (the backend address it was given, or an Epic host on a client
// that uses the backend as its HTTP proxy) on the connection's own scheme.
export function newsImageOrigin(req) {
  const proxied = httpsProxied(req);
  if (proxied) return `https://${proxied.host}`;
  const host = String(req?.headers?.host ?? "").trim() || `127.0.0.1:${req?.socket?.localPort ?? 80}`;
  return `${req?.protocol === "https" ? "https" : "http"}://${host}`;
}

// The URL the client is handed for a news image: an upload under origin, another site's picture as it is.
export function newsImageUrl(value, origin) {
  const text = String(value ?? "");
  if (!text) return "";
  return storedImageName(text) ? `${origin ?? ""}${text}` : text;
}

// Serves the uploads to the game (and the admin panel's preview). Only names the store makes are served, so no other
// file under dataDir can be reached.
export function serveNewsImage(dataDir) {
  return (req, res) => {
    const name = String(req.params.name ?? "");
    const dir = newsImageDir(dataDir);
    const match = storedName.exec(name);
    const file = match && dir ? path.join(dir, name) : null;
    if (!file || !fs.existsSync(file)) return res.status(404).end();
    res.setHeader("Content-Type", types[match[1]]);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.send(fs.readFileSync(file));
  };
}
