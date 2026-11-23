import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { requireAuth, requireOwnAccount } from "../../accounts/auth.js";
import { isDedicatedServerToken } from "../../accounts/clients.js";
import { getBuild } from "../../builds/detect.js";
import { sendError } from "../../errors.js";
import { lootHotfixSection } from "../../events/contentupdates.js";
import { defaultReplacements, lastSelectedPlaylistOf, ltmForcedQueues, ltmFrontEndPlaylists, ltmNewMode, ltmPlaylistOverrides } from "../../events/ltms.js";
import { finalFightRows } from "../../events/finalfight.js";
import { meteorStrikeRows } from "../../events/meteorstrike.js";
import { siphonRows } from "../../events/siphon.js";
import { shootingTestGlobals, shootingTestHotfixTables } from "../../events/shootingtest.js";
import { stormDestructionEngineSection } from "../../events/stormdestruction.js";
import { qosEngineLines } from "../../matchmaking/qos.js";
import { sessionMembers } from "../../matchmaking/sessions.js";
import { creativeAccessGlobals } from "../../profiles/creative.js";
import { affiliateRuntimeOptions } from "../../store/creators.js";
import { giftingRuntimeOptions } from "../../store/gifting.js";
import { showdownRuntimeOptions } from "../../tournaments/showdown.js";
import { creativeRuntimeOptions } from "../links/islands.js";
import { createNetwork, httpsProxied, sentToHost } from "../../network.js";
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
// 6.10's (CL-4464155 on) shipped list differs in two ways, kept: Playlist_50v50 is one of the defaults (bIsDefaultPlaylist
// and bVisibleWhenDisabled set, no limited time banner, DisplayPriority 3; hidden again while its switch is off), and the
// in-game tournaments' three Showdown playlists are listed disabled at 50 to 52 (events/ltms.js `tournament`): the client
// turns on the one its current event names itself, but only an entry that is in the list (tournaments/showdown.js).
// 6.20's and 6.21's Fortnitemares Solo, Duos and Squads take the defaults' place while on (Core-Backend #348,
// events/ltms.js defaultReplacements): the default is listed off and hidden (bEnabled and bVisibleWhenDisabled false),
// and its Fortnitemares mode is listed as a default at its priority (bIsDefaultPlaylist, no limited time banner). The
// mode select's pick (CL-4497486 0x2F009D0) takes a playlist the player had when the mode select's own entries hold it,
// else the first of its entries with both of its flags (+8 clear, +9 set), else Playlist_DefaultSolo. 🟡 Read statically:
// that a hidden default isn't among those entries, so a lobby whose Solo is hidden opens on Fortnitemares Solo, needs a client.
// How a running client takes a change of the list (Core-Backend #354: 6.21's Fortnitemares modes end at the Butterfly), as
// Epic changed modes live: the client checks its hotfixes again each time it comes back to the lobby and before each
// matchmaking, and applies the ones whose hash changed. 6.21 (CL-4526925): destroying the match's game session calls back
// 0x10F3270, which sets a next-tick timer on the frontend player controller's 0x1100700; once the frontend game mode is up,
// it binds its completion handlers (0x10F8290, 0x10F4460) on UFortGameInstance's UpdateManager (+0x598) and calls its
// UUpdateManager::StartCheck (vtable +0x240) with bInCheckHotfixOnly false; the hotfix part ends in 0x10F4190 ("Hotfix
// check complete, nothing to do." / "need to restart."), then AFortGameModeFrontEnd::OnUpdateCheckComplete.
// 7.00's (CL-4629139) shipped list adds Creative, Playlist_PlaygroundV2 (PongooDev/CoreV2#471, events/ltms.js `creative`):
// kept as shipped, always enabled (a game mode with no switch, Core-Backend #375), AdvertiseType New and no limited-time
// banner (the LTM's limitedTime).
// UFortMatchmakingContext's matchmaking starts (0x111DA10, 0x114AF10, 0x114CF20 ...) run the same check through 0x112D820
// (IsWaitingOnUpdateManager is its pending handle, +0x1B8), and UFortMatchmakingV2::OnUpdateCheckComplete cancels the
// matchmaking "to receive update" when it brought one. The hotfix manager compares the listing's hashes with the last
// files it applied ("Returned hotfix data is the same as last application, skipping the apply phase", seen in Core's
// client logs on every return to the lobby) and downloads and applies the changed ones; the listing hashes each file's
// content (header below), so the list the backend serves at that moment is the one the lobby gets.
const frontEndDefaults = [["Playlist_DefaultDuo", 1], ["Playlist_DefaultSquad", 2], ["Playlist_DefaultSolo", 0]];
const advertiseTypeBuild = 4225813;
const defaultFiftyFiftyBuild = 4464155;
function frontEndPlaylistLines(changelist) {
  const playlists = ltmFrontEndPlaylists(changelist);
  if (!playlists.length) return [];
  const advertise = (type) => (Number(changelist) >= advertiseTypeBuild ? `AdvertiseType=${type}` : `bDisplayAsNew=${type === "New"}`);
  const entry = (name, access) => `+FrontEndPlaylistData=(PlaylistName=${name}, PlaylistAccess=(${access}))`;
  const replaced = defaultReplacements(changelist);
  const priorityOf = Object.fromEntries(frontEndDefaults);
  const replacing = new Map(Object.entries(replaced).map(([name, ltm]) => [ltm.playlistName, priorityOf[name]]));
  return ["!FrontEndPlaylistData=ClearArray",
    ...frontEndDefaults.map(([name, priority]) => entry(name, replaced[name]
      ? `bEnabled=false, bIsDefaultPlaylist=true, bVisibleWhenDisabled=false, ${advertise("None")}, bDisplayAsLimitedTime=false, DisplayPriority=${priority}`
      : `bEnabled=true, bIsDefaultPlaylist=true, bVisibleWhenDisabled=true, ${advertise("None")}, bDisplayAsLimitedTime=false, DisplayPriority=${priority}`)),
    ...playlists.map(({ name, enabled, priority, ltm }, index) => {
      if (replacing.has(name)) {
        return entry(name, `bEnabled=true, bIsDefaultPlaylist=true, bVisibleWhenDisabled=true, ${advertise("None")}, bDisplayAsLimitedTime=false, ` +
          `DisplayPriority=${replacing.get(name)}`);
      }
      if (ltm.tournament) {
        return entry(name, `bEnabled=false, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false, ${advertise("None")}, bDisplayAsLimitedTime=false, ` +
          `DisplayPriority=${50 + playlists.slice(0, index).filter((other) => other.ltm.tournament).length}`);
      }
      if (name === "Playlist_50v50" && Number(changelist) >= defaultFiftyFiftyBuild) {
        return entry(name, `bEnabled=${enabled}, bIsDefaultPlaylist=true, bVisibleWhenDisabled=${enabled}, ${advertise("None")}, bDisplayAsLimitedTime=false, DisplayPriority=3`);
      }
      return entry(name, `bEnabled=${enabled}, bIsDefaultPlaylist=false, bVisibleWhenDisabled=false, ` +
        `${advertise(ltm.id === "playgroundV2" ? "Updated" : ltm.advertise ?? "None")}, bDisplayAsLimitedTime=${ltm.limitedTime !== false}, DisplayPriority=${priority}`);
    })];
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
// 6.20 (CL-4497486) moved general chat to UFortChatManager (a USocialChatManager), and the setting with it
// (bIsAthenaGlobalChatEnabled, +0x1F3; UFortOnlineAccount has none), so the old section stopped reaching it (Core-Backend
// #344). UFortChatManager::AttemptJoinRecommendedChatRooms (6.20 0x10D2C80) runs on entering a sub game, and 6.x starts
// in Battle Royale's lobby: for Athena without the setting it disables the Global tab and asks for rooms only when the
// account holds Token:founderchatunlock (0x11661B0) and its Founders room isn't joined yet. Without that token no
// rooms were asked for at all, so the Founders tab never joined its room and a message sent there went nowhere. With
// the setting it asks every time, and HandleQueryRecommendedChatRoomsComplete (0x10DD170) joins both answered rooms.
// Core-Backend #378: 7.00 (CL-4629139) ships general chat switched off altogether: its DefaultGame.ini's
// [/Script/FortniteGame.FortChatManager] has bShouldRequestGeneralChatRooms, bShouldJoinGlobalChat and
// bShouldJoinFounderChat false beside bIsAthenaGlobalChatEnabled (Epic turned them on by hotfix). With
// bShouldRequestGeneralChatRooms (+0x1F1) false, UFortChatManager::AttemptJoinReservedChatRooms (7.00 0x10DFD00) asks for no
// rooms and disables both tabs (the reporter's log: "ShouldRequestRooms: 0, ChatRestricted: 0", then DisableGlobalChatRoom
// and DisableFounderChatRoom with DisableReason 1), so the lobby's chat had no tab at all and Send went nowhere; and
// HandleReserveChatRoomsComplete joins the Global room only with bShouldJoinGlobalChat ("Global Chat Room Found, bShouldJoin:
// %d") and the Founders room with bShouldJoinFounderChat. So from 7.00 the section turns all three on too; an earlier
// build's section is as it was (their shipped values already have them on).
const chatManagerFrom700 = ["bShouldRequestGeneralChatRooms=true", "bShouldJoinGlobalChat=true", "bShouldJoinFounderChat=true"];
const chatRoomsSwitchBuild = 4629139;
const chatSection = (build) => ["[/Script/FortniteGame.FortOnlineAccount]", "bIsAthenaGlobalChatEnabled=true", "",
  "[/Script/FortniteGame.FortChatManager]", "bIsAthenaGlobalChatEnabled=true",
  ...(Number(build) >= chatRoomsSwitchBuild ? chatManagerFrom700 : []), ""].join("\r\n");
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
// and takes its creators from it (AffiliateNames, or from 6.20 the affiliate service): while the admin panel has a code
// enabled, the file turns it on with them, and points "View Approved Creators" (ListOfCreatorsURL, opened in the player's
// own browser, which no redirect reaches) at this backend's list, by the address the game sent this request to
// (network.js sentToHost, Core-Backend #349: with the launcher's -httpproxy the connection's own address was 127.0.0.1
// or the local port behind a tunnel or forwarded port, which a remote player's browser can't open).
// 6.10's (CL-4464155) Events tab reads the same object (bEnableShowdown, ShowdownTournamentCacheExpirationHours): the file
// keeps the tab's list from being cached, or hides the empty tab when the admin asks (tournaments/showdown.js, #336).
// 6.31's (CL-4573279) gifting is off in it as shipped (bDisableGifting): the file turns it on with Epic's limits while the
// admin panel has gifting on, and off again otherwise (store/gifting.js).
const replaysBuild = 4000805;
const creatorsUrl = (req, network) => {
  const proxied = httpsProxied(req);
  if (proxied) return `https://${proxied.host}/affiliate/creators`;
  return `${req.socket?.encrypted ? "https" : "http"}://${sentToHost(req) ?? network.directHost(req)}/affiliate/creators`;
};
// 7.10's (CL-4667333) and later Creative island switches and the hub's featured islands (services/links/islands.js,
// PongooDev/CoreV2#488).
const runtimeOptionsFiles = (changelist, settingsValue, url = null, islandLinks = null) => (Number(changelist) >= replaysBuild ? {
  "DefaultRuntimeOptions.ini": Buffer.from(["[/Script/FortniteGame.FortRuntimeOptions]", "bEnableReplayBrowser=true",
    "bEnableReplayRecording=true", "bEnableLargeTeamReplayRecording=true", ...affiliateRuntimeOptions(changelist, settingsValue, { creatorsUrl: url }),
    ...showdownRuntimeOptions(changelist, settingsValue), ...giftingRuntimeOptions(changelist, settingsValue),
    ...creativeRuntimeOptions(changelist, islandLinks), ""].join("\r\n"), "utf8")
} : {});
// 7.00's (CL-4629139) and later Creative servers keep their islands in the DSS through the sidecar service
// (services/dss/dss.js, PongooDev/CoreV2#471): USidecarSys's base URL is the "MCP" online subsystem's
// FOnlineSidecarServiceMcp (OSS +0x378, made in 0x614A92 by 0x51B310), configured by
// [OnlineSubsystemMcp.OnlineSidecarServiceMcp], which 7.00's DefaultEngine.ini points at a local sidecar process (Protocol
// "http", Domain "127.0.0.1:8000", no ServiceName). Core has no sidecar: this backend answers its /api/dss/v1 routes. The
// section gives the service an Epic host under .ol.epicgames.com, which CoreRedirect sends to these routes, behind a proxy
// or not; the gameserver merges the same section at start-up (CoreV2 Server/Boot.cpp CombineServerConfig) for a service
// that reads its config before this file arrives. Clients have no use for the sidecar. No earlier build gets the section.
// - 7.00 (PongooDev/CoreV2#485): with this backend's own address (Protocol=http, Domain=<address>:<port>) the game's island
//   upload went to "https://127.0.0.1:<port>.ol.epicgames.com/api/dss/v1/...": the service keeps https and the Epic domain
//   for a host that isn't one, libcurl refused the URL ("Port number ended with '.'", LogSidecar "DssUpload failed:
//   errors.com.epicgames.online.generic.connection_failure", seen in a headless 7.00 server), so no island was ever saved
//   and every checkout found none.
// - 7.10 (CL-4667333) and later (PongooDev/CoreV2#483's check, below): USidecarSys's island upload and checkin (7.10
//   0x2E60800) take the base URL from this service's GetBaseUrl (its vtable 0x39B2B38, slot 10 = 0x4B8BE0), which quits the
//   server unless Protocol is https and the domain pinned. The build pins every host under .ol.epicgames.com (built in: no
//   ini has [SSL] PinnedPublicKeys).
const sidecarBuild = 4629139;
const sidecarEpicHost = "mcpsidecar-public-service-prod.ol.epicgames.com";
const sidecarSection = (build) => (Number(build) >= sidecarBuild
  ? ["[OnlineSubsystemMcp.OnlineSidecarServiceMcp]", "Protocol=https", `Domain=${sidecarEpicHost}`, ""]
  : []);
// From 7.10 (CL-4667333) every MCP service's base URL is checked as it is built: FBaseServiceMcp::GetBaseUrl (the
// service's slot 10, 0x4B8BE0, Arxan-dispersed) has its config (0x60D5A0) ask ISslCertificateManager::IsDomainPinned for
// Domain and compare Protocol with "https" and "wss", and unless the domain is pinned and the protocol one of those it
// tail-calls FPlatformMisc::RequestExit(false) (0x1868020). The STOMP connection manager (constructed in 0x586920 on
// "OnlineSubsystemMcp.StompServiceMcp", vtable 0x39C3CE0) is such a service, and 7.10 reads its config when it first
// connects, after this file is merged: with Protocol=ws and this backend's address the client quit, without a crash
// report, as Save the World's first profile notification subscription connected STOMP (PongooDev/CoreV2#483: "LogWindows:
// FPlatformMisc::RequestExit(0)" right after "ChangeGameSubMode is changing mode from [NoMode] to Campaign"). Any domain
// of Core's fails the pin check, so 7.10 and later get no STOMP section and keep the shipped
// wss://notifications-service-prod06.ol.epicgames.com:443, which passes it; CoreRedirect's FWebSocketsModule::
// CreateWebSocket detour sends that Epic host to this backend (ws:// or wss:// as its own address), as it already did for
// every build that read the config before the hotfix.
const pinnedServicesBuild = 4667333;
const stompSection = (build, address, port, proxied) => (Number(build) >= pinnedServicesBuild
  ? []
  : ["[OnlineSubsystemMcp.StompServiceMcp]", `Protocol=${proxied ? "wss" : "ws"}`, `Domain=${proxied ? proxied.host : `${address}:${port}`}`, ""]);
const defaultNetwork = createNetwork();
// 5.10's (CL-4225813) and later builds' Vivox voice chat (vivox/service.js gameSection): FVivox::Connect (7.00 0x999130)
// reads [Vivox] ServerUrl and Domain from the game ini each time it connects, so this file, merged at start-up, points
// the game's own Vivox at Core's emulator. Nothing for older builds (their URL is in the exe) or while the admin panel's
// Voice chat (Vivox) switch is off, which leaves the file as it was.
function systemFiles(req, network = defaultNetwork, settings = null, vivox = null, islandLinks = null) {
  const address = network.reachableAddress(req);
  const port = req.socket.localPort;
  const proxied = httpsProxied(req);
  const build = getBuild(req);
  const engineNetwork = [
    "[OnlineSubsystemMcp.XMPP]", `ServerAddr=${address}`, `ServerPort=${port}`, "bUseSSL=false", "",
    ...stompSection(build, address, port, proxied),
    ...sidecarSection(build)
  ].join("\r\n");
  // 7.00's Creative early access notice on the lobby's "Start a server" tile (profiles/creative.js, Core-Backend #379).
  const game = gameFile(statsAnswerMinutes(build), [...shootingTestGlobals(build), ...forcedQueueGlobals(build), ...creativeAccessGlobals(build)])
    + customKeySection(build)
    + forcedQueueSection(build) + chatSection(build)
    + purchaseFlowSection(req, network, { build, enabled: settings?.get?.()?.vbuckPacks !== false })
    + (vivox?.gameSection?.(req, build) ?? "")
    + lootHotfixSection(new Date(), null, shootingTestHotfixTables(build), [...meteorStrikeRows(build), ...finalFightRows(build), ...siphonRows(build)], build);
  // 5.40's and 5.41's Storm Destruction switch, Athena.bMegaStormEnabled (events/stormdestruction.js, PongooDev/CoreV2#395).
  // The regions' QoS ping servers, the admin panel's (matchmaking/qos.js, Core-Backend #123): what the client's Auto
  // region and first region pick pings.
  const qos = qosEngineLines(build, settings?.get?.()?.regionPingServers);
  const engine = engineNetwork + stormDestructionEngineSection(build) + (qos.length ? [...qos, ""].join("\r\n") : "");
  return { "DefaultEngine.ini": Buffer.from(engine, "utf8"), "DefaultGame.ini": Buffer.from(game, "utf8"), ...newModeFiles(build),
    ...runtimeOptionsFiles(build, settings?.get?.(), creatorsUrl(req, network), islandLinks) };
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

export function cloudStorageRoutes({ tokens, network, settings, vivox, islandLinks }) {
  const router = express.Router();

  router.get("/fortnite/api/cloudstorage/system", requireAuth(tokens), (req, res) => {
    res.json(Object.entries(systemFiles(req, network, settings, vivox, islandLinks)).map(([filename, data]) => header(filename, data)));
  });

  router.get("/fortnite/api/cloudstorage/system/:filename", requireAuth(tokens), (req, res) => {
    const data = systemFiles(req, network, settings, vivox, islandLinks)[req.params.filename];
    if (!data) return sendError(res, 404, "errors.com.epicgames.cloudstorage.file_not_found", `${req.params.filename} not found`);
    res.type("application/octet-stream").send(data);
  });

  return router;
}

// The game's settings file and the builds that read it (CoreV2 #468). Epic's service kept the one ClientSettings.Sav an
// account uploaded, and a client only ever read one saved by its own build or an earlier one, since nobody went back to an
// older build. Core's builds share the file, so going back gave an older build the file a newer one saved. The record's version doesn't keep
// them apart: UFortClientSettingsRecord loads only its own version (ReadFromArchive, 3.3 0xC1B770: "Can't load version %d,
// older than %d or invalid"), but 3.3's and 4.1's are both 15 (their constructors, 3.3 0xB3AF30 and 4.1 0xBB9F90, set the
// oldest and newest version, +0xBC and +0xB8, to 15). So 3.3 loads 4.1's file, and its key bindings (UserActionBindings,
// +0x230) with it, which hold the actions 4.1's Input tab lists and 3.3's doesn't: BuildConfirm, EditSelect, EmotePicker,
// LockerEmote1 to 6, PickerNextWheel, PickerPreviousWheel and SquadQuickChatPicker. Opening Settings builds the Input tab,
// whose UFortInputOptions::ConstructKeyBindList (3.3 0x2881D40) takes the record's bindings as they are
// (UFortClientSettingsRecord::GetActionBindings, 0xB4D1E0, hands back UserActionBindings once it holds any) and skips each
// whose action it doesn't list, but finds the row it made for a binding by the binding's place in that list. After the first
// skipped one it reads past its rows and copies an FText from nothing (0x288463B -> 0x121C0FA, reading address 0x8): the
// game crashed as Settings opened. 4.1's (0x2A279F0) walks its own list and looks each action up in the bindings, so 4.1
// takes an older build's file.
// So a build is never given a file a newer build saved, as no build on Epic's was. The file's header names the build that
// saved it (3.3 0xC53880: the magic 0xF057217E, the UE4 version, then the engine version, whose changelist is at offset 14,
// then the record version). Each upload is also kept as its builder's copy (<account>/clientsettings/<changelist>.Sav), and
// a build gets its own copy (its last upload); else the last upload of an older build, so the settings carry on to a newer
// build as on Epic's; else none, and it starts from its defaults as a new account does ("No client settings found, using
// defaults", 3.3 0xD87E90) until its first upload makes its copy. A file of no known build (no header, or no build in the
// request) is served as before. Unlike before, a build with a copy keeps it when an older build saves after it: the older
// build's file lacks the newer one's own bindings (3.3's has none of 4.1's emote keys), which the newer build would set to
// their defaults again.
const clientSettingsName = "clientsettings.sav";
const isClientSettings = (filename) => filename.toLowerCase() === clientSettingsName;
const recordMagic = 0xF057217E;
const headerLength = 18;
export function clientSettingsBuilder(data) {
  if (!Buffer.isBuffer(data) || data.length < headerLength || data.readUInt32LE(0) !== recordMagic) return null;
  const changelist = data.readUInt32LE(14) & 0x7FFFFFFF;
  return changelist > 0 ? changelist : null;
}
function fileBuilder(file) {
  const handle = fs.openSync(file, "r");
  try {
    const data = Buffer.alloc(headerLength);
    return clientSettingsBuilder(data.subarray(0, fs.readSync(handle, data, 0, headerLength, 0)));
  } finally {
    fs.closeSync(handle);
  }
}
function writeFile(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(`${file}.tmp`, data);
  fs.renameSync(`${file}.tmp`, file);
}

export function userCloudStorageRoutes({ tokens, accounts, sessions, dataDir }) {
  const router = express.Router();
  const base = "/fortnite/api/cloudstorage/user/:accountId";
  const folder = (accountId) => path.join(dataDir, "accounts", accountId, "cloudstorage");
  const buildCopies = (accountId) => path.join(dataDir, "accounts", accountId, "clientsettings");
  const buildCopy = (accountId, changelist) => path.join(buildCopies(accountId), `${changelist}.Sav`);
  const requestBuild = (req) => (/^\d+$/.test(getBuild(req)) ? Number(getBuild(req)) : null);

  // The file of a user file's name the requesting build is given: the stored one, but ClientSettings.Sav's as above.
  // Null when there is none for it.
  function servedFile(req, filename) {
    const stored = path.join(folder(req.params.accountId), filename);
    if (!fs.existsSync(stored)) return null;
    const build = requestBuild(req);
    if (!isClientSettings(filename) || build === null) return stored;
    const builder = fileBuilder(stored);
    if (builder === null || builder === build) return stored;
    const dir = buildCopies(req.params.accountId);
    const copies = (fs.existsSync(dir) ? fs.readdirSync(dir) : []).map((name) => /^(\d+)\.Sav$/.exec(name)).filter(Boolean)
      .map((match) => ({ builder: Number(match[1]), file: path.join(dir, match[0]) }));
    const own = copies.find((copy) => copy.builder === build);
    if (own) return own.file;
    const older = [{ builder, file: stored }, ...copies].filter((copy) => copy.builder < build)
      .map((copy) => ({ ...copy, at: fs.statSync(copy.file).mtimeMs })).sort((a, b) => b.at - a.at);
    return older[0]?.file ?? null;
  }

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
    res.json(files.map((filename) => ({ filename, file: servedFile(req, filename) })).filter(({ file }) => file).map(({ filename, file }) => {
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
    const file = servedFile(req, req.params.filename);
    if (!file) {
      return sendError(res, 404, "errors.com.epicgames.cloudstorage.file_not_found", `${req.params.filename} not found`);
    }
    res.type("application/octet-stream").send(fs.readFileSync(file));
  });

  // The body is read before any refusal, so the answer never cuts off an upload in progress. A ClientSettings.Sav is also
  // kept as its builder's copy; the one it replaces is kept as its own builder's first when that has none yet (a file
  // saved before Core kept copies), with its upload time.
  router.put(`${base}/:filename`, express.raw({ type: () => true, limit: "16mb" }), requireOwnerOrHost, checkFilename, (req, res) => {
    const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (isClientSettings(req.params.filename)) {
      const previous = fs.existsSync(req.file) ? fileBuilder(req.file) : null;
      if (previous !== null && !fs.existsSync(buildCopy(req.params.accountId, previous))) {
        const { atime, mtime } = fs.statSync(req.file);
        writeFile(buildCopy(req.params.accountId, previous), fs.readFileSync(req.file));
        fs.utimesSync(buildCopy(req.params.accountId, previous), atime, mtime);
      }
      const builder = clientSettingsBuilder(data) ?? requestBuild(req);
      if (builder !== null) writeFile(buildCopy(req.params.accountId, builder), data);
    }
    writeFile(req.file, data);
    res.status(204).end();
  });

  // ClientSettings.Sav goes for every build, its copies with it.
  router.delete(`${base}/:filename`, requireOwnAccount, checkFilename, (req, res) => {
    fs.rmSync(req.file, { force: true });
    if (isClientSettings(req.params.filename)) fs.rmSync(buildCopies(req.params.accountId), { recursive: true, force: true });
    res.status(204).end();
  });

  return router;
}
