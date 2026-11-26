import fs from "node:fs";
import path from "node:path";
import { Readable, pipeline } from "node:stream";
import zlib from "node:zlib";

// The data folder's state as one .tar.gz (Core-Backend #438): what the admin panel's Export and Back up now write and its
// Import and Restore read. Node's zlib is the only dependency; the tar is the plain ustar format, written and read here.
// The reader accepts only what the writer makes: regular files and folders under the state paths below, never links.

// What is state. The rest of the data folder is logs (logs/), the login tokens (tokens.json: every sign-in ends with a
// restore, on purpose), the backups themselves (backups/) and files the stores are writing (*.tmp).
export const stateFolders = ["accounts", "creative", "creators", "news-images", "reports"];
export const stateFiles = ["admin-users.json", "bans.json", "friendcodes.json", "network.json", "purchasecodes.json", "settings.json", "tournaments.json", "unvaulting.json", "vivox.json"];
// The local HTTPS certificate and its private key (tls/certificates.js): only with the admin's say so.
export const tlsFolder = "tls";
export const manifestName = "core-backup.json";
export const archiveFormat = 1;

export const maxPathLength = 255;
export const limits = {
  // The upload, as sent (gzipped).
  uploadBytes: 1024 ** 3,
  // Everything the archive holds, unpacked: a gzip bomb is stopped here.
  expandedBytes: 4 * 1024 ** 3,
  entries: 1_000_000
};

export class ArchiveError extends Error {}

const block = 512;
const segmentPattern = /^[A-Za-z0-9._@+=, -]+$/;

// The parts of a relative path in the archive, or null when it isn't a safe one. Rejects absolute and drive paths, "..",
// ".", empty parts, backslashes, NUL and anything outside segmentPattern.
export function safeParts(name) {
  if (typeof name !== "string" || !name || name.length > maxPathLength) return null;
  const parts = name.replace(/\/$/, "").split("/");
  for (const part of parts) {
    if (!part || part === "." || part === ".." || !segmentPattern.test(part) || /[ .]$/.test(part)) return null;
  }
  return parts;
}

// "state", "tls", "manifest" or null (not part of an archive) for a path's parts.
export function kindOfParts(parts, isDirectory) {
  const [top] = parts;
  if (parts.length === 1 && !isDirectory && (stateFiles.includes(top) || top === manifestName)) return top === manifestName ? "manifest" : "state";
  if (stateFolders.includes(top) && (parts.length > 1 || isDirectory)) return "state";
  if (top === tlsFolder && (parts.length > 1 || isDirectory)) return "tls";
  return null;
}

function* walk(root, relative = []) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, ...relative), { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (entry.isSymbolicLink() || entry.name.endsWith(".tmp")) continue;
    const parts = [...relative, entry.name];
    if (entry.isDirectory()) yield* walk(root, parts);
    else if (entry.isFile()) yield parts;
  }
}

// The files an archive of the data folder holds: [{ name, file }].
export function stateFilesOf(dataDir, { tls = false } = {}) {
  const found = [];
  for (const name of stateFiles) if (fs.existsSync(path.join(dataDir, name))) found.push([name]);
  for (const folder of [...stateFolders, ...(tls ? [tlsFolder] : [])]) found.push(...walk(dataDir, [folder]));
  return found.map((parts) => ({ name: parts.join("/"), file: path.join(dataDir, ...parts) }))
    .filter(({ name }) => {
      const parts = safeParts(name);
      return parts && kindOfParts(parts, false);
    });
}

const octal = (value, length) => `${value.toString(8).padStart(length - 1, "0")}\0`;

function header(name, size, mtime) {
  let prefix = "";
  let rest = name;
  if (Buffer.byteLength(name) > 100) {
    let at = -1;
    for (let i = 0; i < name.length; i++) if (name[i] === "/" && i <= 155 && name.length - i - 1 <= 100) at = i;
    if (at < 0) throw new ArchiveError(`${name} is too long for the archive`);
    prefix = name.slice(0, at);
    rest = name.slice(at + 1);
  }
  const buffer = Buffer.alloc(block);
  buffer.write(rest, 0, 100);
  buffer.write(octal(0o644, 8), 100);
  buffer.write(octal(0, 8), 108);
  buffer.write(octal(0, 8), 116);
  buffer.write(octal(size, 12), 124);
  buffer.write(octal(Math.floor(mtime / 1000), 12), 136);
  buffer.write("        ", 148);
  buffer.write("0", 156);
  buffer.write("ustar\0", 257);
  buffer.write("00", 263);
  buffer.write(prefix, 345, 155);
  let sum = 0;
  for (const byte of buffer) sum += byte;
  buffer.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  return buffer;
}

function* tarBlocks(dataDir, options, now) {
  const files = stateFilesOf(dataDir, options);
  const manifest = Buffer.from(JSON.stringify({ format: archiveFormat, app: "Core-Backend", created: now.toISOString(), tls: Boolean(options.tls), files: files.length }));
  yield header(manifestName, manifest.length, now.getTime());
  yield manifest;
  yield Buffer.alloc((block - (manifest.length % block)) % block);
  for (const { name, file } of files) {
    let contents;
    let mtime;
    try {
      contents = fs.readFileSync(file);
      mtime = fs.statSync(file).mtimeMs;
    } catch {
      continue; // deleted while the archive was made
    }
    yield header(name, contents.length, mtime);
    yield contents;
    yield Buffer.alloc((block - (contents.length % block)) % block);
  }
  yield Buffer.alloc(block * 2);
}

// A readable stream of the .tar.gz of the data folder's state; pipe it to a response or a file.
export function createArchiveStream(dataDir, options = {}, now = new Date()) {
  const gzip = zlib.createGzip();
  pipeline(Readable.from(tarBlocks(dataDir, options, now)), gzip, () => {});
  return gzip;
}

// Pulls exact byte counts from a stream of chunks.
class ChunkReader {
  constructor(stream, expandedLimit) {
    this.iterator = stream[Symbol.asyncIterator]();
    this.buffer = Buffer.alloc(0);
    this.ended = false;
    this.total = 0;
    this.expandedLimit = expandedLimit;
  }

  async fill(want) {
    while (this.buffer.length < want && !this.ended) {
      const { value, done } = await this.iterator.next();
      if (done) {
        this.ended = true;
      } else {
        this.total += value.length;
        if (this.total > this.expandedLimit) throw new ArchiveError("The archive is larger than allowed once unpacked");
        this.buffer = this.buffer.length ? Buffer.concat([this.buffer, value]) : value;
      }
    }
  }

  async take(count) {
    await this.fill(count);
    if (this.buffer.length < count) throw new ArchiveError("The archive ends early");
    const out = this.buffer.subarray(0, count);
    this.buffer = this.buffer.subarray(count);
    return out;
  }

  async takeUpTo(count) {
    await this.fill(1);
    if (!this.buffer.length) throw new ArchiveError("The archive ends early");
    return this.take(Math.min(count, this.buffer.length));
  }
}

const text = (buffer, from, length) => {
  const slice = buffer.subarray(from, from + length);
  const end = slice.indexOf(0);
  return slice.subarray(0, end < 0 ? slice.length : end).toString("utf8");
};

function parseHeader(buffer) {
  const stored = parseInt(text(buffer, 148, 8).trim() || "x", 8);
  let sum = 0;
  for (let i = 0; i < block; i++) sum += i >= 148 && i < 156 ? 32 : buffer[i];
  if (stored !== sum) throw new ArchiveError("Not a Core backup archive (a damaged tar header)");
  if (buffer[124] & 0x80) throw new ArchiveError("An archive entry has an unsupported size");
  const sizeText = text(buffer, 124, 12).trim();
  if (!/^[0-7]+$/.test(sizeText)) throw new ArchiveError("An archive entry has an unreadable size");
  const prefix = text(buffer, 345, 155);
  const name = text(buffer, 0, 100);
  return { name: prefix ? `${prefix}/${name}` : name, size: parseInt(sizeText, 8), type: String.fromCharCode(buffer[156] || 48) };
}

// Unpacks the archive at `archiveFile` into the empty folder `target`, checking every entry first. Throws an ArchiveError
// (the target is left for the caller to remove) for: a path outside the state paths, an absolute or ".." path, a symlink,
// hard link or device, a duplicate, a missing or unknown manifest, or more than the limits. tls/ entries are skipped unless
// allowTls. Returns { files, bytes, tls, created } (tls: a tls folder was in the archive and unpacked).
export async function unpackArchive(archiveFile, target, { allowTls = false, expandedBytes = limits.expandedBytes, entries: maxEntries = limits.entries } = {}) {
  const input = fs.createReadStream(archiveFile);
  const gunzip = zlib.createGunzip();
  pipeline(input, gunzip, () => {});
  const reader = new ChunkReader(gunzip, expandedBytes);
  const seen = new Set();
  const root = path.resolve(target);
  let files = 0;
  let bytes = 0;
  let tls = false;
  let manifest = null;
  try {
    for (let count = 0; ; count++) {
      let head;
      try {
        head = await reader.take(block);
      } catch (error) {
        if (count === 0 && error instanceof ArchiveError) throw new ArchiveError("Not a gzip-compressed tar archive");
        throw error instanceof ArchiveError ? error : new ArchiveError("Not a gzip-compressed tar archive");
      }
      if (head.every((byte) => byte === 0)) break;
      if (count >= maxEntries) throw new ArchiveError("The archive has too many entries");
      const entry = parseHeader(head);
      const isDirectory = entry.type === "5";
      if (entry.type !== "0" && !isDirectory) {
        throw new ArchiveError(`${entry.name}: ${entry.type === "2" || entry.type === "1" ? "links are not allowed" : "only files and folders are allowed"}`);
      }
      const parts = safeParts(entry.name);
      if (!parts) throw new ArchiveError(`${JSON.stringify(entry.name)} is not an allowed path`);
      const kind = kindOfParts(parts, isDirectory);
      if (!kind) throw new ArchiveError(`${entry.name} is not something a Core backup holds`);
      const key = parts.join("/").toLowerCase();
      if (seen.has(key)) throw new ArchiveError(`${entry.name} is in the archive twice`);
      seen.add(key);
      const padded = Math.ceil(entry.size / block) * block;
      if (kind === "manifest") {
        if (isDirectory || entry.size > 65536) throw new ArchiveError("The archive's manifest is not valid");
        const body = await reader.take(padded);
        try {
          manifest = JSON.parse(body.subarray(0, entry.size).toString("utf8"));
        } catch {
          throw new ArchiveError("The archive's manifest is not valid");
        }
        continue;
      }
      if (isDirectory) {
        if (entry.size) throw new ArchiveError(`${entry.name}: a folder with data`);
        continue;
      }
      const skip = kind === "tls" && !allowTls;
      const destination = path.resolve(root, ...parts);
      if (!skip && !destination.startsWith(root + path.sep)) throw new ArchiveError(`${entry.name} leaves the data folder`);
      if (!skip) fs.mkdirSync(path.dirname(destination), { recursive: true });
      const fd = skip ? null : fs.openSync(destination, "wx");
      try {
        for (let left = entry.size; left > 0;) {
          const chunk = await reader.takeUpTo(left);
          left -= chunk.length;
          if (fd !== null) fs.writeSync(fd, chunk);
        }
        await reader.take(padded - entry.size);
      } finally {
        if (fd !== null) fs.closeSync(fd);
      }
      if (!skip) {
        files++;
        bytes += entry.size;
        if (kind === "tls") tls = true;
      }
    }
  } catch (error) {
    if (error instanceof ArchiveError) throw error;
    // zlib's own errors (not gzip, truncated, corrupt) and anything else the stream raised while reading.
    throw new ArchiveError(`The file can't be read as a Core backup (${error.code ?? error.message})`);
  } finally {
    gunzip.destroy();
    input.destroy();
  }
  if (!manifest || manifest.format !== archiveFormat || manifest.app !== "Core-Backend") throw new ArchiveError("Not a Core backup archive (no manifest)");
  return { files, bytes, tls, created: typeof manifest.created === "string" ? manifest.created : null };
}
