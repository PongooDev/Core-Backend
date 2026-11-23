import http from "node:http";
import https from "node:https";
import express from "express";

// Epic's static asset host, static-assets-prod.epicgames.com (Core-Backend #419). 8.20 to 8.40's Creative hub names the
// picture behind each of its five Battle Royale island rifts by a URL on it, set in the hub's own assets (8.40's
// pakchunk10_s6: https://static-assets-prod.epicgames.com/fn/static/creative/<center|ne|nw|se|sw>_br_island_portal.jpg;
// the exe has none of these strings). It is an epicgames.com host, so the client's redirect sends the download here
// (Host: the backend) and no route had it: the rifts showed no picture, and the unknown-route log listed the five.
// Epic still serves them (checked 2026-11-23: 200, image/jpeg, the same 1920x1080 Creative picture for all five), so
// the backend fetches each from Epic's host and passes it back, as it tunnels Epic's image CDN (imagehosts.js). Only
// picture files under /fn/static are fetched, and only from that one host: the backend is no open proxy. Core ships none
// of Epic's pictures; with Epic's host unreachable the game gets the error and keeps the rift's own look.
export const epicStaticAssetsOrigin = "https://static-assets-prod.epicgames.com";
export const staticAssetsPath = /^\/fn\/static\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:jpe?g|png)$/;

const forwardedHeaders = ["accept", "user-agent", "if-none-match", "if-modified-since", "range"];
const returnedHeaders = ["content-type", "content-length", "etag", "last-modified", "cache-control", "expires", "accept-ranges", "content-range"];

export function staticAssetsRoutes(config = {}) {
  const router = express.Router();
  const origin = new URL(config.staticAssetsOrigin ?? epicStaticAssetsOrigin);
  const transport = origin.protocol === "http:" ? http : https;

  const relay = (req, res, next) => {
    if (!staticAssetsPath.test(req.path) || req.path.split("/").some((part) => part === "." || part === "..")) return next();
    const headers = Object.fromEntries(forwardedHeaders.filter((name) => req.headers[name] !== undefined).map((name) => [name, req.headers[name]]));
    const upstream = transport.request({ protocol: origin.protocol, host: origin.hostname, port: origin.port || undefined, method: req.method,
      path: req.path, headers: { ...headers, host: origin.host }, timeout: 30_000 }, (response) => {
      res.status(response.statusCode ?? 502);
      for (const name of returnedHeaders) if (response.headers[name] !== undefined) res.setHeader(name, response.headers[name]);
      response.pipe(res);
    });
    upstream.on("timeout", () => upstream.destroy(new Error("timeout")));
    upstream.on("error", () => (res.headersSent ? res.destroy() : res.status(502).end()));
    res.on("close", () => upstream.destroy());
    upstream.end();
  };
  router.get(/^\/fn\/static\//, relay);
  router.head(/^\/fn\/static\//, relay);
  return router;
}
