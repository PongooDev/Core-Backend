import { AsyncLocalStorage } from "node:async_hooks";
import { getBuild } from "./detect.js";

// The build of the process a request came from: the changelist its User-Agent names (clients and the gameserver both
// send it), for everything the request does, however deep (game data lookups, src/gamedata/read.js). Work that no
// request started (timers, the admin panel's background jobs) has none and gets Cert's data.
const storage = new AsyncLocalStorage();

export function requestBuild(req, res, next) {
  storage.run(getBuild(req), next);
}

export const currentBuild = () => storage.getStore();

export const inBuild = (changelist, fn) => storage.run(changelist, fn);

// Work the server does on an account that isn't that account's own client asking (the admin panel, a redeem code, a
// tournament prize, a gift's receiver, a web purchase): inBuild still picks whose game data it reads, but no client is
// playing that build, so nothing takes up its season or reshapes the profile for it (profiles/seasons.js
// namesAthenaBuild). The account's next request from its own build does that.
const serverSide = new AsyncLocalStorage();

export const onTheServer = (fn) => serverSide.run(true, fn);

export const isOnTheServer = () => serverSide.getStore() === true;
