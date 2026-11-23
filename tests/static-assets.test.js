import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import { epicStaticAssetsOrigin, staticAssetsPath } from "../src/services/content/staticassets.js";
import { send, startBackend } from "./helpers.js";

// Core-Backend #419: 8.20 to 8.40's Creative hub downloads its Battle Royale island rifts' pictures from Epic's
// static-assets-prod.epicgames.com, which the client's redirect sends to the backend. The backend fetches them from
// Epic's host (here a local stand-in) and passes them back.
const v840Agent = "FortniteGame/++Fortnite+Release-8.40-CL-6005771 Windows/10.0.19045.1.768.64bit";
const picture = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);

async function standIn() {
  const asked = [];
  const server = http.createServer((req, res) => {
    asked.push({ method: req.method, url: req.url, host: req.headers.host });
    if (req.url !== "/fn/static/creative/center_br_island_portal.jpg") return res.writeHead(403, { "Content-Type": "application/xml" }).end("<Error/>");
    res.writeHead(200, { "Content-Type": "image/jpeg", "Content-Length": picture.length, ETag: "\"abc\"", "Set-Cookie": "x=1" });
    res.end(req.method === "HEAD" ? undefined : picture);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { server, asked, origin: `http://127.0.0.1:${server.address().port}` };
}

const getRaw = (port, path, method = "GET") => new Promise((resolve, reject) => {
  const req = http.request({ host: "127.0.0.1", port, path, method, headers: { "User-Agent": v840Agent } }, (res) => {
    const chunks = [];
    res.on("data", (chunk) => chunks.push(chunk));
    res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
  });
  req.on("error", reject);
  req.end();
});

test("the hub's rift pictures are Epic's static asset host's /fn/static pictures, and nothing else is", () => {
  assert.equal(epicStaticAssetsOrigin, "https://static-assets-prod.epicgames.com");
  for (const name of ["center", "ne", "nw", "se", "sw"]) assert.ok(staticAssetsPath.test(`/fn/static/creative/${name}_br_island_portal.jpg`), name);
  for (const path of ["/fn/static/creative/x.exe", "/fn/static/creative/a b.jpg", "/fn/other/x.jpg", "/fn/static/%2e%2e/x.jpg", "/fn/static/creative/x.jpg?y"]) {
    assert.equal(staticAssetsPath.test(path), false, path);
  }
});

test("8.40's rift picture is fetched from Epic's static asset host and passed back (#419)", async () => {
  const epic = await standIn();
  const backend = await startBackend({ staticAssetsOrigin: epic.origin });
  try {
    const got = await getRaw(backend.port, "/fn/static/creative/center_br_island_portal.jpg");
    assert.equal(got.status, 200);
    assert.equal(got.headers["content-type"], "image/jpeg");
    assert.equal(got.headers.etag, "\"abc\"");
    assert.equal(got.headers["set-cookie"], undefined, "only the picture's own headers come back");
    assert.deepEqual(got.body, picture);
    assert.deepEqual(epic.asked, [{ method: "GET", url: "/fn/static/creative/center_br_island_portal.jpg", host: new URL(epic.origin).host }]);

    const head = await getRaw(backend.port, "/fn/static/creative/center_br_island_portal.jpg", "HEAD");
    assert.equal(head.status, 200);

    const missing = await getRaw(backend.port, "/fn/static/creative/gone.jpg");
    assert.equal(missing.status, 403, "Epic's own answer for a picture it doesn't have");
  } finally {
    backend.close();
    epic.server.close();
  }
});

test("anything but a picture under /fn/static stays the backend's and is never fetched", async () => {
  const epic = await standIn();
  const backend = await startBackend({ staticAssetsOrigin: epic.origin });
  try {
    for (const path of ["/fn/static/creative/x.txt", "/fn/static/", "/fn/static/creative/..%2f..%2fx.jpg"]) {
      const got = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path, headers: { "User-Agent": v840Agent } });
      assert.equal(got.status, 404, path);
    }
    const post = await send({ host: "127.0.0.1", port: backend.port, method: "POST", path: "/fn/static/creative/center_br_island_portal.jpg",
      headers: { "User-Agent": v840Agent } });
    assert.equal(post.status, 404);
    assert.deepEqual(epic.asked, []);
  } finally {
    backend.close();
    epic.server.close();
  }
});

test("with Epic's host unreachable the game gets an error, not a hang", async () => {
  const epic = await standIn();
  const origin = epic.origin;
  epic.server.close();
  await once(epic.server, "close");
  const backend = await startBackend({ staticAssetsOrigin: origin });
  try {
    const got = await getRaw(backend.port, "/fn/static/creative/center_br_island_portal.jpg");
    assert.equal(got.status, 502);
  } finally {
    backend.close();
  }
});
