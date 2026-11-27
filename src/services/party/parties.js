import crypto from "node:crypto";
import express from "express";
import { requireAuth } from "../../accounts/auth.js";
import { getBuild } from "../../builds/detect.js";
import { sendError } from "../../errors.js";
import { accountUri, channelUri, describeToken } from "../../vivox/tokens.js";

// Epic's party service (/party/api/v1/{namespace}), which OnlineSubsystemMcp's FOnlinePartySystemMcpV2 uses when
// [OnlineSubsystemMcp] bUsePartySystemV2 is set (CheckPartySystemVersion, 8.30 CL-5793395 0x56B180). 8.30's ini sets
// it, so its login creates the player's party here: GET .../user/{id} (FUserSummaryResponse: current, invites, pending,
// pings), then POST .../parties. Without this service that POST got a 404 and the login ended in "Failed To Create
// Party" (UFortniteOnlineAccount::LoginStep_CreatingPartyCreateComplete).
//
// What the client reads (8.30's JSON readers): a party (FPartyInfo 0x485720) needs id, revision, config, members,
// invites, applicants, meta and created_at; its config (0x4851F0) invite_ttl, join_confirmation, joinability and
// max_size; a member (0x484B20) account_id, connections, joined_at, meta, revision and role (CAPTAIN or MEMBER); a
// connection (0x4845F0) id and meta, with connected_at and disconnected_at optional. A join answers {status, party_id}
// (FPartyJoinResponse 0x483D40).
//
// Every change is pushed to the party's members over XMPP as a notification from xmpp-admin whose body is the
// notification (xmpp/service.js notifyRaw), com.epicgames.social.party.notification.v0.<TYPE>; 8.30 reads
// member_state_updated, member_state_removed, captain_id, party_privacy_type, max_number_of_members,
// party_state_updated, party_state_removed, party_state_overrode, inviter_id and invitee_id from them.
//
// Pings (9.10, CL-6573057: FOnlinePartySystemMcpV2's PartyUser requests CreatePing 0x3F8B90, DeletePing 0x3F9280 and
// JoinPartyFromPing 0x3F9F60, new beside 9.01's): POST and DELETE .../user/{accountId}/pings/{fromAccountId}, and POST .../pings/{fromAccountId}/join,
// a ping being a player's request that another join their party without an invite. Its notification is PING, which 9.01
// already read ({ns, pinger_id, expires}, 9.10 0x566C80, with the pinger's display name), and the user summary lists the
// pings sent to a player. The token's account is the pinger when it creates one, and the joiner when it joins from one:
// either of the URL's two accounts, the other being the one pinged or the pinger.
//
// Voice (9.21, CL-6922310, addresses from the image base; not in 9.20 or 9.10): with [VoiceChatManager]
// bObtainJoinTokenFromPartyService, the VoiceChatManager's party channel join (0x711F70, beside createJoinToken's
// 0x7116C0) asks the party system for its Vivox join token instead of the MCP's createJoinToken:
// FOnlinePartySystemMcpV2::GetVoiceChannelConnectionInfo (0x4EE470) runs
// FOnlinePartyAsyncTaskGetVoiceChannelConnectionInfo, whose CreateHttpRequest (0x3F3D30) is POST
// .../parties/{partyId}/members/{accountId}/conferences/connection with {"providers":{"vivox":{}}} (0x3A9880,
// 0x42AEC0). The answer (FConferenceConnectionResponse 0x3DDEE0 -> FConferenceProviders 0x3DE170 -> FVivoxConnection
// 0x3DE840) must have providers.vivox.authorization_token, channel_uri and user_uri, all strings. The manager joins its
// own channel name (FVivoxVoiceChat's sip:confctl-g-<namespace>.p-<name>@<domain>, the name being the party id and a
// suffix) with authorization_token as the credentials; channel_uri and user_uri are only kept. Answered while the
// backend points the build at its Vivox emulator (vivox/service.js servesBuild), with the tokens
// services/fortnite/voice.js gives 8.20+ (account ".<issuer>.<accountId>.", issuer as namespace); otherwise the unknown
// route, as voice.js does.
//
// Parties live in memory, as they did for Epic only while their members were online: a restarted backend has none,
// and the client makes a new one at its next login.

const notificationType = (type) => `com.epicgames.social.party.notification.v0.${type}`;
// A ping's life (Epic's service let one stand an hour).
const pingTtlSeconds = 3600;
const defaultConfig = { type: "DEFAULT", joinability: "OPEN", discoverability: "ALL", sub_type: "default", max_size: 16,
  invite_ttl: 14400, join_confirmation: false, intention_ttl: 60 };
const configKeys = Object.keys(defaultConfig);

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
// Meta is a flat map of strings (the client's urn:epic:...:<name>_<type> keys); anything else is dropped.
function cleanMeta(value) {
  const meta = {};
  if (!isObject(value)) return meta;
  for (const [key, item] of Object.entries(value)) {
    if (["__proto__", "prototype", "constructor"].includes(key)) continue;
    if (["string", "number", "boolean"].includes(typeof item)) meta[key] = String(item);
  }
  return meta;
}

function applyMeta(meta, { update, delete: removed }) {
  const updated = cleanMeta(update);
  const deleted = Array.isArray(removed) ? removed.filter((key) => typeof key === "string") : [];
  for (const key of deleted) delete meta[key];
  Object.assign(meta, updated);
  return { updated, deleted };
}

function cleanConfig(value, base = defaultConfig) {
  const config = { ...base };
  if (!isObject(value)) return config;
  for (const key of configKeys) {
    if (value[key] === undefined || typeof value[key] !== typeof defaultConfig[key]) continue;
    config[key] = value[key];
  }
  config.max_size = Math.min(16, Math.max(1, Math.trunc(config.max_size)));
  return config;
}

function partyError(res, status, code, message, vars = []) {
  return sendError(res, status, `errors.com.epicgames.social.party.${code}`, message, vars);
}

export function createPartyStore() {
  const parties = new Map(); // id -> party
  const pings = new Map(); // pinged account id -> [ping]
  const livePings = (accountId) => {
    const live = (pings.get(accountId) ?? []).filter((ping) => Date.parse(ping.expires_at) > Date.now());
    if (live.length) pings.set(accountId, live);
    else pings.delete(accountId);
    return live;
  };
  return {
    parties,
    pings,
    pingsTo: livePings,
    pingFrom: (accountId, pingerId) => livePings(accountId).find((ping) => ping.sent_by === pingerId) ?? null,
    addPing: (ping) => pings.set(ping.sent_to, [...livePings(ping.sent_to).filter((entry) => entry.sent_by !== ping.sent_by), ping]),
    removePing: (accountId, pingerId) => {
      const left = livePings(accountId).filter((ping) => ping.sent_by !== pingerId);
      if (left.length) pings.set(accountId, left);
      else pings.delete(accountId);
    },
    get: (id) => parties.get(id) ?? null,
    of: (accountId) => [...parties.values()].find((party) => party.members.some((member) => member.account_id === accountId)) ?? null,
    invitesTo: (accountId) => [...parties.values()].flatMap((party) => party.invites.filter((invite) => invite.sent_to === accountId))
  };
}

export function partyRoutes({ tokens, accounts, xmpp, vivox, parties = createPartyStore() }) {
  const router = express.Router();
  const base = "/party/api/v1/:namespace";
  const now = () => new Date().toISOString();
  const displayName = (accountId) => accounts?.get?.(accountId)?.displayName ?? accountId;
  const captainOf = (party) => party.members.find((member) => member.role === "CAPTAIN");
  const memberOf = (party, accountId) => party.members.find((member) => member.account_id === accountId);

  function notify(party, type, payload, recipients = party.members.map((member) => member.account_id)) {
    const body = { type: notificationType(type), sent: now(), ns: party.ns, party_id: party.id, ...payload };
    for (const accountId of new Set(recipients)) xmpp?.notifyRaw?.(accountId, body);
  }

  function changed(party) {
    party.revision += 1;
    party.updated_at = now();
  }

  // Takes a member out: the others (and the member) hear why; the first one left becomes captain if the captain went,
  // and a party nobody is in is gone.
  function removeMember(party, member, type) {
    const recipients = party.members.map((entry) => entry.account_id);
    party.members = party.members.filter((entry) => entry !== member);
    changed(party);
    notify(party, type, { account_id: member.account_id, revision: party.revision, member_state_updated: {} }, recipients);
    if (!party.members.length) {
      parties.parties.delete(party.id);
      return;
    }
    if (member.role === "CAPTAIN") {
      const next = party.members[0];
      next.role = "CAPTAIN";
      changed(party);
      notify(party, "MEMBER_NEW_CAPTAIN", { account_id: next.account_id, revision: party.revision, member_state_updated: {} });
    }
  }

  function newMember(accountId, joinInfo) {
    const at = now();
    const connection = isObject(joinInfo?.connection) ? joinInfo.connection : {};
    return {
      account_id: accountId,
      meta: cleanMeta(joinInfo?.meta),
      connections: [{
        id: typeof connection.id === "string" ? connection.id : "",
        connected_at: at,
        updated_at: at,
        yield_leadership: connection.yield_leadership === true,
        meta: cleanMeta(connection.meta)
      }],
      revision: 0,
      updated_at: at,
      joined_at: at,
      role: "MEMBER"
    };
  }

  function joinedNotice(party, member) {
    return {
      account_id: member.account_id,
      account_dn: member.meta["urn:epic:member:dn_s"] ?? displayName(member.account_id),
      connection: member.connections[0],
      revision: party.revision,
      member_state_updated: member.meta,
      joined_at: member.joined_at,
      updated_at: member.updated_at
    };
  }

  // The party and, for member routes, the member, or the error the service gave.
  function findParty(req, res, next) {
    const party = parties.get(req.params.partyId);
    if (!party) return partyError(res, 404, "party_not_found", `Sorry, we couldn't find a party by id ${req.params.partyId}`, [req.params.partyId]);
    req.party = party;
    next();
  }
  const own = (req, res, next) => (req.session.accountId === req.params.accountId ? next()
    : partyError(res, 403, "not_authorized", "This token cannot act for that account"));
  const inParty = (req, res, next) => (memberOf(req.party, req.session.accountId) ? next()
    : partyError(res, 403, "not_a_member", `${req.session.accountId} is not a member of party ${req.party.id}`, [req.session.accountId]));
  const captain = (req, res, next) => (captainOf(req.party)?.account_id === req.session.accountId ? next()
    : partyError(res, 403, "not_leader", `${req.session.accountId} is not the captain of party ${req.party.id}`, [req.session.accountId]));
  const auth = requireAuth(tokens);

  router.get(`${base}/user/:accountId`, auth, own, (req, res) => {
    const party = parties.of(req.params.accountId);
    res.json({ current: party ? [party] : [], pending: [], invites: parties.invitesTo(req.params.accountId),
      pings: parties.pingsTo(req.params.accountId) });
  });

  router.post(`${base}/parties`, auth, (req, res) => {
    const accountId = req.session.accountId;
    const body = isObject(req.body) ? req.body : {};
    // One party per player: making a new one leaves the old (Epic's answered user_has_party; the client then left it).
    const previous = parties.of(accountId);
    if (previous) removeMember(previous, memberOf(previous, accountId), "MEMBER_LEFT");
    const at = now();
    const member = newMember(accountId, body.join_info);
    member.role = "CAPTAIN";
    const party = {
      id: crypto.randomUUID().replace(/-/g, ""),
      created_at: at,
      updated_at: at,
      config: cleanConfig(body.config),
      members: [member],
      applicants: [],
      meta: cleanMeta(body.meta),
      invites: [],
      revision: 0,
      intentions: []
    };
    Object.defineProperty(party, "ns", { value: req.params.namespace, enumerable: false });
    parties.parties.set(party.id, party);
    res.json(party);
  });

  router.get(`${base}/parties/:partyId`, auth, findParty, (req, res) => res.json(req.party));

  // The captain's change to the party: its config and meta (PARTY_UPDATED to everyone in it).
  router.patch(`${base}/parties/:partyId`, auth, findParty, captain, (req, res) => {
    const party = req.party;
    const body = isObject(req.body) ? req.body : {};
    party.config = cleanConfig(body.config, party.config);
    const { updated, deleted } = applyMeta(party.meta, isObject(body.meta) ? body.meta : {});
    changed(party);
    notify(party, "PARTY_UPDATED", {
      captain_id: captainOf(party)?.account_id,
      party_state_updated: updated,
      party_state_removed: deleted,
      party_state_overrode: {},
      party_privacy_type: party.config.joinability,
      party_type: party.config.type,
      party_sub_type: party.config.sub_type,
      max_number_of_members: party.config.max_size,
      invite_ttl_seconds: party.config.invite_ttl,
      created_at: party.created_at,
      updated_at: party.updated_at,
      revision: party.revision
    });
    res.status(204).end();
  });

  // A member's own state (outfit, readiness, ...): MEMBER_STATE_UPDATED to everyone in the party.
  router.patch(`${base}/parties/:partyId/members/:accountId/meta`, auth, own, findParty, inParty, (req, res) => {
    const party = req.party;
    const member = memberOf(party, req.params.accountId);
    const { updated, deleted } = applyMeta(member.meta, isObject(req.body) ? req.body : {});
    member.revision += 1;
    member.updated_at = now();
    changed(party);
    notify(party, "MEMBER_STATE_UPDATED", {
      account_id: member.account_id,
      account_dn: member.meta["urn:epic:member:dn_s"] ?? displayName(member.account_id),
      member_state_updated: updated,
      member_state_removed: deleted,
      joined_at: member.joined_at,
      updated_at: member.updated_at,
      revision: member.revision
    });
    res.status(204).end();
  });

  // Leaving (one's own account) or a kick (the captain, another member's).
  router.delete(`${base}/parties/:partyId/members/:accountId`, auth, findParty, inParty, (req, res) => {
    const party = req.party;
    const member = memberOf(party, req.params.accountId);
    if (!member) return partyError(res, 404, "member_not_found", `${req.params.accountId} is not in party ${party.id}`, [req.params.accountId]);
    const self = req.params.accountId === req.session.accountId;
    if (!self && captainOf(party)?.account_id !== req.session.accountId) {
      return partyError(res, 403, "not_leader", `${req.session.accountId} is not the captain of party ${party.id}`, [req.session.accountId]);
    }
    removeMember(party, member, self ? "MEMBER_LEFT" : "MEMBER_KICKED");
    res.status(204).end();
  });

  // The token's account joins the party (its join info: connection and meta), or the service's refusal. A ping from one of
  // its members lets the one pinged in as an invite does.
  function joinParty(res, party, accountId, joinInfo, pinged = false) {
    if (!memberOf(party, accountId)) {
      const invited = pinged || party.invites.some((invite) => invite.sent_to === accountId);
      if (party.config.joinability === "INVITE_ONLY" && !invited) {
        return partyError(res, 403, "party_join_forbidden", `${accountId} isn't invited to party ${party.id}`, [accountId, party.id]);
      }
      if (party.members.length >= party.config.max_size) {
        return partyError(res, 409, "party_is_full", `Party ${party.id} is full`, [party.id]);
      }
      const previous = parties.of(accountId);
      if (previous) removeMember(previous, memberOf(previous, accountId), "MEMBER_LEFT");
      const member = newMember(accountId, joinInfo);
      party.members.push(member);
      party.invites = party.invites.filter((invite) => invite.sent_to !== accountId);
      changed(party);
      notify(party, "MEMBER_JOINED", joinedNotice(party, member));
    }
    return res.json({ status: "JOINED", party_id: party.id });
  }

  // The joiner is the token's account. 8.30's JoinParty puts the account whose party it joins through in the URL
  // (its JoinInfo's SourceUserId: .../members/<the inviter or friend>/join, Core-Backend #416), so the URL's account
  // only has to be the joiner or someone already in the party.
  router.post(`${base}/parties/:partyId/members/:accountId/join`, auth, findParty, (req, res) => {
    if (req.params.accountId !== req.session.accountId && !memberOf(req.party, req.params.accountId)) {
      return partyError(res, 403, "not_authorized", "This token cannot act for that account");
    }
    return joinParty(res, req.party, req.session.accountId, req.body);
  });

  // The two accounts of a ping route: the token's and the other, or null when the token is neither.
  const pingPair = (req) => {
    const { accountId, fromAccountId } = req.params;
    const self = req.session.accountId;
    if (self === fromAccountId) return { self, other: accountId };
    if (self === accountId) return { self, other: fromAccountId };
    return null;
  };

  // A ping: the token's account asks the other to join its party (PING to the one pinged).
  router.post(`${base}/user/:accountId/pings/:fromAccountId`, auth, (req, res) => {
    const pair = pingPair(req);
    if (!pair || pair.self === pair.other) return partyError(res, 403, "not_authorized", "This token cannot act for that account");
    const at = new Date();
    const ping = {
      sent_by: pair.self,
      sent_to: pair.other,
      sent_at: at.toISOString(),
      expires_at: new Date(at.getTime() + pingTtlSeconds * 1000).toISOString(),
      meta: cleanMeta(req.body?.meta ?? req.body)
    };
    parties.addPing(ping);
    xmpp?.notifyRaw?.(ping.sent_to, { type: notificationType("PING"), sent: ping.sent_at, ns: req.params.namespace,
      pinger_id: ping.sent_by, pinger_dn: displayName(ping.sent_by), expires: ping.expires_at, meta: ping.meta });
    res.json(ping);
  });

  // A ping taken back by its pinger, or dismissed by the one pinged.
  router.delete(`${base}/user/:accountId/pings/:fromAccountId`, auth, (req, res) => {
    const pair = pingPair(req);
    if (!pair) return partyError(res, 403, "not_authorized", "This token cannot act for that account");
    parties.removePing(req.params.accountId, req.params.fromAccountId);
    parties.removePing(req.params.fromAccountId, req.params.accountId);
    res.status(204).end();
  });

  // Joining from a ping: the token's account joins the other's party, whoever pinged whom.
  router.post(`${base}/user/:accountId/pings/:fromAccountId/join`, auth, (req, res) => {
    const pair = pingPair(req);
    if (!pair || pair.self === pair.other) return partyError(res, 403, "not_authorized", "This token cannot act for that account");
    const party = parties.of(pair.other);
    if (!party) return partyError(res, 404, "user_has_no_party", `${pair.other} has no party to join`, [pair.other]);
    const pinged = Boolean(parties.pingFrom(pair.self, pair.other));
    parties.removePing(req.params.accountId, req.params.fromAccountId);
    parties.removePing(req.params.fromAccountId, req.params.accountId);
    return joinParty(res, party, pair.self, req.body, pinged);
  });

  router.post(`${base}/parties/:partyId/members/:accountId/promote`, auth, findParty, captain, (req, res) => {
    const party = req.party;
    const next = memberOf(party, req.params.accountId);
    if (!next) return partyError(res, 404, "member_not_found", `${req.params.accountId} is not in party ${party.id}`, [req.params.accountId]);
    for (const member of party.members) member.role = member === next ? "CAPTAIN" : "MEMBER";
    changed(party);
    notify(party, "MEMBER_NEW_CAPTAIN", { account_id: next.account_id, revision: party.revision, member_state_updated: {} });
    res.status(204).end();
  });

  // Join confirmation is off in the config Core keeps (join_confirmation false), so nobody waits to be confirmed.
  for (const action of ["confirm", "reject"]) {
    router.post(`${base}/parties/:partyId/members/:accountId/${action}`, auth, findParty, captain, (req, res) => res.status(204).end());
  }

  router.post(`${base}/parties/:partyId/invites/:accountId`, auth, findParty, inParty, (req, res) => {
    const party = req.party;
    const at = new Date();
    const invite = {
      party_id: party.id,
      sent_by: req.session.accountId,
      meta: cleanMeta(req.body),
      sent_to: req.params.accountId,
      sent_at: at.toISOString(),
      updated_at: at.toISOString(),
      expires_at: new Date(at.getTime() + party.config.invite_ttl * 1000).toISOString(),
      status: "SENT"
    };
    party.invites = party.invites.filter((entry) => entry.sent_to !== invite.sent_to);
    party.invites.push(invite);
    notify(party, "INITIAL_INVITE", {
      inviter_id: invite.sent_by,
      inviter_dn: displayName(invite.sent_by),
      invitee_id: invite.sent_to,
      meta: invite.meta,
      sent_at: invite.sent_at,
      updated_at: invite.updated_at,
      expires_at: invite.expires_at,
      friends_ids: [],
      members_count: party.members.length
    }, [invite.sent_to]);
    res.status(204).end();
  });

  const voiceServed = (req, res, next) => (vivox?.servesBuild(getBuild(req)) ? next() : next("route"));
  router.post(`${base}/parties/:partyId/members/:accountId/conferences/connection`, voiceServed, auth, own, findParty, inParty, (req, res) => {
    const { issuer, domain } = vivox.keys;
    const player = `${issuer}.${req.params.accountId}`;
    const channel = `confctl-g-${issuer}.p-${req.party.id}`;
    const token = vivox.keys.mint({ action: "join", player, channel });
    vivox.say(`party service join token for ${req.params.accountId}, party ${req.party.id} (build ${getBuild(req)}): ${describeToken(token)}`);
    res.json({ providers: { vivox: { authorization_token: token, channel_uri: channelUri(channel, domain), user_uri: accountUri(player, domain) } } });
  });

  router.post(`${base}/parties/:partyId/invites/:accountId/decline`, auth, own, findParty, (req, res) => {
    req.party.invites = req.party.invites.filter((invite) => invite.sent_to !== req.params.accountId);
    res.status(204).end();
  });

  return router;
}
