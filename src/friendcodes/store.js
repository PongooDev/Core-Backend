import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { readJson, writeJson } from "../json-file.js";

// The friend codes Core has issued (Core-Backend #35), for every account in one file (friendcodes.json):
//   {codes: {<code>: {accountId, codeType, backend: "epic", created}}}
// A code is issued by IssueFriendCode for one of the player's code tokens (profiles/friendcodes.js) and listed by
// GET /fortnite/api/game/v2/friendcodes/<accountId>/epic until it is redeemed. Nothing in the Cert client redeems one:
// the friend code screen only shows https://www.epicgames.com/fortnite/redeem?code=<code> (FriendCodePC), Epic's
// website, so every code Core issues stays listed.

// 🟡 Core's format: four groups of five from letters and digits that can't be misread (no 0/O, 1/I/L).
const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const codePattern = /^[A-HJKMNP-Z2-9]{5}(-[A-HJKMNP-Z2-9]{5}){3}$/;

function randomCode() {
  const group = () => Array.from({ length: 5 }, () => alphabet[crypto.randomInt(alphabet.length)]).join("");
  return [group(), group(), group(), group()].join("-");
}

export function createFriendCodeStore(dataDir) {
  const file = path.join(dataDir, "friendcodes.json");
  let codes = null;
  const load = () => (codes ??= fs.existsSync(file) ? readJson(file).codes ?? {} : {});
  const save = () => writeJson(file, { codes: load() });

  return {
    // A new code, unique among every code Core has issued, kept with the account that issued it.
    issue(accountId, codeType, backend = "epic") {
      const all = load();
      let code;
      do code = randomCode(); while (all[code]);
      all[code] = { accountId, codeType, backend, created: new Date().toISOString() };
      save();
      return { code, codeType };
    },

    get: (code) => (load()[code] ? { code, ...load()[code] } : null),

    // FIssuedFriendCode {CodeId, CodeType, DateCreated} for each of the account's codes on that backend, oldest first.
    unredeemed: (accountId, backend = "epic") => Object.entries(load())
      .filter(([, entry]) => entry.accountId === accountId && entry.backend === backend.toLowerCase() && !entry.redeemedBy)
      .sort(([, a], [, b]) => a.created.localeCompare(b.created))
      .map(([codeId, entry]) => ({ codeId, codeType: entry.codeType, dateCreated: entry.created }))
  };
}
