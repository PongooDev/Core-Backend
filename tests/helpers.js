import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createServer } from "../src/server.js";

export const certUserAgent = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3532353";

// A search for an empty server that finds none is answered at once unless a test asks for the wait the backend
// otherwise makes (emptyServerWaitMs, src/services/matchmaking/sessions.js). So is an EndPrimaryMission whose game
// session has had no EarnScore (earnScoreWaitMs, src/profiles/scores.js).
export async function startBackend(config = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  const server = await createServer({ dataDir, requestLog: false, emptyServerWaitMs: 0, earnScoreWaitMs: 0, ...config });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    dataDir,
    port: server.address().port,
    unknownLog(build) {
      const file = path.join(dataDir, "logs", "unknown", `${build}.jsonl`);
      return fs.readFileSync(file, "utf8").trim().split("\n").map((line) => JSON.parse(line));
    },
    close() {
      server.closeAllConnections();
      server.close();
      // Windows can hold a just-written file for a moment (indexing, antivirus): retry instead of failing the run.
      fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    }
  };
}

export function send(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        const json = (res.headers["content-type"] ?? "").startsWith("application/json");
        resolve({ status: res.statusCode, headers: res.headers, body: data ? (json ? JSON.parse(data) : data) : null });
      });
    });
    req.on("error", reject);
    req.end(body);
  });
}

export async function openTunnel(port, host) {
  const req = http.request({ host: "127.0.0.1", port, method: "CONNECT", path: `${host}:443` });
  req.end();
  const [, socket] = await once(req, "connect");
  const secure = tls.connect({ socket, servername: host, rejectUnauthorized: false });
  await once(secure, "secureConnect");
  return secure;
}

export const certClient = "ec684b8c687f479fadea3cb2ad83f5c6";

export function requestToken(port, form, clientId = certClient, secret = "secret") {
  const body = new URLSearchParams(form).toString();
  return send({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: "/account/api/oauth/token",
    headers: {
      Authorization: `basic ${Buffer.from(`${clientId}:${secret}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": certUserAgent
    }
  }, body);
}

// What a Core gameserver's MCP requests carry: the DedicatedServer client's token (src/accounts/clients.js).
export async function dedicatedServerToken(port) {
  const response = await requestToken(port, { grant_type: "client_credentials" }, "313dfed3ec3023e52d3be9dda178bdfa", "111aa434a6780d54f5cf759149639f20");
  return response.body.access_token;
}

export async function clientToken(port) {
  const response = await requestToken(port, { grant_type: "client_credentials", token_type: "eg1" });
  return response.body.access_token;
}

export function get(port, path, token) {
  const headers = { "User-Agent": certUserAgent };
  if (token) headers.Authorization = `bearer ${token}`;
  return send({ host: "127.0.0.1", port, path, headers });
}

export async function userLogin(port, username) {
  const response = await requestToken(port, { grant_type: "password", username, password: "test" });
  return { token: response.body.access_token, accountId: response.body.account_id };
}

export function del(port, path, token) {
  return send({ host: "127.0.0.1", port, method: "DELETE", path, headers: { "User-Agent": certUserAgent, Authorization: `bearer ${token}` } });
}

export function post(port, path, token, body) {
  const headers = { "User-Agent": certUserAgent };
  if (token) headers.Authorization = `bearer ${token}`;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  return send({ host: "127.0.0.1", port, method: "POST", path, headers }, body === undefined ? undefined : JSON.stringify(body));
}

// Any verb, JSON body optional (PUT updates, DELETE with a body). Node only sizes bodies itself for some verbs, so
// the length is always sent, as the game's HTTP client does.
export function request(port, method, path, token, body) {
  const headers = { "User-Agent": certUserAgent };
  if (token) headers.Authorization = `bearer ${token}`;
  const text = body === undefined ? undefined : JSON.stringify(body);
  if (text !== undefined) Object.assign(headers, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(text) });
  return send({ host: "127.0.0.1", port, method, path, headers }, text);
}
