import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp } from "../src/app.js";

test("unknown routes return an Epic not found error and are logged per build", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  const server = createApp({ dataDir }).listen(0);
  await once(server, "listening");

  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/account/api/oauth/token`, {
      method: "POST",
      headers: { "User-Agent": "Fortnite/++Fortnite+Release-Cert-CL-3532353 Windows/10.0" },
      body: new URLSearchParams({ grant_type: "password", username: "Player", password: "secret" })
    });

    assert.equal(response.status, 404);
    assert.equal((await response.json()).errorCode, "errors.com.epicgames.common.not_found");

    const lines = fs.readFileSync(path.join(dataDir, "logs", "unknown", "3532353.jsonl"), "utf8").trim().split("\n");
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.path, "/account/api/oauth/token");
    assert.equal(entry.body.username, "Player");
    assert.equal(entry.body.password, "<redacted>");
  } finally {
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
