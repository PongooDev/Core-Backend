import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import zlib from "node:zlib";
import { ArchiveError, createArchiveStream, manifestName, unpackArchive } from "../src/backup/archive.js";
import { applyPendingRestore, createBackupService, pendingFolder } from "../src/backup/service.js";
import { get, startBackend } from "./helpers.js";

// Core-Backend #438: the data folder's export, import, backups and automatic backups.
const temp = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-backup-test-"));
const put = (root, name, text) => {
  fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
  fs.writeFileSync(path.join(root, name), text);
};
const longName = "accounts/0123456789abcdef0123456789abcdef/creative/islands/0123456789abcdef0123456789abcdef.checkpoint.island.json";

function sampleData(root) {
  put(root, "settings.json", "{\"a\":1}");
  put(root, "bans.json", "[]");
  put(root, "accounts/abc/account.json", "{\"id\":\"abc\"}");
  put(root, "accounts/abc/profiles/athena.json", "{\"rvn\":3}");
  put(root, longName, "island".repeat(500));
  put(root, "accounts/abc/profiles/athena.json.tmp", "half written");
  put(root, "creative/public/abc/1234-5678-9012/1.island", "x");
  put(root, "logs/unknown/1.jsonl", "log");
  put(root, "tokens.json", "{\"access\":[]}");
  put(root, "tls/key.pem", "PRIVATE");
  put(root, "backups/old.tar.gz", "older backup");
}

async function archiveOf(root, file, options) {
  await pipeline(createArchiveStream(root, options), fs.createWriteStream(file));
}

const listFiles = (root, base = root) => fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
  ? listFiles(path.join(root, entry.name), base) : [path.relative(base, path.join(root, entry.name)).replaceAll("\\", "/")])).sort();

// A tar file made by hand, to build archives the exporter never would.
function tar(entries, { manifest = true } = {}) {
  const parts = [];
  const add = ({ name, type = "0", data = Buffer.alloc(0), size = data.length }) => {
    const header = Buffer.alloc(512);
    header.write(name, 0, 100);
    header.write("0000644\0", 100);
    header.write(`${size.toString(8).padStart(11, "0")}\0`, 124);
    header.write("        ", 148);
    header.write(type, 156);
    header.write("ustar\0" + "00", 257);
    let sum = 0;
    for (const byte of header) sum += byte;
    header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
    parts.push(header, data, Buffer.alloc((512 - (data.length % 512)) % 512));
  };
  if (manifest) add({ name: manifestName, data: Buffer.from(JSON.stringify({ format: 1, app: "Core-Backend", created: new Date().toISOString() })) });
  for (const entry of entries) add(entry);
  parts.push(Buffer.alloc(1024));
  return zlib.gzipSync(Buffer.concat(parts));
}

async function unpackBytes(root, bytes, options) {
  const file = path.join(root, "in.tar.gz");
  const target = path.join(root, "out");
  fs.writeFileSync(file, bytes);
  fs.mkdirSync(target);
  return unpackArchive(file, target, options).then((result) => ({ result, target }));
}

test("an export unpacks to the state files, without logs, tokens, backups, temp files or (by default) the TLS key", async () => {
  const root = temp();
  try {
    sampleData(path.join(root, "data"));
    const file = path.join(root, "export.tar.gz");
    await archiveOf(path.join(root, "data"), file, {});
    const target = path.join(root, "out");
    fs.mkdirSync(target);
    const result = await unpackArchive(file, target, { allowTls: true });
    assert.deepEqual(listFiles(target), [
      "accounts/abc/account.json", "accounts/abc/profiles/athena.json", longName, "bans.json", "creative/public/abc/1234-5678-9012/1.island", "settings.json"
    ].sort());
    assert.equal(result.files, 6);
    assert.equal(result.tls, false);
    assert.equal(fs.readFileSync(path.join(target, longName), "utf8"), "island".repeat(500));
    assert.equal(fs.readFileSync(path.join(target, "settings.json"), "utf8"), "{\"a\":1}");

    // With the key: it is in the archive, and an import only takes it when asked to.
    await archiveOf(path.join(root, "data"), file, { tls: true });
    const withoutKey = path.join(root, "out2");
    fs.mkdirSync(withoutKey);
    assert.equal((await unpackArchive(file, withoutKey)).tls, false);
    assert.equal(fs.existsSync(path.join(withoutKey, "tls")), false);
    const withKey = path.join(root, "out3");
    fs.mkdirSync(withKey);
    assert.equal((await unpackArchive(file, withKey, { allowTls: true })).tls, true);
    assert.equal(fs.readFileSync(path.join(withKey, "tls/key.pem"), "utf8"), "PRIVATE");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an archive with a traversal, absolute, link, foreign or duplicate path is refused, and nothing leaves the target", async () => {
  const root = temp();
  try {
    const bad = {
      "a ../ path": [{ name: "accounts/../../evil.json", data: Buffer.from("x") }],
      "a leading ..": [{ name: "../evil.json", data: Buffer.from("x") }],
      "an absolute path": [{ name: "/etc/evil.json", data: Buffer.from("x") }],
      "a drive path": [{ name: "C:/evil.json", data: Buffer.from("x") }],
      "a backslash path": [{ name: "accounts\\abc\\evil.json", data: Buffer.from("x") }],
      "a symlink": [{ name: "accounts/link", type: "2" }],
      "a hard link": [{ name: "accounts/link", type: "1" }],
      "a path outside the state paths": [{ name: "logs/evil.log", data: Buffer.from("x") }],
      "tokens.json": [{ name: "tokens.json", data: Buffer.from("x") }],
      "a duplicate": [{ name: "settings.json", data: Buffer.from("x") }, { name: "settings.json", data: Buffer.from("y") }]
    };
    for (const [what, entries] of Object.entries(bad)) {
      const dir = fs.mkdtempSync(path.join(root, "case-"));
      await assert.rejects(unpackBytes(dir, tar(entries)), ArchiveError, what);
      assert.equal(fs.existsSync(path.join(dir, "evil.json")), false, what);
      assert.equal(fs.existsSync(path.join(root, "evil.json")), false, what);
    }
    const dir = fs.mkdtempSync(path.join(root, "case-"));
    await assert.rejects(unpackBytes(dir, tar([{ name: "settings.json", data: Buffer.from("x") }], { manifest: false })), /no manifest/);
    await assert.rejects(unpackBytes(fs.mkdtempSync(path.join(root, "case-")), Buffer.from("not an archive at all")), ArchiveError);
    await assert.rejects(unpackBytes(fs.mkdtempSync(path.join(root, "case-")), zlib.gzipSync(Buffer.from("not a tar"))), ArchiveError);
    // The size limit stops a bomb while it unpacks.
    await assert.rejects(unpackBytes(fs.mkdtempSync(path.join(root, "case-")), tar([{ name: "settings.json", data: Buffer.alloc(100000, 1) }]), { expandedBytes: 50000 }), /larger than allowed/);
    // And a good one still goes through.
    const ok = await unpackBytes(fs.mkdtempSync(path.join(root, "case-")), tar([{ name: "settings.json", data: Buffer.from("{}") }]));
    assert.equal(ok.result.files, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("automatic backups run on a timer, only when on, and keep the newest N automatic ones", async () => {
  const root = temp();
  try {
    sampleData(root);
    let clock = new Date("2026-03-01T00:00:00Z");
    const pendingTimers = [];
    const timers = {
      setTimeout: (fn, ms) => { const timer = { fn: () => { timer.cleared = true; return fn(); }, ms, cleared: false, unref() {} }; pendingTimers.push(timer); return timer; },
      clearTimeout: (timer) => { timer.cleared = true; }
    };
    const service = createBackupService(root, { now: () => clock, timers, write: () => {} });
    const live = () => pendingTimers.filter((timer) => !timer.cleared);

    service.start();
    assert.equal(live().length, 0, "off by default: no timer");
    assert.deepEqual(service.schedule(), { intervalHours: 0, keep: 7 });
    assert.throws(() => service.setSchedule({ intervalHours: -1 }), ArchiveError);
    assert.throws(() => service.setSchedule({ intervalHours: 6, keep: 0 }), ArchiveError);

    service.setSchedule({ intervalHours: 6, keep: 2 });
    assert.equal(live().length, 1);
    assert.equal(live()[0].ms, 6 * 3600 * 1000, "the first backup is one interval away");
    assert.equal(service.nextAt().toISOString(), "2026-03-01T06:00:00.000Z");

    // The timer fires: a backup, then the next timer. A manual backup is never pruned.
    await service.create({ kind: "backup" });
    for (let i = 0; i < 4; i++) {
      clock = new Date(clock.getTime() + 6 * 3600 * 1000);
      await live()[0].fn();
      assert.equal(live().length, 1, "re-armed after each run");
    }
    const names = service.list();
    assert.equal(names.filter((entry) => entry.kind === "auto").length, 2);
    assert.equal(names.filter((entry) => entry.kind === "backup").length, 1);
    assert.deepEqual(names.filter((entry) => entry.kind === "auto").map((entry) => entry.created),
      ["2026-03-02T00:00:00.000Z", "2026-03-01T18:00:00.000Z"]);

    // A smaller count prunes at once; turning it off clears the timer.
    service.setSchedule({ intervalHours: 6, keep: 1 });
    assert.equal(service.list().filter((entry) => entry.kind === "auto").length, 1);
    service.setSchedule({ intervalHours: 0, keep: 1 });
    assert.equal(live().length, 0);

    // After a restart the next one is due one interval after the newest automatic backup, at least a minute out.
    clock = new Date("2026-03-02T05:00:00Z");
    service.setSchedule({ intervalHours: 6, keep: 1 });
    assert.equal(live()[0].ms, 60 * 60 * 1000, "newest auto backup 00:00 + 6 h - now 05:00");
    clock = new Date("2026-03-09T00:00:00Z");
    service.start();
    assert.equal(live().at(-1).ms, 60 * 1000, "overdue: a minute after start");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("a staged restore replaces the state at the next start, after a backup, and is refused when the archive is bad", async () => {
  const root = temp();
  try {
    const data = path.join(root, "data");
    sampleData(data);
    const service = createBackupService(data, { write: () => {} });
    const made = await service.create({ kind: "backup" });
    // The data changes after the backup.
    put(data, "settings.json", "{\"a\":2}");
    put(data, "accounts/new/account.json", "{\"id\":\"new\"}");

    await assert.rejects(service.stage(path.join(root, "missing.tar.gz"), { source: "x" }), ArchiveError);
    assert.equal(fs.existsSync(path.join(data, pendingFolder)), false, "a refused archive leaves nothing staged");

    const meta = await service.stage(path.join(service.dir, made.name), { source: made.name });
    assert.equal(meta.files, 6);
    assert.equal(service.pending().source, made.name);
    assert.equal(fs.readFileSync(path.join(data, "settings.json"), "utf8"), "{\"a\":2}", "nothing changes before the restart");

    const applied = await applyPendingRestore(data, { write: () => {} });
    assert.equal(applied.source, made.name);
    assert.equal(fs.readFileSync(path.join(data, "settings.json"), "utf8"), "{\"a\":1}");
    assert.equal(fs.existsSync(path.join(data, "accounts/new")), false);
    assert.equal(fs.existsSync(path.join(data, "tokens.json")), false, "tokens are dropped");
    assert.equal(fs.readFileSync(path.join(data, "tls/key.pem"), "utf8"), "PRIVATE", "tls/ stays when the archive has none");
    assert.equal(fs.existsSync(path.join(data, "logs/unknown/1.jsonl")), true, "logs stay");
    assert.equal(fs.existsSync(path.join(data, pendingFolder)), false);
    assert.equal(fs.existsSync(path.join(data, ".restore-old")), false);
    const before = service.list().find((entry) => entry.kind === "prerestore");
    assert.ok(before, "the data before the restore is kept");
    // That backup holds the changed data.
    const check = path.join(root, "check");
    fs.mkdirSync(check);
    await unpackArchive(path.join(service.dir, before.name), check);
    assert.equal(fs.readFileSync(path.join(check, "settings.json"), "utf8"), "{\"a\":2}");
    assert.equal(await applyPendingRestore(data), null, "nothing pending, nothing done");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// The admin routes, on a backend with its own temp data folder.
function raw(port, method, urlPath, { body, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request({ host: "127.0.0.1", port, method, path: urlPath, headers: { "User-Agent": "test", ...headers } }, (response) => {
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on("error", reject);
    request.end(body);
  });
}
const json = (response) => JSON.parse(response.body.toString("utf8"));
const jsonHeaders = { "Content-Type": "application/json" };

test("the admin routes export, back up, list, import and restore", async () => {
  const backend = await startBackend();
  try {
    put(backend.dataDir, "friendcodes.json", "{\"codes\":[]}");
    const overview = json(await raw(backend.port, "GET", "/admin/api/backup"));
    assert.ok(overview.included.includes("accounts/") && overview.included.includes("settings.json"));
    assert.ok(overview.excluded.some((line) => line.startsWith("logs/")));
    assert.equal(overview.schedule.intervalHours, 0);

    // Export: a tar.gz of the state.
    const exported = await raw(backend.port, "GET", "/admin/api/backup/export");
    assert.equal(exported.status, 200);
    assert.match(exported.headers["content-disposition"], /core-data-.*\.tar\.gz/);
    const target = fs.mkdtempSync(path.join(os.tmpdir(), "core-backup-test-"));
    try {
      const file = path.join(target, "e.tar.gz");
      fs.writeFileSync(file, exported.body);
      fs.mkdirSync(path.join(target, "out"));
      const unpacked = await unpackArchive(file, path.join(target, "out"));
      assert.ok(unpacked.files >= 1);
      assert.equal(fs.existsSync(path.join(target, "out", "friendcodes.json")), true);
      assert.equal(fs.existsSync(path.join(target, "out", "tokens.json")), false);

      // Back up now, then it is listed, downloadable and deletable.
      const created = json(await raw(backend.port, "POST", "/admin/api/backup/create", { headers: jsonHeaders, body: "{}" }));
      assert.match(created.name, /^core-backup-.*\.tar\.gz$/);
      assert.equal(created.backups.length, 1);
      const download = await raw(backend.port, "GET", `/admin/api/backup/files/${created.name}`);
      assert.equal(download.status, 200);
      assert.equal((await raw(backend.port, "GET", "/admin/api/backup/files/..%2Fsettings.json")).status, 404);
      assert.equal((await raw(backend.port, "GET", "/admin/api/backup/files/core-backup-20260101T000000Z.tar.gz")).status, 404);

      // Import needs the confirmation, and a bad archive is refused without staging anything.
      const bad = await raw(backend.port, "POST", "/admin/api/backup/import?confirm=1", { headers: jsonHeaders, body: tar([{ name: "../x.json", data: Buffer.from("1") }]) });
      assert.equal(bad.status, 400);
      assert.equal(json(await raw(backend.port, "GET", "/admin/api/backup")).pending, null);
      assert.equal((await raw(backend.port, "POST", "/admin/api/backup/import", { headers: jsonHeaders, body: download.body })).status, 400);

      // A good import is staged (not applied) and kept in the list; it can be cancelled.
      put(backend.dataDir, "friendcodes.json", "{\"codes\":[1]}");
      const staged = await raw(backend.port, "POST", "/admin/api/backup/import?confirm=1", { headers: jsonHeaders, body: download.body });
      assert.equal(staged.status, 200, staged.body.toString());
      assert.equal(json(staged).pending.source, "an uploaded archive");
      assert.ok(json(staged).backups.some((entry) => entry.kind === "import"));
      assert.equal(fs.readFileSync(path.join(backend.dataDir, "friendcodes.json"), "utf8"), "{\"codes\":[1]}");
      assert.equal(json(await raw(backend.port, "POST", "/admin/api/backup/pending/cancel", { headers: jsonHeaders, body: "{}" })).pending, null);

      // Restore from the list needs confirm, then stages.
      assert.equal((await raw(backend.port, "POST", `/admin/api/backup/files/${created.name}/restore`, { headers: jsonHeaders, body: "{}" })).status, 400);
      const restore = await raw(backend.port, "POST", `/admin/api/backup/files/${created.name}/restore`, { headers: jsonHeaders, body: JSON.stringify({ confirm: true }) });
      assert.equal(restore.status, 200);
      assert.equal(json(restore).pending.source, created.name);

      // The schedule, then delete.
      const scheduled = json(await raw(backend.port, "PUT", "/admin/api/backup/schedule", { headers: jsonHeaders, body: JSON.stringify({ intervalHours: 12, keep: 3 }) }));
      assert.deepEqual([scheduled.schedule.intervalHours, scheduled.schedule.keep], [12, 3]);
      assert.ok(scheduled.schedule.nextAt);
      assert.equal((await raw(backend.port, "PUT", "/admin/api/backup/schedule", { headers: jsonHeaders, body: JSON.stringify({ intervalHours: 9999 }) })).status, 400);
      const deleted = json(await raw(backend.port, "DELETE", `/admin/api/backup/files/${created.name}`));
      assert.ok(!deleted.backups.some((entry) => entry.name === created.name));
    } finally {
      fs.rmSync(target, { recursive: true, force: true });
    }
  } finally {
    backend.close();
  }
});

test("the backup routes are behind the admin gate", async () => {
  const backend = await startBackend();
  try {
    const foreign = await raw(backend.port, "GET", "/admin/api/backup", { headers: { Host: "evil.example" } });
    assert.equal(foreign.status, 403);
    assert.equal((await get(backend.port, "/admin/api/backup/export")).status, 200);
  } finally {
    backend.close();
  }
});
