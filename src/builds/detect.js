// Cert (CL-3532353, "1.1") is the build Core-Backend's game data comes from and the default for every other build
// (src/gamedata/read.js); 1.2 (CL-3541083) has its own differences in gamedata/3541083.
export const certBuild = "3532353";

// The Fortnite version players call each build Core knows (as Core-Launcher's KnownBuilds), for what the client shows.
export const buildVersions = { 3532353: "1.1", 3541083: "1.2", 3700114: "1.7.2", 3724489: "1.8", 3729133: "1.8.1", 3741772: "1.8.2", 3757339: "1.9", 3775276: "1.9.1", 3790078: "1.10", 3807424: "1.11", 3825894: "2.1", 3841827: "2.2", 3847564: "2.3", 3858292: "2.4", 3870737: "2.4.2", 3889387: "2.5", 3901517: "3.0", 3915963: "3.1", 3917250: "3.1.1", 3935073: "3.2", 3942182: "3.3", 4000805: "3.5.1", 4008490: "3.5.2", 4019403: "3.6" };

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
export const battleRoyaleSeasons = [
  { season: 1, firstVersion: "1.8", lastVersion: "1.10" },
  { season: 2, firstVersion: "1.11", lastVersion: "2.5" },
  { season: 3, firstVersion: "3.0", lastVersion: "3.6" }
];
// "Season 2 (1.11 – 2.5)", "1.11 – 2.5".
export const seasonVersions = (season) => {
  const known = battleRoyaleSeasons.find((entry) => entry.season === Number(season));
  return known ? `${known.firstVersion} – ${known.lastVersion}` : "";
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
