import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { configureEvents } from "../src/events/events.js";
import { defaultStormDestruction, sanitizeStormDestruction, stormDestructionEngineSection, stormDestructionOn, stormDestructionPercent,
  stormDestructionStatus } from "../src/events/stormdestruction.js";
import { clientToken, dedicatedServerToken, get, post, startBackend } from "./helpers.js";

// PongooDev/CoreV2#395: 5.40's Storm Destruction, the game's mega storm. Epic's switch is Athena.bMegaStormEnabled, which
// 5.40's and 5.41's paks set on and 6.00's off; the hotfix sets it on 5.40 and 5.41 only, and the gameserver gets the
// share of matches in its warmup answer.
const v540 = 4352937;
const v541 = 4363240;
const v530 = 4305896;
const v600 = 4402180;
const v601 = 4424678;

test("Storm Destruction's setting: Epic's dates and 10% by default, a bad mode or share keeps the current one", () => {
  assert.deepEqual(defaultStormDestruction, { mode: "dates", percent: 10 });
  assert.deepEqual(sanitizeStormDestruction(undefined), { mode: "dates", percent: 10 });
  assert.deepEqual(sanitizeStormDestruction({ mode: "always", percent: "25" }), { mode: "always", percent: 25 });
  assert.deepEqual(sanitizeStormDestruction({ mode: "sometimes", percent: 101 }, { mode: "off", percent: 40 }), { mode: "off", percent: 40 });
  assert.deepEqual(sanitizeStormDestruction({ percent: -1 }, { mode: "always", percent: 0 }), { mode: "always", percent: 0 });
  assert.deepEqual(sanitizeStormDestruction({ percent: 33.6 }), { mode: "dates", percent: 34 });
  assert.equal(stormDestructionPercent({ mode: "auto", stormDestruction: { mode: "off", percent: 70 } }), 70);
  assert.equal(stormDestructionPercent({ mode: "auto" }), 10);
});

test("Epic's switch runs on Epic's dates on Season 5's replay on 5.40, always or never by the setting, and only on 5.40 and 5.41", () => {
  const withEvents = (stormDestruction) => configureEvents({ mode: "auto", seasonStarts: { 5: "2018-07-12" }, ...(stormDestruction ? { stormDestruction } : {}) });
  try {
    withEvents();
    const before = new Date("2018-09-06T23:00:00Z");
    const during = new Date("2018-09-07T15:00:00Z");
    const after = new Date("2018-09-08T01:00:00Z");
    assert.equal(stormDestructionOn(v540, before), false);
    assert.equal(stormDestructionOn(v540, during), true);
    assert.equal(stormDestructionOn(v540, after), false);
    // Epic's days were 5.40's: 5.41 shipped with it off ("no longer destroys structures").
    assert.equal(stormDestructionOn(v541, during), false);
    // The builds before 5.40 have no mega storm, and 6.00's, 6.01's and 6.02's paks turn it off themselves: nothing served.
    for (const build of [v530, v600, v601, 4417689, 4442095, 4461277, 3532353]) {
      assert.equal(stormDestructionOn(build, during), null, String(build));
      assert.equal(stormDestructionEngineSection(build, during), "", String(build));
    }
    assert.equal(stormDestructionEngineSection(v540, during), "[ConsoleVariables]\r\nAthena.bMegaStormEnabled=1\r\n");
    assert.equal(stormDestructionEngineSection(v540, after), "[ConsoleVariables]\r\nAthena.bMegaStormEnabled=0\r\n");

    withEvents({ mode: "always", percent: 10 });
    assert.equal(stormDestructionOn(v540, after), true);
    assert.equal(stormDestructionOn(v541, after), true);
    withEvents({ mode: "always", percent: 0 });
    assert.equal(stormDestructionOn(v540, after), false, "no match gets it at 0%");
    withEvents({ mode: "off", percent: 100 });
    assert.equal(stormDestructionOn(v540, during), false);
    assert.equal(stormDestructionOn(v541, during), false);
    configureEvents({ mode: "off", seasonStarts: { 5: "2018-07-12" }, stormDestruction: { mode: "always", percent: 100 } });
    assert.equal(stormDestructionOn(v540, during), false, "the seasonal events off turn it off");

    withEvents({ mode: "dates", percent: 50 });
    const status = stormDestructionStatus(during);
    assert.deepEqual([status.mode, status.percent, status.inDates], ["dates", 50, true]);
    assert.deepEqual(status.builds, { [v540]: true, [v541]: false });
    assert.deepEqual(status.original, { start: "2018-09-07T00:00:00.000Z", end: "2018-09-08T00:00:00.000Z" });
  } finally {
    configureEvents(null);
  }
});

function engineIni(port, token, build) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: "/fortnite/api/cloudstorage/system/DefaultEngine.ini",
      headers: { "User-Agent": `game=Fortnite, engine=UE4, build=${build}`, Authorization: `bearer ${token}` } }, (res) => {
      const chunks = [];
      res.on("data", (chunk) => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8").split("\r\n")));
    });
    req.on("error", reject);
    req.end();
  });
}

test("the hotfix sets Athena.bMegaStormEnabled on 5.40 and 5.41 by the admin panel's setting, and the warmup answer has the share", async () => {
  const backend = await startBackend();
  try {
    const token = await clientToken(backend.port);
    const saved = await post(backend.port, "/admin/api/events/config", undefined, { stormDestruction: { mode: "always", percent: 25 } });
    assert.equal(saved.status, 200);
    assert.deepEqual(saved.body.events.stormDestruction, { mode: "always", percent: 25 });
    for (const build of ["++Fortnite+Release-5.40-CL-4352937", "++Fortnite+Release-5.41-CL-4363240"]) {
      const lines = await engineIni(backend.port, token, build);
      assert.deepEqual(lines.slice(-3), ["[ConsoleVariables]", "Athena.bMegaStormEnabled=1", ""], build);
    }
    for (const build of ["++Fortnite+Release-5.30-CL-4305896", "++Fortnite+Release-Cert-CL-3532353"]) {
      assert.ok(!(await engineIni(backend.port, token, build)).includes("[ConsoleVariables]"), build);
    }
    const overview = await get(backend.port, "/admin/api/events/overview");
    assert.deepEqual([overview.body.stormDestruction.mode, overview.body.stormDestruction.percent], ["always", 25]);
    assert.deepEqual(overview.body.stormDestruction.builds, { [v540]: true, [v541]: true });

    const server = await dedicatedServerToken(backend.port);
    const warmup = await post(backend.port, "/fortnite/api/game/v2/matchmakingservice/warmup", server, { phase: "Setup", accountIds: [], secondsLeft: 0 });
    assert.equal(warmup.status, 200);
    assert.equal(warmup.body.stormDestructionPercent, 25);

    await post(backend.port, "/admin/api/events/config", undefined, { stormDestruction: { mode: "off" } });
    assert.deepEqual((await engineIni(backend.port, token, "++Fortnite+Release-5.40-CL-4352937")).slice(-3),
      ["[ConsoleVariables]", "Athena.bMegaStormEnabled=0", ""]);
  } finally {
    backend.close();
  }
});
