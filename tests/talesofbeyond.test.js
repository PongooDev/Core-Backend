import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { eventCard } from "../src/admin/eventschedules.js";
import { inBuild } from "../src/builds/context.js";
import { activeEventFlags } from "../src/events/events.js";
import { eventQuestLine } from "../src/events/quests.js";
import { season9Flag, season9Phase1 } from "../src/events/talesofbeyond.js";
import { questIdOf } from "../src/profiles/quests.js";
import { openSession } from "../src/profiles/session.js";
import { createProfileStore } from "../src/profiles/store.js";
import { clientQuestLogin } from "../src/services/mcp/commands/ClientQuestLogin.js";

// Save the World's Tales of Beyond (9.00, CL-6337466, Core-Backend #435): QuestMapData's callout and Season9AQuestMap's
// pages by EventFlag.Season9.Phase1, and the S9_*_A line from its first quest.
const v900 = "6337466";
const v851 = "6165369";
const withSession = (build, run) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "core-talesofbeyond-"));
  try {
    return inBuild(build, () => run(openSession(createProfileStore(dir), "lokfinder")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
};
const questIds = (session) => Object.values(session.profile("profile0").profile.items).map(questIdOf).filter(Boolean);

test("9.00 serves EventFlag.Season9 and EventFlag.Season9.Phase1 with Wargames' flag; 8.51 serves neither and keeps Spring 2019", () => {
  const flags900 = inBuild(v900, () => activeEventFlags());
  assert.ok(flags900.includes(season9Flag) && flags900.includes(season9Phase1));
  assert.ok(flags900.includes("EventFlag.Outpost"));
  assert.ok(!flags900.some((flag) => flag.startsWith("EventFlag.Spring2019")));
  const flags851 = inBuild(v851, () => activeEventFlags());
  assert.ok(!flags851.includes(season9Flag) && !flags851.includes(season9Phase1));
  assert.deepEqual(eventCard("talesOfBeyond").flags, [season9Flag, season9Phase1]);
});

test("9.00's quest line is Season9AQuestMap's 15 A quests, not the B ones", () => {
  const line = inBuild(v900, () => eventQuestLine(season9Phase1));
  assert.equal(line.size, 15);
  assert.ok(line.has("s9_fetch_quest_a1") && line.has("s9_gathercollect_quest_a15"));
  assert.ok(![...line].some((questId) => /_b\d+$/.test(questId)));
});

test("9.00's quest login gives S9_Fetch_Quest_A1 beside Wargames' quests; 8.51's doesn't", () => {
  withSession(v900, (session) => {
    clientQuestLogin({ session, notifications: [], profileId: "profile0" });
    const held = questIds(session);
    assert.ok(held.includes("s9_fetch_quest_a1"));
    assert.deepEqual(held.filter((id) => id.startsWith("s9_")), ["s9_fetch_quest_a1"], "the rest follow by hidden rewards");
    assert.ok(held.includes("wargame_quest_firstopen"));
  });
  withSession(v851, (session) => {
    clientQuestLogin({ session, notifications: [], profileId: "profile0" });
    assert.ok(!questIds(session).some((id) => id.startsWith("s9_")));
  });
});
