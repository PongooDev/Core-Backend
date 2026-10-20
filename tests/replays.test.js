import { test } from "node:test";
import assert from "node:assert/strict";
import { certUserAgent, dedicatedServerToken, post, send, startBackend } from "./helpers.js";

const name = "e5fd6b7dd7f3e764936386fb125a3323";
const base = `/replay/v2/replay/${name}`;

// The streamer's binary uploads: application/octet-stream bodies.
function upload(port, path, token, bytes) {
  return send({ host: "127.0.0.1", port, method: "POST", path, headers: {
    "User-Agent": certUserAgent, Authorization: `bearer ${token}`, "Content-Type": "application/octet-stream", "Content-Length": bytes.length
  } }, bytes);
}

test("a server can record a replay from start to stop, the way the Cert streamer uploads one", async () => {
  const backend = await startBackend();
  try {
    const token = await dedicatedServerToken(backend.port);
    const started = await post(backend.port, `${base}?app=FortniteGame&version=2&cl=3532353&friendlyName=Zone_Onboarding_Suburban_a`, token,
      { users: ["b3dc7e2f6317f25b34440175e7e0f9e7"] });
    assert.equal(started.status, 200);
    assert.deepEqual(started.body, { sessionId: name });

    const chunk = Buffer.alloc(64 * 1024, 7);
    for (const path of [
      `${base}/file/replay.header?numChunks=0&time=0`,
      `${base}/file/stream.0?numChunks=1&time=5000&mTime1=0&mTime2=5000&absSize=65536`,
      `${base}/event?group=checkpoint&time1=0&time2=5000&meta=0&incrementSize=false`,
      `${base}/event?group=PlayerElim&time1=100&time2=100&meta=x&incrementSize=false`,
      `${base}/event/${name}_PlayerElim?group=PlayerElim&time1=100&time2=100&meta=x&incrementSize=false`
    ]) {
      assert.equal((await upload(backend.port, path, token, chunk)).status, 204, path);
    }
    assert.equal((await post(backend.port, `${base}/users`, token, { users: ["d8b4359930fc30c1135125870d3352c0"] })).status, 204);
    assert.equal((await upload(backend.port, `${base}/stopUploading?numChunks=1&time=5000&absSize=65536`, token, Buffer.alloc(0))).status, 204);
    assert.equal((await post(backend.port, `${base}?shouldKeep=true`, token)).status, 204);
  } finally {
    backend.close();
  }
});

test("replay uploads need a Core token", async () => {
  const backend = await startBackend();
  try {
    const refused = await post(backend.port, `${base}?app=FortniteGame&version=2&cl=3532353&friendlyName=Zone`, undefined, { users: [] });
    assert.equal(refused.status, 401);
  } finally {
    backend.close();
  }
});
