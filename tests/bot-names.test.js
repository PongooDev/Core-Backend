import { test } from "node:test";
import assert from "node:assert/strict";
import { takenBotNames } from "../src/services/matchmaking/warmup.js";
import { dedicatedServerToken, post, startBackend, userLogin } from "./helpers.js";

// CoreV2 #446: no player bot plays under a registered player's display name. The gameserver's warmup report lists the
// names its bots may take (botNames), and the answer's takenBotNames is those an account has, compared without case.

test("takenBotNames: the reported names an account has, without case; none asked, none given", () => {
  const names = new Map([["leo_x", {}], ["zlegacy", {}]]);
  const accounts = { findByName: (name) => names.get(name.toLowerCase()) };
  assert.deepEqual(takenBotNames(accounts, ["Leo_x", "ZLEGACY", "Tate_2009", "Leo_x", 7, ""]), ["Leo_x", "ZLEGACY"]);
  assert.deepEqual(takenBotNames(accounts, []), []);
  assert.equal(takenBotNames(accounts, undefined), undefined);
  assert.equal(takenBotNames(accounts, "Leo_x"), undefined);
});

test("the warmup answer has the bot names registered players have, and nothing for a server that sends none", async () => {
  const backend = await startBackend();
  try {
    await userLogin(backend.port, "Leo_x");
    const server = await dedicatedServerToken(backend.port);
    const warmup = (body) => post(backend.port, "/fortnite/api/game/v2/matchmakingservice/warmup", server, { phase: "Setup", accountIds: [], secondsLeft: 0, ...body });
    const asked = await warmup({ botNames: ["leo_X", "Tate_2009", "zLegacy"] });
    assert.equal(asked.status, 200);
    assert.deepEqual(asked.body.takenBotNames, ["leo_X"]);
    // A player who registers later is in the next match's answer.
    await userLogin(backend.port, "Tate_2009");
    assert.deepEqual((await warmup({ botNames: ["leo_X", "Tate_2009", "zLegacy"] })).body.takenBotNames, ["leo_X", "Tate_2009"]);
    const old = await warmup({});
    assert.equal(old.status, 200);
    assert.equal("takenBotNames" in old.body, false);
  } finally {
    backend.close();
  }
});
