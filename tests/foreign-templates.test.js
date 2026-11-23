import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { dataBuilds } from "../src/gamedata/read.js";
import { isForeignTemplate, prepareForeignTemplates } from "../src/gamedata/templates.js";
import { get, startBackend } from "./helpers.js";

// Core-Backend #417: every data build's template ids were read on the first profile sent, holding the backend's thread
// for about 8 s on a tester's PC, so the first login after the launcher started the backend failed. They are read once
// the backend listens, a build per event loop turn, and requests are answered meanwhile.
test("every build's template ids are read a build at a time after start, with requests answered meanwhile", async () => {
  const backend = await startBackend();
  try {
    let prepared = false;
    const preparing = prepareForeignTemplates().then(() => (prepared = true));
    const answered = await get(backend.port, "/core/api/status");
    assert.equal(answered.status, 200);
    assert.equal(prepared, false, "a request is answered before every build's data has been read");
    await preparing;

    const started = performance.now();
    // 7.00 (CL-4629139) has no Arctic_Medium island, which 7.10 added (build710.test.js).
    assert.equal(inBuild("4629139", () => isForeignTemplate("CreativePlot:arctic_medium")), true);
    assert.equal(inBuild("4667333", () => isForeignTemplate("CreativePlot:arctic_medium")), false);
    assert.ok(performance.now() - started < 50, "nothing is left to read once prepared");
    assert.ok(dataBuilds.length > 1);
  } finally {
    backend.close();
  }
});
