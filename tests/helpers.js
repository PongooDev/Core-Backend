import { once } from "node:events";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import tls from "node:tls";
import { createServer } from "../src/server.js";

export const certUserAgent = "game=Fortnite, engine=UE4, build=++Fortnite+Release-Cert-CL-3532353";

export async function startBackend() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "core-backend-"));
  const server = await createServer({ dataDir });
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
      fs.rmSync(dataDir, { recursive: true, force: true });
    }
  };
}

export function send(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = "";
      res.setEncoding("utf8");
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
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

export function requestToken(port, form, clientId = certClient) {
  const body = new URLSearchParams(form).toString();
  return send({
    host: "127.0.0.1",
    port,
    method: "POST",
    path: "/account/api/oauth/token",
    headers: {
      Authorization: `basic ${Buffer.from(`${clientId}:secret`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": certUserAgent
    }
  }, body);
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
