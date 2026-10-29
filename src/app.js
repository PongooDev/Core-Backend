import express from "express";
import { createAccountStore } from "./accounts/store.js";
import { createResetTokenStore } from "./accounts/reset-tokens.js";
import { createSettingsStore } from "./settings/store.js";
import { createReportStore } from "./reports/store.js";
import { configureItemShop } from "./store/itemshop.js";
import { requestBuild } from "./builds/context.js";
import { seasonalEvents } from "./events/events.js";
import { createFriendStore } from "./friends/store.js";
import { createFriendCodeStore } from "./friendcodes/store.js";
import { networkAdminRoutes } from "./admin/network.js";
import { adminRoutes } from "./admin/routes.js";
import { createTokenStore } from "./accounts/tokens.js";
import { createProfileLocks } from "./profiles/locks.js";
import { createMailbox } from "./profiles/mailbox.js";
import { createPrimaryMissions } from "./profiles/missions.js";
import { createHeldScores } from "./profiles/scores.js";
import { createProfileStore } from "./profiles/store.js";
import { requestLog, unknownRoute } from "./log.js";
import { createMatchmaker } from "./matchmaking/service.js";
import { createSessionStore } from "./matchmaking/sessions.js";
import { createStatsStore, isMainPlaylist } from "./stats/store.js";
import { createNetwork } from "./network.js";
import { originForm } from "./proxy.js";
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
import { cloudStorageRoutes, userCloudStorageRoutes } from "./services/fortnite/cloudstorage.js";
import { friendCodeRoutes } from "./services/fortnite/friendcodes.js";
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
import { profileRoutes } from "./services/mcp/profile.js";
import { replayRoutes } from "./services/replay/replays.js";
import { createStompService } from "./stomp/service.js";
import { createXmppService } from "./xmpp/service.js";

// What the HTTP routes and the XMPP service share.
export function createContext(config) {
  const tokens = createTokenStore(config.dataDir);
  const accounts = createAccountStore(config.dataDir);
  const settings = createSettingsStore(config.dataDir);
  configureItemShop(() => settings.get().itemShop);
  if (config.requirePassword !== undefined) settings.update({ requirePassword: config.requirePassword });
  if (config.allowRegistration !== undefined) settings.update({ allowRegistration: config.allowRegistration });
  if (config.allowAutoRegistration !== undefined) settings.update({ allowAutoRegistration: config.allowAutoRegistration });
  if (config.seasonalEvents !== undefined) settings.update({ seasonalEvents: config.seasonalEvents });
  for (const key of ["battleRoyaleVbucks", "vbucksPerKill", "vbucksPerWin", "structureLimit", "structureLimits"]) {
    if (config[key] !== undefined) settings.update({ [key]: config[key] });
  }
  const friends = createFriendStore(config.dataDir);
  const sessions = createSessionStore();
  const stats = createStatsStore(config.dataDir);
  const reports = createReportStore(config.dataDir);
  return {
    accounts,
    tokens,
    settings,
    reports,
    resetTokens: createResetTokenStore(),
    friends,
    friendCodes: createFriendCodeStore(config.dataDir),
    stats,
    profiles: createProfileStore(config.dataDir, {
      giveAllCosmetics: config.giveAllCosmetics === true,
      wonPlaylists: (accountId) => Object.entries(stats.playlists(accountId))
        .filter(([playlistId, playlist]) => isMainPlaylist(playlistId) && (playlist.placetop1 ?? 0) > 0).map(([playlistId]) => Number(playlistId))
    }),
    mailbox: createMailbox(),
    locks: createProfileLocks(),
    primaryMissions: createPrimaryMissions(),
    heldScores: createHeldScores({ waitMs: config.earnScoreWaitMs }),
    sessions,
    matchmaker: createMatchmaker({ sessions, gatherMs: config.matchmakingGatherMs, quiet: config.requestLog === false }),
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

  app.use(originForm);
  // Everything a request does uses its build's game data (src/builds/context.js, src/gamedata/read.js).
  app.use(requestBuild);
  app.use(seasonalEvents(() => context.settings.get().seasonalEvents !== false));
  if (config.requestLog !== false) app.use(requestLog);
  app.use(userCloudStorageRoutes(context));
  app.use(replayRoutes(context));
  app.use(express.json());
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
  app.use(receiptRoutes(context));
  app.use(sessionRoutes(context));
  app.use(ticketRoutes(context));
  app.use(storefrontRoutes(context));
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
