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
