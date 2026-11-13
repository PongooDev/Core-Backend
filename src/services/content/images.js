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

// How each build draws the news picture, read from its own widgets (Core-Backend #343), for the admin panel to show next to
// the upload. The CMS image (UEpicCMSImage) makes its brush the downloaded picture's own width and height (6.10 sub_396DA0),
// so a slot only has a size where the widget gives it one.
// - Before 1.9 the news box reads news.message, title and body alone (pages.js).
// - 1.9 to 5.21: UFortAthenaNewsWidget's three entries (AthenaNews Image1..3, EpicCMSImage). Each picture sits in an
//   auto-sized HorizontalBoxSlot (HAlign_Left, VAlign_Center, 8 right padding) left of its title and body, with no brush size,
//   SizeBox or ScaleBox of its own, so it is drawn at its own size. AthenaNewsModal holds the entries in a ScrollBox inside a
//   SizeBox 920 wide. Read from 2.4.2's, 3.0's and 3.5's paks. No pak of 1.9 to 2.2 or 3.6 to 5.21 is on hand: their exes
//   have the same widget class and no news tile class.
// - 5.30 to 6.21: UFortAthenaNewsTile, which 5.30's exe is the first to have (5.21's has none). AthenaNewsTile's
//   CMSImage_NewsImage has a 1024x512 brush on T_Athena_Tile_Matchmaking_Default (1024x512 DXT1, the picture SetDefaultImage
//   shows for a message without one), in a ScaleBox (ScaleToFitX) inside SizeBox_Tile (560 wide). The spotlight and special
//   event tiles have the same 1024x512 brush. The tile scales a picture to its width and keeps its shape. Read from 6.02's,
//   6.20's and 6.21's paks; 6.10's tile code (sub_2EB8270: title, body, adSpace, then the CMS image or SetDefaultImage) is
//   theirs. Epic's own news picture from 4.2 (BR04_MOTD_Shield-1024x512) was 1024x512 too.
export const newsImageSizes = [
  { builds: "1.1 to 1.8.2", size: "No picture", shows: "The lobby news box shows the title and body only (from 1.7.2)." },
  { builds: "1.9 to 3.5", size: "Its own size", shows: "Drawn at its own pixel size, left of the title and body, in a news column 920 pixels wide. A 1024x512 picture is wider than the column; a small one fits." },
  { builds: "3.6 to 5.21", size: "Not read", shows: "These builds' widgets aren't on hand to read. They use 1.9's news widget, not the later tile; Epic's own news picture in 4.2 was 1024x512." },
  { builds: "5.30 to 6.21", size: "1024x512", width: 1024, height: 512, shows: "The news tile's picture slot (2:1). The tile scales the picture to its width and keeps its shape, so a 2:1 picture fills the slot as Epic's did." }
];
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
