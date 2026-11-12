import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { getBuild } from "../../builds/detect.js";
import { sendError } from "../../errors.js";
import { lootHotfixSection } from "../../events/contentupdates.js";
import { lastSelectedPlaylistOf, ltmForcedQueues, ltmFrontEndPlaylists, ltmNewMode, ltmPlaylistOverrides } from "../../events/ltms.js";
import { finalFightRows } from "../../events/finalfight.js";
import { meteorStrikeRows } from "../../events/meteorstrike.js";
import { shootingTestGlobals, shootingTestHotfixTables } from "../../events/shootingtest.js";
import { stormDestructionEngineSection } from "../../events/stormdestruction.js";
import { sessionMembers } from "../../matchmaking/sessions.js";
import { affiliateRuntimeOptions } from "../../store/creators.js";
import { createNetwork, httpsProxied } from "../../network.js";
import { purchaseFlowSection } from "./purchase.js";

const validFilename = /^[A-Za-z0-9._-]{1,128}$/;

// System files are hotfixes. The client fetches them at start-up, before it logs in, and merges Default*.ini files
// into the matching config (UOnlineHotfixManager: DefaultEngine.ini -> Engine). Its XMPP connection is made at
// login and reads [OnlineSubsystemMcp.XMPP] then (sub_37C4C80 -> sub_37C22D0), so this points XMPP at the address
// and port the client reached this backend on, which is where XMPP is served (for a player on the internet, the
// public address it can reach this machine at: network.js reachableAddress). STOMP's service config takes Protocol
// and Domain from [OnlineSubsystemMcp.StompServiceMcp] the same way (sub_3808800); its URL is
// <Protocol>://<Domain>/stomp. Nothing is written on the player's PC.
// Behind a TLS-terminating reverse proxy (X-Forwarded-Proto: https, Core #197) STOMP is wss:// on the host the client
// used, which the proxy hands back to this backend. XMPP is a plain TCP stream no HTTP proxy carries, so it stays on
// this backend's own port, at publicAddress, else the proxy's host name (network.js reachableAddress).
// DefaultGame.ini turns off the client's cache of stats answers (Core #112). The Battle Royale stats screen's query
// (QueryPlayerStats, 1.7.2 0x72B700, 1.8 0x772F20) first looks its URL up in the MCP utils' response cache (1.7.2
// 0x70C760, 1.8 0x750DF0), which drops the answers older than UFortGlobals::TimeBetweenLeaderboardRequestsMinutes
// (+0x100) and answers from any other without a request. So a player who opened the screen before a match saw the
// stats from before it afterwards ("Last Updated" then): in Core #112 the teammate who had looked never asked
// again, the one who hadn't saw the match. Every answer is now older than 0 minutes. The hotfix reloads the config
// of the objects of each [/Script/<Module>.<Class>] section's class (1.7.2 HotfixIniFile 0x3B10AF0), the game
// singleton UFortGlobals among them; a build without the setting ignores it.
// The same setting also decides whether an answer that just came in is used at all (Core-Backend #101): the stats
// and leaderboard answer handlers (1.8 0x73FE90, 0x740CF0) use an answer only when the time its parse stamped
// (+0x68) plus TimeBetweenLeaderboardRequestsMinutes is no earlier than now, and otherwise fail it as "Invalid or
// Expired Data" (stats N/A, "Unable to retrieve leaderboard"). Up to 1.8 both times are FDateTime::UtcNow (1.8
// 0x1318F20), which counts in whole milliseconds, so a stamp taken microseconds earlier still equals now and 0 works.
// 1.8.1 (CL-3729133) stamps and checks with FPlatformTime::Seconds in ticks instead (0x6F3980, QueryPerformanceCounter;
// its handlers 0x71D440, 0x71DF80, parsers 0x730560, 0x72FDA0), so every stamp is already earlier than now and 0
// fails every answer. From 1.8.1 on an answer is kept for a minute: one asked for again within a minute of the last
// comes from the cache, and a match ends more than a minute after the lobby the player last looked from.
const freshStatsBuild = 3729133;
// Shooting Test #1's builds (2.4 to 2.5, events/shootingtest.js) also get its UFortGlobals setting, and its weapon stats
// table in the [AssetHotfix] section.
const gameFile = (minutes, globals = []) => ["[/Script/FortniteGame.FortGlobals]", `TimeBetweenLeaderboardRequestsMinutes=${minutes}`, ...globals, ""].join("\r\n");
const statsAnswerMinutes = (changelist) => (Number(changelist) >= freshStatsBuild ? 1 : 0);
// Season 2's content updates (events/contentupdates.js, Core-Backend #156) come last, as an [AssetHotfix] section that
// replaces the Battle Royale loot tables with the updated ones, as Epic's hotfixes did: on 1.11 those in by the season's
// date (or all, as the admin panel chooses), on 2.1 all of them and its Cozy Campfire. It is the gameserver's copy of
// the tables that drops the loot, so the server has to take this file too, before its match places any. 3.6's Season 3
// finale (events/meteorstrike.js: the TVs' static, the skybox audio, the meteors) shares the section, as AthenaGameData
// RowUpdates, for the client (the TVs, the audio) and the server (the meteors) alike.
// Custom matchmaking keys (Core-Backend #186, matchmaking/service.js) are Battle Royale's from 2.4 (CL-3858292) on: the
// lobby shows its Custom Matchmaking Key action while UFortMatchmakingV2's bCustomKeyEnabled is set (2.4 0x7390E0 reads
// +0x4C), and only then does the ticket carry the key (0x756340). This file comes before login, with no account, so it
// can't tell players apart: every 2.4 and later player sees the action, as on Epic's 2.4, and the matchmaking service
// decides whose key opens a match.
const customKeyBuild = 3858292;
const customKeySection = (changelist) => (Number(changelist) >= customKeyBuild
  ? ["[/Script/FortniteGame.FortMatchmakingV2]", "bCustomKeyEnabled=true", ""].join("\r\n") : "");
// 3.0's lobby queues past AthenaEvent8 (events/ltms.js) have no event flag a region state could force on: UFortGlobals'
// bEvent<N>ForceEnabled turns each on (UFortGameInstance::IsEvent_X_ForceEnabled, 3.0 0xBBBE60), unless the player's
// region is in UFortGameInstance's RegionsWithBattleRoyaleEvent<N>QueueDisabled, which is cleared for it. The client
// takes this file at start-up, so a mode turned on or off shows once the game restarts.
const forcedQueueGlobals = (changelist) => ltmForcedQueues(changelist).map((queue) => `bEvent${queue}ForceEnabled=true`);
// 3.5.1 (CL-4000805) has neither setting: its modes are FortPlaylistAthena assets that UFortGameInstance's PlaylistOverrides
// (Config, {PlaylistName, bEnabled, RegionsDisabled}) turns on (events/ltms.js ltmPlaylistOverrides), one entry a playlist
// on (🟡: not seen in a running client).
// From 5.0 the lobby lists FrontEndPlaylistData (events/ltms.js ltmFrontEndPlaylists, Core-Backend #314): the shipped list
// (the defaults, 50v50 and Playground, all enabled) is cleared and set again, so the lobby offers what the matchmaking
// ticket takes. The defaults are as shipped; 5.0's PlaylistAccess has bDisplayAsNew where 5.10's on has AdvertiseType.
const frontEndDefaults = [["Playlist_DefaultDuo", 1], ["Playlist_DefaultSquad", 2], ["Playlist_DefaultSolo", 0]];
const advertiseTypeBuild = 4225813;
function frontEndPlaylistLines(changelist) {
  const playlists = ltmFrontEndPlaylists(changelist);
  if (!playlists.length) return [];
  const advertise = (type) => (Number(changelist) >= advertiseTypeBuild ? `AdvertiseType=${type}` : `bDisplayAsNew=${type === "New"}`);
  const entry = (name, access) => `+FrontEndPlaylistData=(PlaylistName=${name}, PlaylistAccess=(${access}))`;
  return ["!FrontEndPlaylistData=ClearArray",
    ...frontEndDefaults.map(([name, priority]) => entry(name, `bEnabled=true, bIsDefaultPlaylist=true, bVisibleWhenDisabled=true, ` +
      `${advertise("None")}, bDisplayAsLimitedTime=false, DisplayPriority=${priority}`)),
    ...playlists.map(({ name, enabled, priority, ltm }) => entry(name, `bEnabled=${enabled}, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false, ` +
      `${advertise(ltm.id === "playgroundV2" ? "Updated" : ltm.advertise ?? "None")}, bDisplayAsLimitedTime=true, DisplayPriority=${priority}`))];
}
// The FortGameInstance section: the event queues' globals (3.0), the playlist overrides (3.5.1) and the lobby's playlists (5.0).
function forcedQueueSection(changelist) {
  const queues = ltmForcedQueues(changelist);
  const playlists = ltmPlaylistOverrides(changelist);
  const frontEnd = frontEndPlaylistLines(changelist);
  if (!queues.length && !playlists.length && !frontEnd.length) return "";
  return ["[/Script/FortniteGame.FortGameInstance]", ...queues.map((queue) => `!RegionsWithBattleRoyaleEvent${queue}QueueDisabled=ClearArray`),
    ...playlists.map((name) => `+PlaylistOverrides=(PlaylistName=${name},bEnabled=true)`), ...frontEnd, ""].join("\r\n");
}
// The Store tab's V-Bucks packs (Core-Backend #223) buy through the purchase flow, whose page is the game config's
// [EpicPurchaseFlow] Prod= (services/fortnite/purchase.js; the key is the MCP environment, "Prod" without -epicenv). This
// file's copy never reaches the flow (Core-Backend #244): UFortMcpContext::RegisterForEpicPurchasingDisplay (3.1 0xD496C0)
// reads the game ini once, the first time it is called (it returns early once its flow, +0x408, exists), and the caller is
// the root UIManager widget's Construct (BindDelegates), on the first frame of the front end, while the hotfix check only
// starts on the next frame and waits on the client login and version check. So the flow keeps the shipped DefaultGame.ini
// URL (https://launcher-website-prod07.ol.epicgames.com/purchase, seen in a 3.1 log), whatever this file says. The section
// stays, harmless, for the day something sets the value before the front end (only a config the game loads at start-up,
// such as the player's Saved/Config/WindowsClient/Game.ini, would).
// A build's new mode (events/ltms.js ltmNewMode, Core-Backend #237: Teams of 20 on 3.2) is the mode its lobby opens on.
// The matchmaking widget takes it from UFortGameUserSettings' LastSelectedPlaylist (3.2 0x279E970), its EFortAthenaPlaylist
// (AthenaEvent22, 14), so DefaultGameUserSettings.ini sets it: the hotfix merges it into the config whose name ends in
// GameUserSettings.ini (3.2 0x5E62D0, the player's Saved/Config GameUserSettings.ini) and reloads the
// [/Script/FortniteGame.FortGameUserSettings] objects (HotfixIniFile, 0x5E7190); Fortnite's WantsHotfixProcessing
// (0xD145B0) takes every Default*.ini. It comes at start-up, before the lobby, so each start opens on the new mode, and the
// player's own pick holds until the game restarts. No other build gets the file. On 3.5.1 LastSelectedPlaylist is the
// playlist's name (UFortGameUserSettings +0x230, an FName: 50v50 v2's Playlist_50v50).
function newModeFiles(changelist) {
  const ltm = ltmNewMode(changelist);
  return ltm ? { "DefaultGameUserSettings.ini": Buffer.from(["[/Script/FortniteGame.FortGameUserSettings]",
    `LastSelectedPlaylist=${lastSelectedPlaylistOf(ltm, changelist)}`, ""].join("\r\n"), "utf8") } : {};
}
// Battle Royale's global chat (Core-Backend #238). The client asks for a sub game's general chat rooms whenever it
// enters one (3.2: UFortOnlineAccount 0xD45940 -> 0xD4C450), first leaving its global room (0xD4E380). For Athena it
// asks only while UFortOnlineAccount's bIsAthenaGlobalChatEnabled (+0x8EB) is set; otherwise it marks the Global tab
// disabled ("Currently unavailable.", 0x734810) and asks for nothing. The shipped DefaultGame.ini has it false (2.5, 3.0,
// 3.1 and 3.2), so only a room from before the first switch (the login's request, as sub game "[NoMode]") ever showed in
// Battle Royale: Battle Royale, Save the World and back left Global unavailable. Core gives Battle Royale its own room
// (services/fortnite/chat.js). A build without the setting ignores it.
const chatSection = ["[/Script/FortniteGame.FortOnlineAccount]", "bIsAthenaGlobalChatEnabled=true", ""].join("\r\n");
// Battle Royale replays (Core-Backend #251), Season 3.5's: the client records each match itself, to its Saved/Demos folder
// (FLocalFileNetworkReplayStreamer, UnsavedReplay-<date>.replay), and the Career tab's Replays screen lists that folder; no
// service is asked. UFortRuntimeOptions (config RuntimeOptions, GetDefault: 3.5.2 0x105DD40) holds the game's three replay
// switches: bEnableReplayBrowser (+0x98) shows the Replays tab (0x29106E0), and bEnableReplayRecording (+0x99) and
// bEnableLargeTeamReplayRecording (+0x9A) gate the automatic recording (Fort.AutomaticClientReplayRecordingBR, 3.5.2
// 0xA35D90; 3.5.1 0xA321F0): a match records when the cvar is on, +0x99 is, the player's own Record Replays setting
// (UFortClientSettingsRecord bReplayRecordingEnabled, +0x4C7, on by default) is, and, in a large team game
// (AFortGameStateAthena bIsLargeTeamGame, +0x1580: 50v50), +0x9A and the player's Record Large Team Replays setting
// (bLargeTeamReplayRecordingEnabled, +0x4C8, off by default) are too. The constructor (0x105CCA0) sets +0x99 and +0x9A but
// not +0x98, and the shipped DefaultRuntimeOptions.ini can change any of them. This file turns all three on, as the hotfix
// reloads the config of the objects of each section's class (the CDO GetDefault reads among them); the player's two
// settings stay the player's (🟡: not seen in a running client). Replays from another build stay unplayable, which no file
// changes: the screen (AthenaReplayBrowserTab) won't play a row marked old or corrupt (RowData.IsOld, bIsCorrupt), and a
// replay in a newer engine's format (file version 7, where 3.5's is 3) can't be read at all.
// 6.02's (CL-4442095) Support-A-Creator (store/creators.js) is off in the same object as shipped (bDisableAffiliateFeature)
// and takes its creators from it (AffiliateNames): while the admin panel lists a creator, the file turns it on with them.
const replaysBuild = 4000805;
const runtimeOptionsFiles = (changelist, settingsValue) => (Number(changelist) >= replaysBuild ? {
  "DefaultRuntimeOptions.ini": Buffer.from(["[/Script/FortniteGame.FortRuntimeOptions]", "bEnableReplayBrowser=true",
    "bEnableReplayRecording=true", "bEnableLargeTeamReplayRecording=true", ...affiliateRuntimeOptions(changelist, settingsValue), ""].join("\r\n"), "utf8")
} : {});
const defaultNetwork = createNetwork();
function systemFiles(req, network = defaultNetwork, settings = null) {
  const address = network.reachableAddress(req);
  const port = req.socket.localPort;
  const proxied = httpsProxied(req);
  const engineNetwork = [
    "[OnlineSubsystemMcp.XMPP]", `ServerAddr=${address}`, `ServerPort=${port}`, "bUseSSL=false", "",
    "[OnlineSubsystemMcp.StompServiceMcp]", `Protocol=${proxied ? "wss" : "ws"}`, `Domain=${proxied ? proxied.host : `${address}:${port}`}`, ""
  ].join("\r\n");
  const build = getBuild(req);
  const game = gameFile(statsAnswerMinutes(build), [...shootingTestGlobals(build), ...forcedQueueGlobals(build)]) + customKeySection(build)
    + forcedQueueSection(build) + chatSection
    + purchaseFlowSection(req, network, { build, enabled: settings?.get?.()?.vbuckPacks !== false })
    + lootHotfixSection(new Date(), null, shootingTestHotfixTables(build), [...meteorStrikeRows(build), ...finalFightRows(build)], build);
  // 5.40's and 5.41's Storm Destruction switch, Athena.bMegaStormEnabled (events/stormdestruction.js, PongooDev/CoreV2#395).
  const engine = engineNetwork + stormDestructionEngineSection(build);
  return { "DefaultEngine.ini": Buffer.from(engine, "utf8"), "DefaultGame.ini": Buffer.from(game, "utf8"), ...newModeFiles(build),
    ...runtimeOptionsFiles(build, settings?.get?.()) };
}

// What the client reads per file (OnlineTitleFileMcp, sub_37C8D10): hash (SHA-1 hex, also its cache key), hash256,
// uniqueFilename (the download name), filename and length.
const header = (filename, data) => ({
  uniqueFilename: filename,
  filename,
  hash: crypto.createHash("sha1").update(data).digest("hex"),
  hash256: crypto.createHash("sha256").update(data).digest("hex"),
  length: data.length
});

export function cloudStorageRoutes({ tokens, network, settings }) {
  const router = express.Router();

  router.get("/fortnite/api/cloudstorage/system", requireAuth(tokens), (req, res) => {
    res.json(Object.entries(systemFiles(req, network, settings)).map(([filename, data]) => header(filename, data)));
  });

  router.get("/fortnite/api/cloudstorage/system/:filename", requireAuth(tokens), (req, res) => {
    const data = systemFiles(req, network, settings)[req.params.filename];
    if (!data) return sendError(res, 404, "errors.com.epicgames.cloudstorage.file_not_found", `${req.params.filename} not found`);
    res.type("application/octet-stream").send(data);
  });

  return router;
}

export function userCloudStorageRoutes({ tokens, accounts, sessions, dataDir }) {
  const router = express.Router();
  const base = "/fortnite/api/cloudstorage/user/:accountId";
  const folder = (accountId) => path.join(dataDir, "accounts", accountId, "cloudstorage");

  // A storm shield's build is saved in its owner's user cloud storage (<core item id>_r<zone>_a<0|1>.sav), which the
  // zone server lists, reads and writes for that owner (UFortUserCloudHelperComponent) with its own signed-in account's
  // token: the OSS falls back to the first signed-in user when it holds no login for the file's owner (sub_37E9DF0).
  // So the files of the players on a session an account hosts are open to that account's tokens, and to the
  // DedicatedServer client's. The OSS turns a 401 or 403 from any service into InvalidUser or NotAuthorized, which
  // AFortGameSessionDedicated answers by shutting the server down (exit code 6), so a gameserver is refused with a 404.
  function requireOwnerOrHost(req, res, next) {
    const { accountId } = req.params;
    if (req.session.accountId === accountId) return next();
    const dedicated = isDedicatedServerToken(req.session);
    const hosted = sessions.hostedBy(req.session.accountId);
    if (!dedicated && !hosted.length) return requireOwnAccount(req, res, next);
    if (accounts.get(accountId) && (dedicated || hosted.some((session) => sessionMembers(session).includes(accountId)))) return next();
    sendError(res, 404, "errors.com.epicgames.cloudstorage.user_not_found",
      `${accountId} isn't a player on a session this server hosts`);
  }

  function checkFilename(req, res, next) {
    if (!validFilename.test(req.params.filename) || req.params.filename.startsWith(".") || req.params.filename.endsWith(".tmp")) {
      return sendError(res, 400, "errors.com.epicgames.cloudstorage.invalid_filename", "Invalid file name");
    }
    req.file = path.join(folder(req.params.accountId), req.params.filename);
    next();
  }

  router.use(base, requireAuth(tokens));

  // The game's settings (UFortClientSettingsRecord: key bindings, the HUD's shown elements such as the net stats,
  // HUD.TopLeft.NetDebugUI, the controller platform and input presets, Core-Backend #228) are its ClientSettings.Sav
  // here. The client's listing parser (OnlineUserCloudMcp, 3.1 0x477120) takes hash, filename and length, and with a
  // hash equal to its cached copy's it uses that copy instead of downloading. Epic's listing also names the file's
  // uniqueFilename, hash256, contentType, upload time, storage and owner, which this gives too.
  router.get(base, requireOwnerOrHost, (req, res) => {
    const dir = folder(req.params.accountId);
    const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((name) => validFilename.test(name) && !name.endsWith(".tmp")) : [];
    res.json(files.map((filename) => {
      const file = path.join(dir, filename);
      const data = fs.readFileSync(file);
      return {
        ...header(filename, data),
        contentType: "application/octet-stream",
        uploaded: fs.statSync(file).mtime.toISOString(),
        storageType: "S3",
        accountId: req.params.accountId
      };
    }));
  });

  router.get(`${base}/:filename`, requireOwnerOrHost, checkFilename, (req, res) => {
    if (!fs.existsSync(req.file)) {
      return sendError(res, 404, "errors.com.epicgames.cloudstorage.file_not_found", `${req.params.filename} not found`);
    }
    res.type("application/octet-stream").send(fs.readFileSync(req.file));
  });

  // The body is read before any refusal, so the answer never cuts off an upload in progress.
  router.put(`${base}/:filename`, express.raw({ type: () => true, limit: "16mb" }), requireOwnerOrHost, checkFilename, (req, res) => {
    fs.mkdirSync(path.dirname(req.file), { recursive: true });
    fs.writeFileSync(`${req.file}.tmp`, Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    fs.renameSync(`${req.file}.tmp`, req.file);
    res.status(204).end();
  });

  router.delete(`${base}/:filename`, requireOwnAccount, checkFilename, (req, res) => {
    fs.rmSync(req.file, { force: true });
    res.status(204).end();
  });

  return router;
}
