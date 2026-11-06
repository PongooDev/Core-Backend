import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";
import tls from "node:tls";
import express from "express";
import { enableProxy, forwardImageRequests } from "../src/proxy.js";
import { imageHostOf, imageHosts, isImageHost } from "../src/services/content/imagehosts.js";
import { epicPlaylistImages } from "../src/services/content/playlistimages.js";
import { get, openTunnel, post, send, startBackend } from "./helpers.js";

// Core-Backend #260: a client on -httpproxy=<backend> sends its picture downloads here too. Epic's image CDN and the
// admin's picture hosts are tunnelled to the real site (services/content/imagehosts.js, proxy.js); nothing else is.
const v41Agent = "Fortnite/++Fortnite+Release-4.1-CL-4053532 Windows/10.0.19045.1.768.64bit";

const listen = async (server) => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return server.address().port;
};

test("4.1's content page names each playlist's picture under playlistimages.playlistimages.images (#260)", async () => {
  const backend = await startBackend();
  try {
    const page = await send({ host: "127.0.0.1", port: backend.port, method: "GET", path: "/content/api/pages/fortnite-game",
      headers: { "User-Agent": v41Agent } });
    assert.equal(page.status, 200);
    const { images } = page.body.playlistimages.playlistimages;
    const byName = Object.fromEntries(images.map((entry) => [entry.playlistname, entry.image]));
    for (const name of ["Playlist_DefaultSolo", "Playlist_DefaultDuo", "Playlist_DefaultSquad", "Playlist_Carmine"]) {
      assert.equal(byName[name], epicPlaylistImages[name], name);
      assert.ok(isImageHost(`${new URL(byName[name]).hostname}:443`), "its host is one the proxy tunnels");
    }
  } finally {
    backend.close();
  }
});

test("only Epic's image CDN and the admin's picture hosts are tunnelled, each on its own port", () => {
  assert.ok(isImageHost("cdn2.unrealengine.com:443"));
  assert.ok(isImageHost("CDN2.unrealengine.com:443"));
  assert.equal(isImageHost("cdn2.unrealengine.com:22"), false);
  assert.equal(isImageHost("example.com:443"), false);
  assert.equal(isImageHost("account-public-service-prod03.ol.epicgames.com:443"), false);
  assert.equal(isImageHost("cdn2.unrealengine.com"), false, "no port");
  assert.equal(isImageHost("cdn2.unrealengine.com:443/x"), false);

  const settings = {
    playlistImages: { Playlist_DefaultSolo: "https://pics.example.com/solo.png", Playlist_DefaultDuo: "http://old.example.org:8080/duo.png",
      Playlist_DefaultSquad: "/content/api/news-images/0123456789abcdef0123456789abcdef.png" },
    battleRoyaleNews: { title: "Hi", body: "There", image: "https://news.example.net/news.jpg" }
  };
  assert.ok(isImageHost("pics.example.com:443", settings));
  assert.ok(isImageHost("old.example.org:8080", settings));
  assert.ok(isImageHost("news.example.net:443", settings));
  assert.equal(isImageHost("pics.example.com:80", settings), false);
  assert.equal(isImageHost("other.example.com:443", settings), false);
  assert.ok(isImageHost("pics.example.com:443", {}, { playlistImages: settings.playlistImages }), "config.json's too");
  assert.equal(imageHosts(settings).size, 4);

  // Never Epic's API hosts (the backend's own), this PC or its network.
  for (const url of ["https://fortnite-public-service-prod11.ol.epicgames.com/a.png", "http://127.0.0.1:5595/a.png", "http://localhost/a.png",
    "http://192.168.1.4/a.png", "http://10.0.0.1/a.png", "http://[::1]/a.png", "http://0.0.0.0/a.png", "file:///C:/a.png", "not a url", "",
    "/content/api/news-images/0123456789abcdef0123456789abcdef.png"]) {
    assert.equal(imageHostOf(url), null, url);
  }
});

test("a CONNECT to a picture host is a plain tunnel to that host; any other is still the backend's own (#260)", async () => {
  // A stand-in site: whatever arrives is echoed back, so a TLS handshake from the backend would show up as such.
  const site = net.createServer((socket) => socket.pipe(socket));
  const sitePort = await listen(site);
  const proxy = http.createServer((req, res) => { res.statusCode = 404; res.end(); });
  await enableProxy(proxy, (target) => target === `127.0.0.1:${sitePort}`);
  const proxyPort = await listen(proxy);
  try {
    const req = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: `127.0.0.1:${sitePort}` });
    req.end();
    const [response, socket] = await once(req, "connect");
    assert.equal(response.statusCode, 200);
    socket.write("ping");
    const [echo] = await once(socket, "data");
    assert.equal(echo.toString(), "ping", "the bytes reach the real site untouched");
    socket.destroy();

    // A host off the list gets the backend's own certificate, as Epic's hosts do.
    const tunnel = await new Promise((resolve, reject) => {
      const other = http.request({ host: "127.0.0.1", port: proxyPort, method: "CONNECT", path: "example.com:443" });
      other.on("connect", (_, raw) => {
        const secure = tls.connect({ socket: raw, servername: "example.com", rejectUnauthorized: false }, () => resolve(secure));
        secure.on("error", reject);
      });
      other.on("error", reject);
      other.end();
    });
    assert.equal(tunnel.authorized, false, "the backend's own self-signed certificate");
    tunnel.destroy();
  } finally {
    proxy.closeAllConnections();
    proxy.close();
    site.close();
  }
});

test("the backend's CONNECT to a host off the list is answered by the backend, not passed on", async () => {
  const backend = await startBackend();
  try {
    const tunnel = await openTunnel(backend.port, "example.com");
    assert.equal(tunnel.authorized, false, "the backend's own self-signed certificate");
    const response = await send({ createConnection: () => tunnel, path: "/a.png", headers: { Host: "example.com", "User-Agent": v41Agent } });
    assert.equal(response.status, 404, "the backend's routes answer");
  } finally {
    backend.close();
  }
});

test("a plain http:// picture on a picture host is fetched from it; other absolute-form requests stay the backend's", async () => {
  const site = http.createServer((req, res) => {
    res.setHeader("Content-Type", "image/png");
    res.setHeader("X-Secret", "not passed on");
    res.end(`picture ${req.url} ${req.headers.host}`);
  });
  const sitePort = await listen(site);
  const app = express();
  app.use(forwardImageRequests((target) => target === `127.0.0.1:${sitePort}`));
  app.use((req, res) => res.status(404).send("backend"));
  const server = http.createServer(app);
  const port = await listen(server);
  try {
    const picture = await send({ host: "127.0.0.1", port, path: `http://127.0.0.1:${sitePort}/tiles/solo.png?v=1` });
    assert.equal(picture.status, 200);
    assert.equal(picture.headers["content-type"], "image/png");
    assert.equal(picture.headers["x-secret"], undefined);
    assert.equal(picture.body, `picture /tiles/solo.png?v=1 127.0.0.1:${sitePort}`);

    const posted = await send({ host: "127.0.0.1", port, method: "POST", path: `http://127.0.0.1:${sitePort}/tiles/solo.png` });
    assert.equal(posted.body, "backend", "only GET and HEAD");
    const other = await send({ host: "127.0.0.1", port, path: "http://example.com/a.png" });
    assert.equal(other.body, "backend");
  } finally {
    server.closeAllConnections();
    server.close();
    site.closeAllConnections();
    site.close();
  }
});

test("a picture host the admin panel sets is tunnelled from then on, and no longer once reset", async () => {
  const backend = await startBackend();
  try {
    const admin = (body) => post(backend.port, "/admin/api/news", undefined, body);
    assert.equal((await admin({ playlistImages: { Playlist_DefaultSolo: "https://pics.example.com/solo.png" } })).status, 200);
    const settingsHas = async () => (await get(backend.port, "/admin/api/news")).body.playlistImages
      .find((mode) => mode.playlistName === "Playlist_DefaultSolo").custom;
    assert.equal(await settingsHas(), "https://pics.example.com/solo.png");
    // On the list: the backend passes the CONNECT on to the site (pics.example.com doesn't exist, so a 502), not to its routes.
    const passed = net.connect(backend.port, "127.0.0.1", () => passed.write("CONNECT pics.example.com:443 HTTP/1.1\r\nHost: pics.example.com:443\r\n\r\n"));
    let answer = "";
    passed.on("data", (data) => (answer += data));
    await once(passed, "close");
    assert.match(answer, /^HTTP\/1\.1 502 /);
    assert.equal((await admin({ playlistImages: { Playlist_DefaultSolo: null } })).status, 200);
    // Off the list again: the backend answers the CONNECT itself.
    const tunnel = await openTunnel(backend.port, "pics.example.com");
    assert.equal(tunnel.authorized, false, "the backend's own self-signed certificate");
    const response = await send({ createConnection: () => tunnel, path: "/solo.png", headers: { Host: "pics.example.com", "User-Agent": v41Agent } });
    assert.equal(response.status, 404, "the backend's routes answer");
  } finally {
    backend.close();
  }
});
