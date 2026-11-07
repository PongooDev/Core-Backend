import assert from "node:assert/strict";
import http from "node:http";
import test from "node:test";
import { certClient, certUserAgent, startBackend } from "../helpers.js";

// Hardware Tier 6: High Performance Dedicated (16 vCPU, 32GB RAM)
// Target: 1,000 concurrent simulated players, 5,000 total operations
test("Extreme Stress Level 6: High Performance Dedicated (1,000 players, 5,000 concurrent operations)", { timeout: 300000 }, async () => {
  const backend = await startBackend();
  const agent = new http.Agent({ keepAlive: true, maxSockets: 200 });

  function authRequest(username) {
    return new Promise((resolve, reject) => {
      const body = new URLSearchParams({ grant_type: "password", username, password: "test" }).toString();
      const headers = {
        Authorization: `basic ${Buffer.from(`${certClient}:secret`).toString("base64")}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "Content-Length": Buffer.byteLength(body),
        "User-Agent": certUserAgent
      };
      const req = http.request({
        host: "127.0.0.1",
        port: backend.port,
        method: "POST",
        path: "/account/api/oauth/token",
        headers,
        agent
      }, (res) => {
        let text = "";
        res.on("data", (c) => (text += c));
        res.on("end", () => {
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : null });
        });
      });
      req.on("error", reject);
      req.write(body);
      req.end();
    });
  }

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
  const CONCURRENT_PLAYERS = 1000;
  const OPERATIONS_PER_PLAYER = 5;

  try {
    // 1. Concurrent Player Registration & Logins
    const authStart = Date.now();
    const players = await Promise.all(
      Array.from({ length: CONCURRENT_PLAYERS }, async (_, i) => {
        const res = await authRequest(`Tier6_User_${i}`);
        assert.equal(res.status, 200);
        return { token: res.body.access_token, accountId: res.body.account_id };
      })
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

    console.log(`[Tier 6 Summary]`);
    console.log(`- Hardware Profile: High Performance Dedicated (16 vCPU, 32GB RAM)`);
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

