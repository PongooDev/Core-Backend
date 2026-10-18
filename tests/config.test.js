import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.js";

test("the command line overrides the config file, which overrides the defaults", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-config-"));
  try {
    const file = path.join(dir, "core.json");
    fs.writeFileSync(file, JSON.stringify({ port: 6000, dataDir: "from-file" }));
    assert.deepEqual(loadConfig(["--config", file]), { port: 6000, dataDir: "from-file" });
    assert.deepEqual(loadConfig(["--config", file, "--port", "6001", "--data", "from-args"]), { port: 6001, dataDir: "from-args" });
    assert.throws(() => loadConfig(["--config", path.join(dir, "missing.json")]), /not found/);
    assert.throws(() => loadConfig(["--port", "seventy"]), /Invalid port/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("a launcher can start the backend with one command and its own port and data folder", async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-launch-"));
  const child = spawn(process.execPath, ["src/main.js", "--port", "0", "--data", dataDir], { stdio: ["ignore", "pipe", "pipe"] });
  try {
    const port = await new Promise((resolve, reject) => {
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/Listening on port (\d+)/);
        if (match) resolve(Number(match[1]));
      });
      child.on("exit", (code) => reject(new Error(`exited with ${code}: ${output}`)));
    });
    assert.ok(port > 0);
    const response = await fetch(`http://127.0.0.1:${port}/account/api/epicdomains/ssodomains`);
    assert.equal(response.status, 200);
    assert.ok(fs.existsSync(path.join(dataDir, "accounts")));
  } finally {
    child.kill();
    await new Promise((resolve) => child.once("exit", resolve));
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});
