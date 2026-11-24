import { test } from "node:test";
import assert from "node:assert/strict";
import { inBuild } from "../src/builds/context.js";
import { activeEventFlags, configureEvents, currentEventsConfig, holdEvents, releaseHeldEvents, withEventsHeld } from "../src/events/events.js";
import { worldInfo } from "../src/world/theaters.js";

// Core-Backend #428/#429: 8.40's world info read the events config 128,000 times (a settings copy each) and rebuilt the
// event flags 12,000 times, seconds of blocked event loop per world/info that held up every other request.
test("the world info reads the events config once and builds the event flags once per build", (t) => {
  let reads = 0;
  configureEvents(() => {
    reads++;
    return { mode: "auto" };
  });
  t.after(() => configureEvents(null));
  inBuild("6005771", () => worldInfo(new Date("2026-11-24T13:00:00Z")));
  assert.equal(reads, 1);
});

test("held event flags are copies, and a new hold reads the config afresh", (t) => {
  let config = { mode: "auto" };
  configureEvents(() => config);
  t.after(() => configureEvents(null));
  inBuild("6005771", () => withEventsHeld(() => {
    const flags = activeEventFlags();
    flags.push("EventFlag.NotOne");
    assert.ok(!activeEventFlags().includes("EventFlag.NotOne"));
    config = { mode: "off" };
    assert.equal(currentEventsConfig().mode, "auto");
    assert.deepEqual(activeEventFlags(), flags.slice(0, -1));
    // A season start recorded during the request (app.js configureSeasonStarts) is read from then on.
    releaseHeldEvents();
    assert.equal(currentEventsConfig().mode, "off");
    assert.deepEqual(activeEventFlags(), []);
  }));
  inBuild("6005771", () => withEventsHeld(() => assert.deepEqual(activeEventFlags(), [])));
});

test("game requests hold the events config, the admin panel's don't", (t) => {
  let reads = 0;
  configureEvents(() => {
    reads++;
    return { mode: "auto" };
  });
  t.after(() => configureEvents(null));
  holdEvents({ path: "/fortnite/api/game/v2/world/info" }, null, () => {
    currentEventsConfig();
    currentEventsConfig();
  });
  assert.equal(reads, 1);
  holdEvents({ path: "/admin/api/settings" }, null, () => {
    currentEventsConfig();
    currentEventsConfig();
  });
  assert.equal(reads, 3);
});
