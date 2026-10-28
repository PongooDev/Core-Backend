import { test } from "node:test";
import assert from "node:assert/strict";
import tls from "node:tls";
import { certUserAgent, openTunnel, send, startBackend } from "./helpers.js";

test("plain HTTP proxy requests are routed by path", async () => {
  const backend = await startBackend();
  const host = "fortnite-public-service-prod11.ol.epicgames.com";

  try {
    const response = await send({
      host: "127.0.0.1",
      port: backend.port,
      path: `http://${host}/fortnite/api/version`,
      headers: { Host: host, "User-Agent": certUserAgent }
    });

    assert.equal(response.status, 404);
    const [entry] = backend.unknownLog("3532353");
    assert.equal(entry.host, host);
    assert.equal(entry.url, "/fortnite/api/version");
  } finally {
    backend.close();
  }
});

test("HTTPS requests through a CONNECT tunnel get a certificate for their host and are routed by path", async () => {
  const backend = await startBackend();
  const host = "account-public-service-prod03.ol.epicgames.com";

  try {
    const tunnel = await openTunnel(backend.port, host);
    assert.equal(tls.checkServerIdentity(host, tunnel.getPeerCertificate()), undefined);

    const response = await send({
      createConnection: () => tunnel,
      path: "/account/api/oauth/unrouted",
      headers: { Host: host, "User-Agent": certUserAgent }
    });

    assert.equal(response.status, 404);
    const [entry] = backend.unknownLog("3532353");
    assert.equal(entry.host, host);
    assert.equal(entry.url, "/account/api/oauth/unrouted");
  } finally {
    backend.close();
  }
});

test("the game's launcher icon requests get a quiet 404, not an unanswered request (#107)", async () => {
  const backend = await startBackend();
  const host = "launcher-resources.s3.amazonaws.com";

  try {
    for (const app of ["launcher", "fortnite", "default"]) {
      const response = await send({
        host: "127.0.0.1",
        port: backend.port,
        path: `http://${host}/launcher-resources/0.1_b76b28ed708e4efcbb6d0e843fcc6456/${app}/icon.png`,
        headers: { Host: host, "User-Agent": certUserAgent }
      });
      assert.equal(response.status, 404);
    }
    assert.throws(() => backend.unknownLog("3532353"), { code: "ENOENT" });
  } finally {
    backend.close();
  }
});
