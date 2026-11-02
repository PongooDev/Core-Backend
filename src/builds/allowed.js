import { sendError } from "../errors.js";
import { buildVersions, versionOf } from "./detect.js";

// Which builds may use this backend (Core-Backend #164): null for all of them, or a list of changelists from the builds
// Core knows (buildVersions) and otherBuilds, a changelist Core doesn't know (a later 2.x on 2.1's data). A request
// without a changelist (Core Launcher, a browser, the portal) is no game build and is never refused.
export const otherBuilds = "other";
export const buildChoices = () => [...Object.keys(buildVersions), otherBuilds];

// A changelist ("3724489"), its version ("1.8") or "other", as a choice; undefined for anything else.
function buildChoice(entry) {
  if (typeof entry !== "string" && typeof entry !== "number") return undefined;
  const text = String(entry).trim().replace(/^CL-/i, "");
  if (text.toLowerCase() === otherBuilds) return otherBuilds;
  if (text in buildVersions) return text;
  return Object.keys(buildVersions).find((changelist) => buildVersions[changelist] === text);
}

// allowedBuilds as given (the admin panel, config.json): null or "all" for every build, else a list of choices, oldest
// first. Every choice ticked is every build too (null), so builds Core learns later are allowed. undefined when it
// isn't a list, names no build, or names one Core doesn't know, so a mistyped version doesn't quietly drop.
export function allowedBuildList(value) {
  if (value === null || (typeof value === "string" && value.trim().toLowerCase() === "all")) return null;
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const chosen = value.map(buildChoice);
  if (chosen.includes(undefined)) return undefined;
  const choices = buildChoices();
  return choices.every((choice) => chosen.includes(choice)) ? null : choices.filter((choice) => chosen.includes(choice));
}

const isChangelist = (changelist) => /^\d+$/.test(String(changelist ?? ""));

export function allowsBuild(allowedBuilds, changelist) {
  if (!Array.isArray(allowedBuilds) || !isChangelist(changelist)) return true;
  return allowedBuilds.includes(String(changelist)) || (!(changelist in buildVersions) && allowedBuilds.includes(otherBuilds));
}

// "1.8 (CL-3724489)", or "CL-3900000" for a build Core doesn't know.
export const buildName = (changelist) => (versionOf(changelist) ? `${versionOf(changelist)} (CL-${changelist})` : `CL-${changelist}`);

const allowedNames = (allowedBuilds) => allowedBuilds.map((choice) => (choice === otherBuilds ? "builds Core doesn't know" : versionOf(choice))).join(", ");

// The refusal of a build that isn't allowed. The game shows its own text for it, not this message: the login's
// "Unable to login to Fortnite servers. Please try again later." (UOnlineAccountCommon FailedLoginMsg, as for any
// login error whose message names neither "account has been locked" nor "account credentials"), and so on.
export function buildNotAllowed(res, allowedBuilds, changelist) {
  sendError(res, 403, "errors.com.epicgames.common.version_not_allowed",
    `Fortnite ${buildName(changelist)} isn't allowed on this backend. Allowed: ${allowedNames(allowedBuilds)}.`);
}
