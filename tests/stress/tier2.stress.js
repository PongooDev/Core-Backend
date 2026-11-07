import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { certUserAgent, startBackend, userLogin } from "../helpers.js";

// Hardware Tier 2: Low-Mid VPS (2 vCPU, 2GB RAM)
// Target: 100 concurrent simulated players, 500 total operations
test("Extreme Stress Level 2: Low-Mid Hardware (100 players, 500 concurrent operations)", { timeout: 90000 }, async () => {
  const backend = await startBackend();
  const agent = new http.Agent({ keepAlive: true, maxSockets: 200, timeout: 4000 });

  function request(path, method = "GET", token, body) {
    return new Promise((resolve, reject) => {
      const headers = { "User-Agent": certUserAgent };
      if (token) headers.Authorization = `bearer ${token}`;
      let data = "";
      if (body !== undefined) {
        data = JSON.stringify(body);
        headers["Content-Type"] = "application/json";
        headers["Content-Length"] = Buffer.byteLength(data);
      }
      const req = http.request({
        host: "127.0.0.1",
        port: backend.port,
        method,
        path,
        headers,
        agent
      }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          const isJson = (res.headers["content-type"] ?? "").includes("application/json");
          resolve({ status: res.statusCode, body: isJson && text ? JSON.parse(text) : text });
        });
      });
      req.on("error", reject);
      if (data) req.write(data);
      req.end();
    });
  }

  const startTime = Date.now();
  const CONCURRENT_PLAYERS = 100;
  const OPERATIONS_PER_PLAYER = 5;

  try {
    // 1. Concurrent Player Registration & Logins
    const authStart = Date.now();
    const players = await Promise.all(
      Array.from({ length: CONCURRENT_PLAYERS }, (_, i) => userLogin(backend.port, `Tier2_User_${i}`))
    );
    const authDuration = Date.now() - authStart;
    assert.equal(players.length, CONCURRENT_PLAYERS);

    // 2. High Concurrency MCP Profile Operations
    const opsStart = Date.now();
    let successfulOps = 0;

    await Promise.all(
      players.map(async (player) => {
        for (let op = 0; op < OPERATIONS_PER_PLAYER; op++) {
          const res = await request(`/fortnite/api/game/v2/profile/${player.accountId}/client/QueryProfile?profileId=profile0&rvn=-1`, "POST", player.token, {});
          assert.equal(res.status, 200);
          assert.equal(res.body.profileId, "profile0");
          successfulOps++;
        }
      })
    );

    const opsDuration = Date.now() - opsStart;
    const totalDuration = Date.now() - startTime;
    const totalOps = CONCURRENT_PLAYERS * OPERATIONS_PER_PLAYER;
    const opsPerSec = Math.round((totalOps / (opsDuration / 1000)) * 10) / 10;

    console.log(`[Tier 2 Summary]`);
    console.log(`- Hardware Profile: Low-Mid (2 vCPU, 2GB RAM)`);
    console.log(`- Concurrent Players: ${CONCURRENT_PLAYERS}`);
    console.log(`- Total Operations: ${totalOps}`);
    console.log(`- Auth Time: ${authDuration}ms (${Math.round(CONCURRENT_PLAYERS / (authDuration / 1000))} auths/sec)`);
    console.log(`- Query Throughput: ${opsPerSec} ops/sec (${opsDuration}ms total)`);
    console.log(`- Overall Duration: ${totalDuration}ms`);
    console.log(`- Success Rate: 100% (${successfulOps}/${totalOps})`);

    assert.equal(successfulOps, totalOps);
  } finally {
    agent.destroy();
    backend.close();
  }
});

