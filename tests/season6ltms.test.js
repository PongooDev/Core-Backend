import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { configureEvents } from "../src/events/events.js";
import { defaultReplacements, fortnitemaresOutage, hasLtm, inOriginalWindow, ltmOn, ltms, ltmSchedule, nextLtmChange } from "../src/events/ltms.js";
import { calendarRevision } from "../src/services/fortnite/calendar.js";
import { createSettingsStore } from "../src/settings/store.js";
import { post, startBackend } from "./helpers.js";

// Core-Backend #367: Season 6's Original dates, as 90sNath's list has them (and the sources where they say more), each on
// the builds whose paks have the mode's playlist; and Fortnitemares Duos' and Squads' launch-day outage, an option.
const v6000 = "4395664";
const v600 = "4402180";
const v601 = "4424678";
const v602 = "4461277";
const v610 = "4480234";
const v620 = "4497486";
const v621 = "4526925";
const v622 = "4543176";
const v630 = "4573096";
const v631 = "4573279";
const season6Builds = [v6000, v600, "4417689", v601, "4442095", v602, "4464155", "4476098", v610, v620, v621, v622, v630, v631];
const replay = { mode: "auto", seasonStarts: { 6: "2018-09-27" } };
const at = (iso) => new Date(iso);
const withConfig = (config, run) => {
  configureEvents(config);
  try {
    return run();
  } finally {
    configureEvents(null);
  }
};
const dated = { ltmOriginalDates: true };
const outage = { ltmOriginalDates: true, fortnitemaresOutage: true };

// Each window: the LTM, the build, its first moment and the moment after its last.
const windows = [
  ["soaring50s", v600, "2018-09-27T00:00:00Z", "2018-10-10T00:00:00Z"],
  ["soaring50s", v601, "2018-09-27T00:00:00Z", "2018-10-10T00:00:00Z"],
  ["discoDomination602", v602, "2018-10-10T00:00:00Z", "2018-10-16T00:00:00Z"],
  ["discoDomination602", v610, "2018-10-16T00:00:00Z", "2018-10-24T00:00:00Z"],
  ["fortnitemares2018Solo", v620, "2018-10-24T00:00:00Z", "2018-11-04T18:00:00Z"],
  ["fortnitemares2018Duos", v620, "2018-10-24T00:00:00Z", "2018-11-04T18:00:00Z"],
  ["fortnitemares2018Squads", v620, "2018-10-24T00:00:00Z", "2018-11-04T18:00:00Z"],
  ["discoDomination602", v621, "2018-11-04T18:00:00Z", "2018-11-06T00:00:00Z"],
  ["blitzSeason6Solo", v622, "2018-11-06T00:00:00Z", "2018-11-09T00:00:00Z"],
  ["teamTerror", v622, "2018-11-06T00:00:00Z", "2018-11-14T00:00:00Z"],
  ["discoDomination32", v622, "2018-11-09T00:00:00Z", "2018-11-14T00:00:00Z"],
  ["discoDomination32", v630, "2018-11-14T00:00:00Z", "2018-11-27T00:00:00Z"],
  ["foodFight", v630, "2018-11-14T00:00:00Z", "2018-11-27T00:00:00Z"],
  ["wildWestSolo", v630, "2018-11-20T00:00:00Z", "2018-11-27T00:00:00Z"],
  ["teamRumble", v631, "2018-11-27T00:00:00Z", "2018-12-06T00:00:00Z"],
  ["highExplosivesSeason6Solo", v631, "2018-11-27T00:00:00Z", "2018-12-06T00:00:00Z"]
];
const before = (iso) => new Date(Date.parse(iso) - 60000);

test("#367: each Season 6 mode runs its window on its build, from its first moment to the moment after its last", () => {
  withConfig(replay, () => {
    for (const [id, build, start, end] of windows) {
      assert.equal(hasLtm(id, build), true, `${id}: ${build}'s paks have it`);
      if (start !== "2018-09-27T00:00:00Z") assert.equal(inOriginalWindow(id, build, before(start), dated), false, `${id} before ${start}`);
      assert.equal(inOriginalWindow(id, build, at(start), dated), true, `${id} at ${start}`);
      assert.equal(inOriginalWindow(id, build, before(end), dated), true, `${id} before ${end}`);
      assert.equal(inOriginalWindow(id, build, at(end), dated), false, `${id} at ${end}`);
    }
  });
});

test("#367: the windows are their builds' alone", () => {
  withConfig(replay, () => {
    // Soaring 50's: 6.00's and 6.01's in Season 6 (6.02 is Disco Domination's), and 5.21's as before.
    assert.equal(inOriginalWindow("soaring50s", v6000, at("2018-10-01T12:00:00Z"), dated), true, "6.00.0 plays on 6.00's data");
    assert.equal(inOriginalWindow("soaring50s", v602, at("2018-10-09T12:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("soaring50s", v630, at("2018-11-20T12:00:00Z"), dated), false, "6.30's paks keep it, the list doesn't date it there");
    // Disco Domination's 4 to 6 November is 6.21's Playlist_Disco; 6.22's paks keep only the 32 a side one.
    assert.equal(inOriginalWindow("discoDomination602", v620, at("2018-11-05T12:00:00Z"), dated), false);
    assert.equal(hasLtm("discoDomination602", v622), false);
    assert.equal(inOriginalWindow("discoDomination32", v621, at("2018-11-05T12:00:00Z"), dated), false);
    assert.equal(inOriginalWindow("discoDomination32", v631, at("2018-11-28T12:00:00Z"), dated), false, "Team Rumble's");
    assert.equal(inOriginalWindow("discoDomination32", v602, at("2018-10-12T12:00:00Z"), dated), false, "6.02's is Playlist_Disco");
    // 6.30's other 32 a side Disco Domination stays by its switch.
    assert.equal(inOriginalWindow("discoDomination32Alt630", v630, at("2018-11-20T12:00:00Z"), dated), false);
    // Food Fight runs beside Wild West from the Content Update's day.
    for (const id of ["foodFight", "wildWestSolo", "wildWestDuos", "wildWestSquads"]) {
      assert.equal(ltmOn(id, v630, dated, at("2018-11-22T12:00:00Z")), true, id);
    }
  });
});

test("#367: Original dates on, 6.22's lobby has Blitz! or Disco Domination at every hour of its days, never neither", () => {
  withConfig(replay, () => {
    for (let moment = Date.parse("2018-11-06T00:00:00Z"); moment < Date.parse("2018-11-14T00:00:00Z"); moment += 3600000) {
      const now = new Date(moment);
      const blitz = ltmOn("blitzSeason6Solo", v622, dated, now);
      const disco = ltmOn("discoDomination32", v622, dated, now);
      assert.equal(blitz !== disco, true, `${now.toISOString()}: Blitz! ${blitz}, Disco Domination ${disco}`);
      assert.equal(ltmOn("teamTerror", v622, dated, now), true, now.toISOString());
    }
  });
});

test("#367: Close Encounters, Sniper Shootout and Solid Gold are in no Season 6 build's paks", () => {
  const theirs = ltms.filter((ltm) => /^Playlist_(Close|Snipers|SolidGold)/.test(ltm.playlistName ?? ""));
  assert.ok(theirs.length >= 9, "Seasons 3 to 5 have them");
  for (const build of season6Builds) {
    for (const ltm of theirs) assert.equal(hasLtm(ltm.id, build), false, `${ltm.id} on ${build}`);
  }
});

test("#367: the outage option takes Fortnitemares Duos and Squads off from 11:15 to 15:15 UTC on 24 October, Original dates only", () => {
  assert.deepEqual(fortnitemaresOutage, { start: Date.parse("2018-10-24T11:15:00Z"), end: Date.parse("2018-10-24T15:15:00Z") });
  withConfig(replay, () => {
    for (const id of ["fortnitemares2018Duos", "fortnitemares2018Squads"]) {
      assert.equal(inOriginalWindow(id, v620, at("2018-10-24T11:14:00Z"), outage), true, id);
      assert.equal(inOriginalWindow(id, v620, at("2018-10-24T11:15:00Z"), outage), false, id);
      assert.equal(inOriginalWindow(id, v620, at("2018-10-24T15:14:00Z"), outage), false, id);
      assert.equal(inOriginalWindow(id, v620, at("2018-10-24T15:15:00Z"), outage), true, id);
      assert.equal(inOriginalWindow(id, v620, at("2018-11-04T17:59:00Z"), outage), true, `${id} to Fortnitemares' end`);
      // Off, the whole window.
      assert.equal(inOriginalWindow(id, v620, at("2018-10-24T13:00:00Z"), dated), true, id);
    }
    assert.equal(inOriginalWindow("fortnitemares2018Solo", v620, at("2018-10-24T13:00:00Z"), outage), true, "Solo stays");
    // In the outage the normal Duos and Squads are back in the lobby; Solo stays replaced.
    assert.deepEqual(Object.keys(defaultReplacements(v620, outage, at("2018-10-24T13:00:00Z"))), ["Playlist_DefaultSolo"]);
    assert.deepEqual(Object.keys(defaultReplacements(v620, outage, at("2018-10-24T16:00:00Z"))).sort(),
      ["Playlist_DefaultDuo", "Playlist_DefaultSolo", "Playlist_DefaultSquad"]);
    assert.equal(Object.keys(defaultReplacements(v620, dated, at("2018-10-24T13:00:00Z"))).length, 3, "off, all three replaced");
    // The calendar's next change is the outage's start, then its end.
    assert.equal(nextLtmChange(v620, outage, at("2018-10-24T10:00:00Z")).toISOString(), "2018-10-24T11:15:00.000Z");
    assert.equal(nextLtmChange(v620, outage, at("2018-10-24T12:00:00Z")).toISOString(), "2018-10-24T15:15:00.000Z");
    assert.equal(nextLtmChange(v620, dated, at("2018-10-24T10:00:00Z")).toISOString(), "2018-11-04T18:00:00.000Z");
  });
  // Original dates off: the switches, as before, whatever the option says.
  const now = at("2018-10-24T13:00:00Z");
  for (const id of ["fortnitemares2018Duos", "fortnitemares2018Squads"]) {
    assert.equal(withConfig(replay, () => ltmOn(id, v620, { fortnitemaresOutage: true }, now)), true, id);
  }
});

test("#367: the admin panel's schedule shows the option and Duos' two windows while it is on", () => {
  const duos = (settingsValue) => ltmSchedule(settingsValue).list.find(({ id }) => id === "fortnitemares2018Duos");
  assert.equal(ltmSchedule({}).fortnitemaresOutage, false, "off by default");
  assert.equal(ltmSchedule({ fortnitemaresOutage: true }).fortnitemaresOutage, true);
  assert.deepEqual(duos({}).windows.map(({ start, end }) => [start, end]), [["2018-10-24", "2018-11-04T18:00:00.000Z"]]);
  assert.deepEqual(duos({ fortnitemaresOutage: true }).windows.map(({ start, end }) => [start, end]),
    [["2018-10-24", "2018-10-24T11:15:00.000Z"], ["2018-10-24T15:15:00.000Z", "2018-11-04T18:00:00.000Z"]]);
  const solo = ltmSchedule({ fortnitemaresOutage: true }).list.find(({ id }) => id === "fortnitemares2018Solo");
  assert.equal(solo.windows.length, 1);
  // Disco Domination (32 v 32) now has dates: 6.22's and 6.30's.
  const disco32 = ltmSchedule({}).list.find(({ id }) => id === "discoDomination32");
  assert.deepEqual(disco32.windows.map(({ builds, start, last }) => [builds, start, last]), [["6.22", "2018-11-09", "2018-11-13"], ["6.30", "2018-11-14", "2018-11-26"],
    // and the 14 Days of Fortnite's on 7.00 (tests/build700.test.js).
    ["7.00", "2018-12-23", "2018-12-24"]]);
  const soaring = ltmSchedule({}).list.find(({ id }) => id === "soaring50s");
  assert.deepEqual(soaring.windows.map(({ builds, start, last }) => [builds, start, last]), [["5.21", "2018-08-15", "2018-08-22"], ["6.00.0 to 6.01", "2018-09-27", "2018-10-09"]]);
});

test("#367: the option is saved, off by default, and the calendar revision changes only when it is on", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-367-"));
  try {
    const store = createSettingsStore(dir);
    assert.equal(store.get().fortnitemaresOutage, false);
    store.update({ fortnitemaresOutage: true });
    store.update({ fortnitemaresOutage: "yes" });
    assert.equal(createSettingsStore(dir).get().fortnitemaresOutage, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  const base = { ltmOriginalDates: true, matchmakingModes: { solo: true } };
  assert.equal(calendarRevision({ ...base, fortnitemaresOutage: false }), calendarRevision(base));
  assert.notEqual(calendarRevision({ ...base, fortnitemaresOutage: true }), calendarRevision(base));
});

test("#367: the matchmaking config route saves the option and Reset Defaults turns it off", async () => {
  const backend = await startBackend();
  try {
    const saved = await post(backend.port, "/admin/api/matchmaking/config", undefined, { fortnitemaresOutage: true });
    assert.equal(saved.status, 200);
    assert.equal(saved.body.ltms.fortnitemaresOutage, true);
    const ignored = await post(backend.port, "/admin/api/matchmaking/config", undefined, { fortnitemaresOutage: "off" });
    assert.equal(ignored.body.ltms.fortnitemaresOutage, true, "only a boolean changes it");
    const reset = await post(backend.port, "/admin/api/matchmaking/actions/reset-defaults", undefined, {});
    assert.equal(reset.body.ltms.fortnitemaresOutage, false);
  } finally {
    backend.close();
  }
});

test("#367: Original dates off, every Season 6 mode is by its switch as before", () => {
  const defaults = createSettingsStore(null).get();
  const now = at("2018-11-10T12:00:00Z");
  withConfig(replay, () => {
    for (const [id, build] of [["discoDomination32", v622], ["discoDomination32", v630], ["soaring50s", v600], ["foodFight", v630],
      ["discoDomination602", v621], ["fortnitemares2018Duos", v620]]) {
      const byHand = ltms.find((ltm) => ltm.id === id).defaultOn ? defaults.matchmakingModes[id] !== false : defaults.matchmakingModes[id] === true;
      assert.equal(ltmOn(id, build, defaults, now), byHand, `${id} on ${build}`);
    }
  });
});
