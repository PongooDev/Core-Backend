// Cert (CL-3532353, "1.1") is the build Core-Backend's game data comes from and the default for every other build
// (src/gamedata/read.js); 1.2 (CL-3541083) has its own differences in gamedata/3541083.
export const certBuild = "3532353";

// The Fortnite version players call each build Core knows (as Core-Launcher's KnownBuilds), for what the client shows.
export const buildVersions = { 3532353: "1.1", 3541083: "1.2", 3700114: "1.7.2", 3724489: "1.8", 3729133: "1.8.1", 3741772: "1.8.2", 3757339: "1.9", 3775276: "1.9.1", 3790078: "1.10", 3807424: "1.11", 3825894: "2.1", 3841827: "2.2", 3847564: "2.3", 3858292: "2.4", 3870737: "2.4.2", 3889387: "2.5", 3901517: "3.0", 3915963: "3.1", 3917250: "3.1.1", 3935073: "3.2", 3942182: "3.3", 4000805: "3.5.1", 4008490: "3.5.2", 4019403: "3.6", 4039451: "4.0", 4053532: "4.1", 4072250: "4.2", 4117433: "4.4.0", 4127312: "4.4.1", 4132537: "4.4.2", 4159770: "4.5.0", 4166199: "4.5", 4204761: "5.0.0", 4214610: "5.0" };

export const versionOf = (changelist) => buildVersions[changelist] ?? null;

// The builds with Battle Royale's athena profile and locker: 1.8 (CL-3724489) and later, oldest first.
export const battleRoyaleBuilds = Object.keys(buildVersions).filter((changelist) => Number(changelist) >= 3724489)
  .sort((a, b) => Number(a) - Number(b));

// Battle Royale's seasons by the versions Epic shipped in them (Core-Backend #156): Season 1 was 1.8 to 1.10 here (its
// athena profile's first build to its last), Season 2 1.11 (14 December 2017) to 2.5 (13 February 2018; 3.0 began Season
// 3 on 22 February). This names a season's whole range, not the builds Core plays: of Season 2, Core knows 1.11, 2.1, 2.2,
// 2.3, 2.4, 2.4.2 and 2.5 (buildVersions), Season 2's last. 2.5's data has an AthenaSeason3 ahead of its season, a copy
// of AthenaSeason2's tables, which the extractor passes over (tools/extractor), so its season is AthenaSeason2's.
// Season 3 was 3.0 (22 February 2018) to 3.6 (Season 4 began with 4.0 on 1 May): of it, Core knows 3.0, whose
// AthenaSeason3 has its own curves (Athena_Season3_XP and _BP), so it is the season's, and 3.1 (28 February 2018), whose
// AthenaSeason3 is 3.0's (the same levels and Battle Pass; its weekly challenges gain a tenth week), to 3.5.1 (CL-4000805,
// ++Fortnite+Release-3.5, 11 April 2018), whose AthenaSeason3 is still 3.0's, and 3.5.2 (CL-4008490, the content update of
// 19 April 2018), whose paks give the extractor 3.5.1's data byte for byte, so it plays on gamedata/4000805, and 3.6 (CL-4019403,
// ++Fortnite+Release-3.6, 24 April 2018, the season's last update), whose AthenaSeason3 is still 3.0's and whose own data
// is gamedata/4019403. Core knows no 3.4 (no 3.4 build is at hand):
// a 3.4 client would play on 3.3's data, the closest earlier build that has its own (src/gamedata/read.js).
// Season 4 began with 4.0 (CL-4039451, ++Fortnite+Release-4.0, 1 May 2018): its AthenaSeason4 has its own curves and
// Battle Pass (100 tiers, the BRSeason4 storefront), and its data is gamedata/4039451. 4.1 (CL-4053532,
// ++Fortnite+Release-4.1, 8 May 2018) keeps 4.0's AthenaSeason4, and its data is gamedata/4053532. 4.2 (CL-4072250,
// ++Fortnite+Release-4.2, 16 May 2018) keeps it too, and its data is gamedata/4072250. Core knows no 4.3 (no 4.3 build is
// at hand, as 3.4). 4.4.0 (CL-4117433, ++Fortnite+Release-4.4, Update v4.40, 12 June 2018), 4.4.1 (CL-4127312,
// ++Fortnite+Release-4.4, Update v4.4.1, 14 June 2018) and 4.4.2 (CL-4132537, ++Fortnite+Release-4.4.x, Content Update
// v4.40, 19 June 2018) keep it too; 4.4.2's data is gamedata/4132537, and 4.4.0 and 4.4.1, whose paks Core has no copy of,
// play on it (src/gamedata/read.js laterData). 4.5 (++Fortnite+Release-4.5, Update v4.50, 27 June 2018) is two builds,
// CL-4159770 (its paks say 4.5.0, so it is "4.5.0" here) and CL-4166199 ("4.5"); both keep AthenaSeason4. 4.5's data is
// gamedata/4166199 (a Battle Royale only archive), and CL-4159770, whose paks Core has no copy of, plays on it.
// Season 5 began with 5.0 (++Fortnite+Release-5.0, UE 4.21, Update v5.00, 12 July 2018), two builds both called v5.00:
// CL-4204761, the launch build, whose paks Core has no copy of ("5.0.0" here, as 4.5's earlier build is "4.5.0"), and
// CL-4214610 ("5.0", the exe's own build string, ++Fortnite+Release-5.0-CL-4214610; its paks are dated 17 July, Content
// Update v5.00's day, and Core-ServerAssets calls its pak 5.0.1). Its AthenaSeason5 has its own curves and Battle Pass
// (100 tiers, the BRSeason5 storefront); its data is gamedata/4214610 (a Battle Royale only archive), and CL-4204761
// plays on it (src/gamedata/read.js laterData).
export const battleRoyaleSeasons = [
  { season: 1, firstVersion: "1.8", lastVersion: "1.10" },
  { season: 2, firstVersion: "1.11", lastVersion: "2.5" },
  { season: 3, firstVersion: "3.0", lastVersion: "3.6" },
  { season: 4, firstVersion: "4.0", lastVersion: "4.5" },
  { season: 5, firstVersion: "5.0", lastVersion: "5.0" }
];
// "Season 2 (1.11 – 2.5)", "1.11 – 2.5"; a season of one version Core knows, "Season 4 (4.0)".
export const seasonVersions = (season) => {
  const known = battleRoyaleSeasons.find((entry) => entry.season === Number(season));
  if (!known) return "";
  return known.firstVersion === known.lastVersion ? known.firstVersion : `${known.firstVersion} – ${known.lastVersion}`;
};
export const seasonName = (season) => `Season ${season} (${seasonVersions(season)})`;

// The changelist a request's User-Agent names: "build=++Fortnite+Release-Cert-CL-3541083" (services, the gameserver
// too) or "version=4.16.0-3541083+++Fortnite+Release-Cert" (CMS, datarouter). 3.2 (UE 4.20's default HTTP User-Agent,
// "%s/%s %s/%s": project, build version, platform, OS) names it by the engine version alone, "Fortnite/4.20.0-3935073
// +++Fortnite+Release-3.2 Windows/10.0.17134.1.256.64bit", with neither "CL-" nor "version=" (Core-Backend #231: the
// news and login message read "Core", the build unknown).
export function getBuild(req) {
  const agent = req.get("user-agent") ?? "";
  const match = /CL-(\d+)/.exec(agent) ?? /version=\d+\.\d+\.\d+-(\d+)/.exec(agent) ?? /\/\d+\.\d+\.\d+-(\d+)\+\+\+/.exec(agent);
  return match ? match[1] : "unknown";
}
