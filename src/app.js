import express from "express";
import { createAccountStore } from "./accounts/store.js";
import { createExchangeCodeStore } from "./accounts/exchange-codes.js";
import { createResetTokenStore } from "./accounts/reset-tokens.js";
import { createSettingsStore } from "./settings/store.js";
import { createReportStore } from "./reports/store.js";
import { configureItemShop, configureSeasonStarts } from "./store/itemshop.js";
import { requestBuild } from "./builds/context.js";
import { configureEvents, seasonalEvents } from "./events/events.js";
import { configureLtms } from "./events/ltms.js";
import { configureChallenges } from "./profiles/challenges.js";
import { configureBattlePass } from "./battlepass/season1.js";
import { createFriendStore } from "./friends/store.js";
import { createFriendCodeStore } from "./friendcodes/store.js";
import { createPurchaseCodeStore } from "./store/purchasecodes.js";
import { networkAdminRoutes } from "./admin/network.js";
import { adminRoutes } from "./admin/routes.js";
import { createTokenStore } from "./accounts/tokens.js";
import { createProfileLocks } from "./profiles/locks.js";
import { createMailbox } from "./profiles/mailbox.js";
import { createPrimaryMissions } from "./profiles/missions.js";
import { createHeldScores } from "./profiles/scores.js";
import { ownsSaveTheWorld } from "./profiles/founders.js";
import { createProfileStore } from "./profiles/store.js";
import { requestLog, unknownRoute } from "./log.js";
import { createMatchmaker } from "./matchmaking/service.js";
import { createSessionStore } from "./matchmaking/sessions.js";
import { createStatsStore, isMainPlaylist } from "./stats/store.js";
import { createNetwork } from "./network.js";
import { forwardImageRequests, originForm } from "./proxy.js";
import { isImageHost } from "./services/content/imagehosts.js";
import { oauthRoutes } from "./services/account/oauth.js";
import { publicAccountRoutes } from "./services/account/public.js";
import { portalRoutes } from "./services/portal/routes.js";
import { contentRoutes } from "./services/content/pages.js";
import { coreStatusRoutes } from "./services/core/status.js";
import { datarouterRoutes } from "./services/datarouter/data.js";
import { eulaRoutes } from "./services/eulatracking/agreements.js";
import { accessRoutes } from "./services/fortnite/access.js";
import { chatRoutes, generalChatRooms } from "./services/fortnite/chat.js";
import { battleRoyaleRoutes } from "./services/fortnite/battleroyale.js";
import { feedbackRoutes } from "./services/fortnite/feedback.js";
import { statsRoutes } from "./services/fortnite/stats.js";
import { structureLimitRoutes } from "./services/fortnite/structurelimit.js";
import { cheatRoutes } from "./services/fortnite/cheats.js";
import { cloudStorageRoutes, userCloudStorageRoutes } from "./services/fortnite/cloudstorage.js";
import { friendCodeRoutes } from "./services/fortnite/friendcodes.js";
import { purchaseRoutes } from "./services/fortnite/purchase.js";
import { receiptRoutes } from "./services/fortnite/receipts.js";
import { storefrontRoutes } from "./services/fortnite/storefront.js";
import { twitchRoutes } from "./services/fortnite/twitch.js";
import { versionRoutes } from "./services/fortnite/version.js";
import { calendarRoutes } from "./services/fortnite/calendar.js";
import { waitingRoomRoutes } from "./services/fortnite/waitingroom.js";
import { worldRoutes } from "./services/fortnite/world.js";
import { friendsRoutes } from "./services/friends/lists.js";
import { lightswitchRoutes } from "./services/lightswitch/status.js";
import { sessionRoutes } from "./services/matchmaking/sessions.js";
import { ticketRoutes } from "./services/matchmaking/ticket.js";
import { warmupRoutes } from "./services/matchmaking/warmup.js";
import { profileRoutes } from "./services/mcp/profile.js";
import { replayRoutes } from "./services/replay/replays.js";
import { createStompService } from "./stomp/service.js";
import { createXmppService } from "./xmpp/service.js";
import { createAdminAuthStore } from "./admin/auth.js";

// What the HTTP routes and the XMPP service share.
export function createContext(config) {
  const tokens = createTokenStore(config.dataDir);
  const accounts = createAccountStore(config.dataDir);
  const settings = createSettingsStore(config.dataDir);
  const adminAuth = createAdminAuthStore(config.dataDir);
  configureItemShop(() => settings.get().itemShop);
  configureEvents(() => settings.get().events);
  configureLtms(() => settings.get());
  configureChallenges(() => settings.get());
  configureSeasonStarts((season, date) => settings.recordSeasonStart(season, date));
  configureBattlePass(() => settings.get().battlepass);
  if (config.requirePassword !== undefined) settings.update({ requirePassword: config.requirePassword });
  if (config.allowRegistration !== undefined) settings.update({ allowRegistration: config.allowRegistration });
  if (config.allowAutoRegistration !== undefined) settings.update({ allowAutoRegistration: config.allowAutoRegistration });
  if (config.seasonalEvents !== undefined) settings.update({ seasonalEvents: config.seasonalEvents });
  for (const key of ["battleRoyaleVbucks", "battleRoyaleRewards", "vbucksPerKill", "vbucksPerWin", "structureLimit", "structureLimits", "cheats", "cheatAccounts",
    "matchmakingGatherSeconds", "warmupSeconds", "lateJoin", "bots", "regionFallback", "vbuckPacks", "purchaseMode", "twitchPrimePack", "matchStartCountdown", "matchStartBufferSeconds", "serverRegions", "allowedBuilds", "defaultFoundersAccess", "remoteAdmin", "events", "battlepass", "matchmakingModes", "ltmOriginalDates", "ltmCloseEncounters", "serverLimits", "regionHostingIps", "customMatchServers", "customMatchFallback"]) {
    if (config[key] !== undefined) settings.update({ [key]: config[key] });
  }
  const friends = createFriendStore(config.dataDir);
  // The admin panel's region fallback (Core-Backend #123): off, a player only plays in the region they picked.
  const regionFallback = () => settings.get().regionFallback !== false;
  // Its server regions (#142): a server in one of them takes all of their players.
  const serverRegions = () => settings.get().serverRegions ?? [];
  // Each region's hosting IPs and the custom matchmaking servers (#227).
  const regionHostingIps = () => settings.get().regionHostingIps ?? {};
  const customServers = () => settings.get().customMatchServers ?? [];
  const sessions = createSessionStore({ regionFallback, serverRegions, regionHostingIps, customServers });
  const stats = createStatsStore(config.dataDir);
  const reports = createReportStore(config.dataDir);
  const profiles = createProfileStore(config.dataDir, {
    giveAllCosmetics: config.giveAllCosmetics === true,
    defaultFoundersAccess: () => settings.get().defaultFoundersAccess === true,
    wonSeasons: (accountId) => stats.wonSeasons(accountId),
    // The admin panel's Twitch Prime pack for Season 3 players (Core-Backend #229, profiles/athena.js).
    twitchPrimePack: () => settings.get().twitchPrimePack === true,
    // The account's recorded wins in solo, duo and squad, for a season's past_seasons record (profiles/seasons.js).
    winCount: (accountId) => Object.entries(stats.playlists(accountId))
      .filter(([playlistId]) => isMainPlaylist(playlistId)).reduce((sum, [, playlist]) => sum + (playlist.placetop1 ?? 0), 0),
    // Whether the account owns Save the World (Core-Backend #84): with defaultFoundersAccess on every profile0 is given
    // the founder's pack when it next loads (profiles/founders.js), so every account does; otherwise those holding one.
    ownsSaveTheWorld: (accountId) => settings.get().defaultFoundersAccess === true
      || (profiles.exists(accountId, "profile0") && ownsSaveTheWorld(profiles.load(accountId, "profile0")))
  });
  return {
    accounts,
    tokens,
    settings,
    adminAuth,
    reports,
    resetTokens: createResetTokenStore(),
    exchangeCodes: createExchangeCodeStore(),
    friends,
    friendCodes: createFriendCodeStore(config.dataDir),
    purchaseCodes: createPurchaseCodeStore(config.dataDir),
    stats,
    profiles,
    mailbox: createMailbox(),
    locks: createProfileLocks(),
    primaryMissions: createPrimaryMissions(),
    heldScores: createHeldScores({ waitMs: config.earnScoreWaitMs }),
    sessions,
    // config.matchmakingGatherMs (the tests') wins over the admin panel's gather time.
    matchmaker: createMatchmaker({ sessions, gatherMs: config.matchmakingGatherMs ?? (() => settings.get().matchmakingGatherSeconds * 1000),
      lateJoin: () => settings.get().lateJoin === true, regionFallback,
      matchStartCountdown: () => settings.get().matchStartCountdown !== false, warmupSeconds: () => settings.get().warmupSeconds ?? null,
      matchStartBuffer: () => settings.get().matchStartBufferSeconds,
      // Bots on, as the warmup answer sends them (services/matchmaking/warmup.js).
      playerBots: () => { const bots = settings.get().bots; return (bots?.forcePlayerAIs === true && bots.count > 0) || bots?.fillPlayerTeams === true; },
      serverRegions, serverLimits: () => settings.get().serverLimits, matchmakingModes: () => settings.get().matchmakingModes,
      regionHostingIps, customServers, customFallback: () => settings.get().customMatchFallback === true, quiet: config.requestLog === false }),
    network: createNetwork(config),
    emptyServerWaitMs: config.emptyServerWaitMs,
    stomp: createStompService({ tokens, quiet: config.requestLog === false }),
    xmpp: createXmppService({
      tokens,
      contactsOf: (accountId) => friends.accepted(accountId),
      publicRooms: Object.values(generalChatRooms),
      quiet: config.requestLog === false
    }),
    dataDir: config.dataDir,
    config
  };
}

export function createApp(config, context = createContext(config)) {

  const app = express();
  app.disable("x-powered-by");

  // A plain http:// picture the -httpproxy carried for an admin-set picture host goes to that site (Core-Backend #260).
  app.use(forwardImageRequests((target) => isImageHost(target, context.settings?.get?.() ?? {}, config)));
  app.use(originForm);
  // The IP each request came from, through the reverse proxy only when the admin panel says the backend is behind one
  // (network.js clientAddress, Core-Backend #227).
  app.use((req, res, next) => {
    if (context.network?.clientAddress) req.clientAddress = context.network.clientAddress(req);
    next();
  });
  // Everything a request does uses its build's game data (src/builds/context.js, src/gamedata/read.js).
  app.use(requestBuild);
  app.use(seasonalEvents(() => context.settings.get().seasonalEvents !== false));
  if (config.requestLog !== false) app.use(requestLog);
  app.use(userCloudStorageRoutes(context));
  app.use(replayRoutes(context));
  // The admin panel's news image upload (#215) reads its larger body itself, after the admin gate (admin/routes.js).
  const json = express.json();
  app.use((req, res, next) => (req.path === "/admin/api/news/image" ? next() : json(req, res, next)));
  app.use(express.urlencoded({ extended: false }));

  app.use(portalRoutes(context));
  app.use(oauthRoutes(context));
  app.use(publicAccountRoutes(context));
  app.use(lightswitchRoutes(context));
  app.use(contentRoutes(context, config));
  app.use(versionRoutes(context));
  app.use(calendarRoutes(context));
  app.use(waitingRoomRoutes(context));
  app.use(cloudStorageRoutes(context));
  app.use(eulaRoutes(context));
  app.use(accessRoutes(context));
  app.use(profileRoutes(context));
  app.use(worldRoutes(context));
  app.use(structureLimitRoutes(context));
  app.use(cheatRoutes(context));
  app.use(receiptRoutes(context));
  app.use(sessionRoutes(context));
  app.use(ticketRoutes(context));
  app.use(warmupRoutes(context));
  app.use(storefrontRoutes(context));
  app.use(purchaseRoutes(context));
  app.use(chatRoutes(context));
  app.use(statsRoutes(context));
  app.use(feedbackRoutes(context));
  app.use(battleRoyaleRoutes(context));
  app.use(friendCodeRoutes(context));
  app.use(twitchRoutes(context));
  app.use(friendsRoutes(context));
  app.use(datarouterRoutes(context));
  app.use(coreStatusRoutes(context));
  app.use(networkAdminRoutes(context));
  app.use(adminRoutes(context));

  // The game asks Epic's launcher bucket for its launcher, Fortnite and default app icons
  // (launcher-resources.s3.amazonaws.com/launcher-resources/<version>/<app>/icon.png). Core has none to serve, and the
  // game goes on without them, so they get a quiet 404 instead of filling the unanswered requests (Core-Backend #107).
  app.get(/^\/launcher-resources\//, (req, res) => res.status(404).end());

  app.use(unknownRoute(config.dataDir));
  return app;
}
