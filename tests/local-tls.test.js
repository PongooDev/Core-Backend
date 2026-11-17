import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { once } from "node:events";
import fs from "node:fs";
import https from "node:https";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { X509Certificate as PeculiarCertificate } from "@peculiar/x509";
import {
  buildLeaf, buildRoot, createCertificates, generateKeys, loadCertificates, nameConstraintsOid, rootSubject, thumbprint, tlsFiles, usable
} from "../src/tls/certificates.js";
import { get, send, startBackend, userLogin } from "./helpers.js";

// The backend's local https (Core-Backend #377): its own name-constrained root and leaf, https beside http on the one
// port, and the root for the launcher's opt-in trust.

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "core-tls-"));
const rootPem = (port) => send({ host: "127.0.0.1", port, path: "/core/api/tls/root.crt" });

function sendTls(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ host: "127.0.0.1", agent: false, ...options }, (res) => {
      const authorized = res.socket.authorized;
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const json = (res.headers["content-type"] ?? "").startsWith("application/json");
        resolve({ status: res.statusCode, headers: res.headers, body: data ? (json ? JSON.parse(data) : data) : null, authorized });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

// A TLS handshake to 127.0.0.1:port that trusts only `ca`, checking the name as a browser does.
function handshake(port, ca, servername) {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: "127.0.0.1", port, ca, ...(servername ? { servername } : {}) }, () => {
      const peer = socket.getPeerX509Certificate();
      socket.end();
      resolve(peer);
    });
    socket.on("error", reject);
  });
}

test("the set: a CA root limited to 127.0.0.1 and localhost, and a server leaf for them that it signed", async () => {
  const { key, cert, rootCert } = await createCertificates();
  const root = new crypto.X509Certificate(rootCert);
  const leaf = new crypto.X509Certificate(cert);

  assert.equal(root.ca, true);
  assert.match(root.subject, /CN=Core local backend \(127\.0\.0\.1 only\)/);
  assert.equal(root.subject, root.issuer);
  assert.ok(root.verify(root.publicKey), "self-signed");
  const parsedRoot = new PeculiarCertificate(rootCert);
  const basic = parsedRoot.getExtension("2.5.29.19");
  assert.equal(basic.critical, true);
  assert.equal(basic.ca, true);
  assert.equal(basic.pathLength, 0);
  const keyUsage = parsedRoot.getExtension("2.5.29.15");
  assert.equal(keyUsage.critical, true);
  assert.equal(keyUsage.usages, 32 | 64, "keyCertSign and cRLSign only");
  // nameConstraints, critical: permitted iPAddress 127.0.0.1/255.255.255.255 and dNSName localhost, nothing else.
  const constraints = parsedRoot.getExtension(nameConstraintsOid);
  assert.equal(constraints.critical, true);
  assert.equal(Buffer.from(constraints.value).toString("hex"),
    "301ba019300a87087f000001ffffffff300b82096c6f63616c686f7374");

  assert.equal(leaf.ca, false);
  assert.equal(leaf.subjectAltName, "IP Address:127.0.0.1, DNS:localhost");
  assert.deepEqual(leaf.keyUsage, ["1.3.6.1.5.5.7.3.1"], "serverAuth only");
  assert.ok(leaf.checkIssued(root));
  assert.ok(leaf.verify(root.publicKey));
  assert.ok(leaf.checkPrivateKey(crypto.createPrivateKey(key)));
  assert.equal(leaf.checkIP("127.0.0.1"), "127.0.0.1");
  assert.equal(leaf.checkHost("localhost"), "localhost");
  assert.equal(leaf.checkHost("example.com"), undefined);
  assert.equal(leaf.checkIP("127.0.0.2"), undefined);

  // About ten years each.
  for (const certificate of [root, leaf]) {
    const years = (new Date(certificate.validTo) - new Date(certificate.validFrom)) / (365.25 * 24 * 60 * 60 * 1000);
    assert.ok(years > 9.9 && years < 10.1, `${years} years`);
  }
  assert.equal(new PeculiarCertificate(rootCert).subject, rootSubject);
});

test("the root's key is never on disk: the data folder keeps the leaf's key and the two certificates only", async () => {
  const dataDir = tempDir();
  try {
    const set = await loadCertificates(dataDir);
    assert.equal(set.created, true);
    const files = tlsFiles(dataDir);
    assert.deepEqual(fs.readdirSync(files.dir).sort(), ["backend-cert.pem", "backend-key.pem", "root-cert.pem"]);
    assert.equal(fs.readFileSync(files.root, "utf8"), set.rootCert);
    assert.doesNotMatch(set.rootCert, /PRIVATE KEY/);
    assert.doesNotMatch(fs.readFileSync(files.cert, "utf8"), /PRIVATE KEY/);

    // Every private key anywhere in the data folder is the leaf's, none the root's.
    const rootPublic = new crypto.X509Certificate(set.rootCert).publicKey.export({ type: "spki", format: "der" });
    const keys = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(file);
        else for (const pem of fs.readFileSync(file, "utf8").match(/-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]+?-----END [A-Z ]*PRIVATE KEY-----/g) ?? []) keys.push(pem);
      }
    };
    walk(dataDir);
    assert.equal(keys.length, 1);
    const publicOf = crypto.createPublicKey(crypto.createPrivateKey(keys[0])).export({ type: "spki", format: "der" });
    assert.notDeepEqual(publicOf, rootPublic);
    assert.ok(new crypto.X509Certificate(set.cert).checkPrivateKey(crypto.createPrivateKey(keys[0])));
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("the root's private key is made non-extractable: WebCrypto won't export it", async () => {
  const keys = await generateKeys(false);
  assert.equal(keys.privateKey.extractable, false);
  await assert.rejects(crypto.webcrypto.subtle.exportKey("pkcs8", keys.privateKey));
  await assert.rejects(crypto.webcrypto.subtle.exportKey("jwk", keys.privateKey));
});

test("the set is kept across starts, and made again with a new root when a file is missing, mismatched or expiring", async () => {
  const dataDir = tempDir();
  try {
    const first = await loadCertificates(dataDir);
    const again = await loadCertificates(dataDir);
    assert.equal(again.created, false);
    assert.equal(thumbprint(again.rootCert), thumbprint(first.rootCert));
    assert.equal(again.key, first.key);

    const files = tlsFiles(dataDir);
    fs.rmSync(files.key);
    const remade = await loadCertificates(dataDir);
    assert.equal(remade.created, true);
    assert.notEqual(thumbprint(remade.rootCert), thumbprint(first.rootCert));

    // Another set's root: the leaf isn't its.
    fs.writeFileSync(files.root, (await createCertificates()).rootCert);
    assert.equal((await loadCertificates(dataDir)).created, true);

    // Within 30 days of the end of its ten years.
    const current = await loadCertificates(dataDir);
    assert.equal(current.created, false);
    const late = new Date(Date.now() + (10 * 365 - 20) * 24 * 60 * 60 * 1000);
    assert.equal(usable(current, late), false);
    assert.equal(usable(current, new Date(Date.now() + 9 * 365 * 24 * 60 * 60 * 1000)), true);
    assert.equal((await loadCertificates(dataDir, late)).created, true);

    fs.writeFileSync(files.cert, "not a certificate");
    assert.equal((await loadCertificates(dataDir)).created, true);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test("TLS enforces the root's name constraints: a leaf it signed for any other name isn't trusted", async () => {
  // A root of the same make whose key this test keeps, to sign leaves the backend never would.
  const rootKeys = await generateKeys(false);
  const root = await buildRoot(rootKeys);
  const ca = root.toString("pem");
  const serve = async (names) => {
    const leafKeys = await generateKeys(true);
    const leaf = await buildLeaf(root, rootKeys.privateKey, leafKeys, new Date(), names);
    const server = tls.createServer({ key: crypto.KeyObject.from(leafKeys.privateKey).export({ type: "pkcs8", format: "pem" }), cert: leaf.toString("pem") },
      (socket) => socket.end());
    server.on("tlsClientError", () => {});
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    return server;
  };

  const good = await serve([{ type: "ip", value: "127.0.0.1" }, { type: "dns", value: "localhost" }]);
  const foreign = await serve([{ type: "dns", value: "example.com" }]);
  const otherIp = await serve([{ type: "ip", value: "10.0.0.1" }]);
  try {
    assert.ok(await handshake(good.address().port, ca));
    assert.ok(await handshake(good.address().port, ca, "localhost"));
    await assert.rejects(handshake(foreign.address().port, ca, "example.com"), (error) => /SUBTREE|PERMITTED|name constraint/i.test(`${error.code} ${error.message}`));
    await assert.rejects(handshake(otherIp.address().port, ca), (error) => /SUBTREE|PERMITTED|name constraint/i.test(`${error.code} ${error.message}`));
  } finally {
    good.close();
    foreign.close();
    otherIp.close();
  }
});

test("one port serves plain http and https: the first byte tells a ClientHello from a request", async () => {
  const backend = await startBackend();
  try {
    const plain = await get(backend.port, "/core/api/status");
    assert.equal(plain.status, 200);
    assert.equal(plain.body.name, "Core-Backend");

    const { body: ca } = await rootPem(backend.port);
    assert.match(ca, /^-----BEGIN CERTIFICATE-----/);

    // Verified against the backend's own root only, by IP (the address CEF opens) and by localhost.
    const secure = await sendTls({ port: backend.port, path: "/core/api/status", ca });
    assert.equal(secure.status, 200);
    assert.equal(secure.body.name, "Core-Backend");
    assert.equal(secure.authorized, true);
    const peer = await handshake(backend.port, ca);
    assert.equal(peer.subjectAltName, "IP Address:127.0.0.1, DNS:localhost");
    assert.equal(peer.checkIssued(new crypto.X509Certificate(ca)), true);
    assert.ok(await handshake(backend.port, ca, "localhost"));
    // Without the root it's an unknown issuer, as for any browser that hasn't trusted it.
    await assert.rejects(handshake(backend.port, undefined), (error) => /UNABLE_TO_VERIFY|SELF_SIGNED|unable to get/i.test(`${error.code} ${error.message}`));

    // Plain http goes on as before after https was used, on the same port.
    assert.equal((await get(backend.port, "/core/api/status")).status, 200);

    // Raw bytes: an HTTP request line gets an HTTP answer; a handshake record that isn't one is dropped, and the backend
    // goes on.
    const raw = net.connect(backend.port, "127.0.0.1");
    raw.end("GET /core/api/status HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n");
    let answer = "";
    raw.setEncoding("utf8");
    raw.on("data", (chunk) => (answer += chunk));
    await once(raw, "close");
    assert.match(answer, /^HTTP\/1\.1 200/);

    const junk = net.connect(backend.port, "127.0.0.1");
    junk.on("error", () => {});
    junk.resume();
    junk.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x04, 0xff, 0x00, 0x00, 0x00]));
    await once(junk, "close");
    assert.equal((await get(backend.port, "/core/api/status")).status, 200);
  } finally {
    backend.close();
  }
});

test("the purchase flow's page signs in and completes over https, its cookie Secure", async () => {
  const backend = await startBackend();
  try {
    // Any build with the Store tab: the page is the same; 3.5.1 keeps the test light (7.00+ is where CEF uses https).
    const agent = "game=Fortnite, engine=UE4, build=++Fortnite+Release-3.5-CL-4000805";
    const { body: ca } = await rootPem(backend.port);
    const player = await userLogin(backend.port, "HttpsBuyer");
    const catalog = (await send({ host: "127.0.0.1", port: backend.port, path: "/fortnite/api/storefront/v2/catalog",
      headers: { "User-Agent": agent, Authorization: `bearer ${player.token}` } })).body;
    const offers = catalog.storefronts.find((storefront) => storefront.name === "CurrencyStorefront").catalogEntries[0].appStoreId[1];
    const { code } = (await get(backend.port, "/account/api/oauth/exchange", player.token)).body;
    const origin = `https://127.0.0.1:${backend.port}`;
    const redirectUrl = `http:///127.0.0.1:${backend.port}/purchase?offers=${encodeURIComponent(offers)}`;

    const signed = await sendTls({ port: backend.port, ca, path: `/exchange?exchangeCode=${code}&redirectUrl=${encodeURIComponent(redirectUrl)}`,
      headers: { "User-Agent": agent } });
    assert.equal(signed.status, 302);
    assert.equal(signed.headers.location, `/purchase?offers=${encodeURIComponent(offers)}`);
    assert.match(signed.headers["set-cookie"][0], /; Secure$/);
    const token = /^EPIC_BEARER_TOKEN=([0-9a-f]+)/.exec(signed.headers["set-cookie"][0])[1];

    const page = await sendTls({ port: backend.port, ca, path: signed.headers.location, headers: { "User-Agent": agent, Cookie: `EPIC_BEARER_TOKEN=${token}` } });
    assert.equal(page.status, 200);
    const purchaseId = /name="purchaseId" value="([^"]+)"/.exec(page.body)[1];
    const body = `purchaseId=${encodeURIComponent(purchaseId)}`;
    const done = await sendTls({ port: backend.port, ca, method: "POST", path: "/purchase/complete",
      headers: { "User-Agent": agent, "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(body), Origin: origin,
        "Sec-Fetch-Site": "same-origin" } }, body);
    assert.equal(done.status, 200, JSON.stringify(done.body).slice(0, 300));

    // Over plain http the cookie stays as it was.
    const { code: plainCode } = (await get(backend.port, "/account/api/oauth/exchange", player.token)).body;
    const plain = await send({ host: "127.0.0.1", port: backend.port, path: `/exchange?exchangeCode=${plainCode}&redirectUrl=${encodeURIComponent(redirectUrl)}`,
      headers: { "User-Agent": agent } });
    assert.doesNotMatch(plain.headers["set-cookie"][0], /Secure/);
  } finally {
    backend.close();
  }
});

test("the root certificate is given to this PC only, public part only", async () => {
  const backend = await startBackend();
  try {
    const answer = await rootPem(backend.port);
    assert.equal(answer.status, 200);
    assert.match(answer.headers["content-type"], /^application\/x-pem-file/);
    assert.equal(answer.headers["cache-control"], "no-store");
    assert.doesNotMatch(answer.body, /PRIVATE/);
    assert.equal(answer.headers["x-core-root-thumbprint"], thumbprint(answer.body));
    assert.equal(answer.body, fs.readFileSync(tlsFiles(backend.dataDir).root, "utf8"));
    assert.equal(new crypto.X509Certificate(answer.body).ca, true);

    // A request a reverse proxy here forwarded isn't this PC's.
    const proxied = await send({ host: "127.0.0.1", port: backend.port, path: "/core/api/tls/root.crt", headers: { "X-Forwarded-For": "203.0.113.5" } });
    assert.equal(proxied.status, 403);
  } finally {
    backend.close();
  }
});

test("without a certificate the backend goes on with plain http only", async () => {
  const backend = await startBackend();
  try {
    // The data folder's tls path is a file, so no set can be written.
    fs.writeFileSync(path.join(backend.dataDir, "tls"), "");
    assert.equal((await rootPem(backend.port)).status, 404);
    const junk = net.connect(backend.port, "127.0.0.1");
    junk.on("error", () => {});
    junk.resume();
    junk.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x04, 0xff, 0x00, 0x00, 0x00]));
    await once(junk, "close");
    assert.equal((await get(backend.port, "/core/api/status")).status, 200);
  } finally {
    backend.close();
  }
});
