import { test } from "node:test";
import assert from "node:assert/strict";
import { certUserAgent, send, startBackend } from "./helpers.js";

test("unknown routes return an Epic not found error and are logged per build", async () => {
  const backend = await startBackend();

  try {
    const response = await send({
      host: "127.0.0.1",
      port: backend.port,
      method: "POST",
      path: "/account/api/unknown",
      headers: { "User-Agent": certUserAgent, "Content-Type": "application/x-www-form-urlencoded" }
    }, "username=Player&password=secret");

    assert.equal(response.status, 404);
    assert.equal(response.body.errorCode, "errors.com.epicgames.common.not_found");

    const [entry] = backend.unknownLog("3532353");
    assert.equal(entry.path, "/account/api/unknown");
    assert.equal(entry.body.username, "Player");
    assert.equal(entry.body.password, "<redacted>");
  } finally {
    backend.close();
  }
});
