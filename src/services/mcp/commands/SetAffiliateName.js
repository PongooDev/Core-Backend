import { McpError } from "../../../errors.js";
import { creatorNamed } from "../../../store/creators.js";

// SetAffiliateName {affiliateName} (UFortMcpProfileCommonCore's, new in 6.02: CL-4461277's SDK against 6.01's, the one
// MCP command 6.02 adds): the creator the player supports, Support-A-Creator's code (store/creators.js). The item shop's
// modal sends it with a name from the hotfixed creators list, and reads the choice back from common_core's stats:
// mtx_affiliate, the name, and mtx_affiliate_set_time, when it was set (UFortMcpProfileCommonCore::GetAffiliateName,
// CL-4461277 0x1082890, parses it as ISO 8601 and drops the name once AffiliateExpirationSeconds have passed since).
// Core didn't know the command, so a 6.02 client sending it would have been told "Unknown command SetAffiliateName"
// (errors.com.epicgames.fortnite.operation_not_found); none did, as the feature is off until the hotfix turns it on.
//
// An enabled creator code (the admin panel's, Core-Backend #349) is kept as the panel spells it, with the time; an empty
// name clears the choice, as 6.02's modal sends when it finds no entry (6.20's sends the typed code). One that isn't an
// enabled code is refused and nothing changes (🟡 Core's error: Epic's code
// for an unknown creator isn't recorded; the modal closes the same way on any answer). The same creator again keeps
// the name and starts its time over, as choosing it again did on Epic ("players can select the same Creator Code for
// another 14-day period").
export function setAffiliateName({ req, session }) {
  const given = typeof req.body?.affiliateName === "string" ? req.body.affiliateName.trim() : "";
  const name = given ? creatorNamed(given) : "";
  if (name === null) throw new McpError("errors.com.epicgames.fortnite.invalid_affiliate_name", `${given} isn't a creator on this server`);
  const tracker = session.profile("profile0");
  const { attributes } = tracker.profile.stats;
  if (!name && !attributes.mtx_affiliate) return;
  if (attributes.mtx_affiliate !== name) tracker.setStat("mtx_affiliate", name);
  tracker.setStat("mtx_affiliate_set_time", new Date().toISOString());
}
