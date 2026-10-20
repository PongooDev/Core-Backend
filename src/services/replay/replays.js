import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { log } from "../../log.js";

// The replay service a Cert server records each zone to (UE 4.16 FHttpNetworkReplayStreamer, ServerURL
// https://fnreplay-public-service-prod11.ol.epicgames.com/replay/v2/). Its upload calls (format strings in the exe)
// and the answers its handlers accept:
// - POST replay/{name}?app&version&cl&friendlyName with {users} → 200 and {sessionId}, the name every later call uses
//   (HttpStartUploadingFinished sub_1D14E10: anything else, or JSON without it, stops the recording).
// - POST replay/{name}/file/replay.header?numChunks&time, …/file/stream.{n}?numChunks&time&mTime1&mTime2&absSize,
//   …/users {users}, …/stopUploading?numChunks&time&absSize and …?shouldKeep=true|false → 204 (sub_1D13F00,
//   sub_1D15950, sub_1D111D0, sub_1D151E0, sub_1D15F80).
// - POST replay/{name}/event?group=checkpoint…, …/event?group=…, …/event/{event}?group=… → 200 or 204 (sub_1D154B0,
//   sub_1D15750).
// Core keeps no replays: uploads are read and dropped, and the playback calls (startDownloading, viewer, downloads,
// the replay list) are not served.
export function replayRoutes({ tokens }) {
  const router = express.Router();
  const base = "/replay/v2/replay/:name";
  const auth = requireAuth(tokens);
  // Mounted ahead of the app's JSON parser, so binary uploads reach drain unread; only these two calls send JSON.
  const json = express.json();
  const recordings = new Map();

  // Header, stream chunks and events come as application/octet-stream: count them and move on.
  const drain = (req, res, next) => {
    if (req.readableEnded) return next();
    let bytes = 0;
    req.on("data", (chunk) => { bytes += chunk.length; });
    req.on("end", () => {
      const recording = recordings.get(req.params.name);
      if (recording) recording.bytes += bytes;
      next();
    });
  };
  const noContent = (req, res) => res.status(204).end();

  router.post(base, auth, json, (req, res) => {
    const { name } = req.params;
    if (req.query.shouldKeep !== undefined) return res.status(204).end();
    const users = Array.isArray(req.body?.users) ? req.body.users.map(String) : [];
    recordings.set(name, { friendlyName: String(req.query.friendlyName ?? ""), users, bytes: 0 });
    // A server that dies mid-recording never stops it; keep the map from growing without end.
    if (recordings.size > 100) recordings.delete(recordings.keys().next().value);
    log("Replay", `Recording ${req.query.friendlyName || "a match"} as ${name} for ${users.join(", ") || "no players"} (not kept)`);
    res.json({ sessionId: name });
  });

  router.post(`${base}/file/:file`, auth, drain, noContent);
  router.post(`${base}/users`, auth, json, noContent);
  router.post([`${base}/event`, `${base}/event/:event`], auth, drain, noContent);

  router.post(`${base}/stopUploading`, auth, drain, (req, res) => {
    const recording = recordings.get(req.params.name);
    recordings.delete(req.params.name);
    const seconds = Math.round(Number(req.query.time ?? 0) / 1000);
    log("Replay", `Recording ${req.params.name} ended: ${req.query.numChunks ?? 0} chunks, ${seconds} s${recording ? `, ${recording.bytes} bytes received` : ""}`);
    res.status(204).end();
  });

  return router;
}
