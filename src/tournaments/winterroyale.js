// Epic's Winter Royale (Core-Backend #383): the first open online tournament of Fortnite's in-game tournament system, for
// $1,000,000, played in solos by NA East and Europe. What is recorded of it:
// - Epic's announcement (fortnite.com/news/winter-royale-tournament-announcement, 20 November 2018) and Dexerto's two
//   articles that quote its schedule and rules ("Everything you need to know about the $1 million 'Winter Royale'
//   Fortnite open event", and "NA and EU finals of $1 million Winter Royale tournament"): open qualifiers on 24 and 25
//   November 2018, three three-hour sessions a day in each region (NA East 1 PM-4 PM, 5 PM-8 PM and 9 PM-12 AM ET;
//   Europe 10 AM-1 PM, 2 PM-5 PM and 6 PM-9 PM GMT); "The highest score each player receives during a single session will
//   be counted"; the top 200 of each region invited to its finals (after an eligibility survey); Europe's finals on 30
//   November (Heat 1 4 PM-7 PM, Heat 2 8 PM-11 PM GMT) and 1 December (Grand Finals 5 PM-9 PM GMT), North America's on
//   11 December (Heat 1 3 PM-6 PM, Heat 2 7 PM-10 PM ET) and 12 December (Grand Finals 5 PM-9 PM ET); the 200 finalists
//   "compete in five Solos matches", the top 100 go on to the Grand Finals; $500,000 in prizes for each region. The points
//   are tournaments/store.js's winterRoyale2018 rulesets. The qualifiers were in 6.31's time (Update v6.31, 27 November,
//   came after them), Europe's finals too; North America's finals were in 7.00's (6 December).
// - The qualifiers' entry of Epic's content page, tournament_info (#383's reporter's copy, winter_royale_qual): its texts,
//   colours, pin and pictures, below. The pictures are still on Epic's CDN (checked 2026-11-17: each GET answers 200 with
//   a JPEG whose SHA-1 is the hash in its name, 750x1080 for the posters, 1024x512 for the tile). No entry of Epic's for the
//   finals is known, so they have Core's own texts and pictures (🟡).
// What Core makes of it: three events on Playlist_Showdown_Solo (🟡 the qualifiers' playlist isn't recorded; Epic's in-game
// tournaments of the time were on the Showdown ones), every build with that playlist listing them in its Events tab (6.10 to
// 7.20, events/ltms.js): the qualifiers, open to everyone, a window for each of the six sessions; the finals, invite only
// for the qualifiers' top 200 (tournaments/store.js validateQualifier: once the qualifiers are over), with the two heats
// as its windows, five matches each player (🟡 Epic split the 200 between the heats; here a finalist plays five matches in
// either); and the Grand Finals, invite only for the finals' top 100. Core has no regions: the admin picks whose times to
// use. Epic's dates are long past, so the whole schedule moves to start on the day the admin picks, each time keeping its
// day and its UTC time of day (ET as UTC-5 and GMT as UTC, as in November and December 2018); the first day 2018-11-24 gives
// Epic's own dates. The prizes were money, which a profile can't hold: none is set (the admin can add Core's own).
export const winterRoyaleFirstDay = "2018-11-24";
const cdn = "https://cdn2.unrealengine.com/Fortnite%2Ffortnite-game%2Ftournaments%2F";
export const winterRoyaleImages = {
  posterFront: `${cdn}WinterRoyale_Solo_Front-750x1080-f041e3551d0f764455b1b59e5d5b352736e7bd82.jpg`,
  posterBack: `${cdn}WinterRoyale_Solo_Back-750x1080-a2981671e815c953302121f460d93fe811ba7b12.jpg`,
  playlistTile: `${cdn}ModeTile_WinterRoyale-1024x512-75547d897a08a35eeecc9c18c7e63515a1b7e439.jpg`,
  loadingScreen: `${cdn}ModeTile_WinterRoyale-1024x512-75547d897a08a35eeecc9c18c7e63515a1b7e439.jpg`
};
// Epic's entry's texts and colours, as Epic wrote them (tournaments/store.js validateDisplay's fields).
export const winterRoyaleQualifiersDisplay = {
  title_line_1: "WINTER",
  title_line_2: "ROYALE",
  schedule_info: "$1,000,000 in Prizes",
  flavor_description: "Play in the Winter Royale Qualifiers!  Players with the top score during any qualifying session will be invited to the Winter Royale Finals to play for $1,000,000 in prizes.",
  details_description: "Score points by eliminating multiple opponents and surviving against the competition! Players with the Top 200 scores will be invited to compete in the Winter Royale Finals. Only your highest scoring Qualifying Session will count toward your score. Earning a pin does not affect qualification for the Winter Royale Finals. Full rules and eligibility details can be found on www.fortnite.com/esports.",
  short_format_title: "Qualifying Sessions",
  long_format_title: "Winter Royale Qualifiers",
  pin_earned_text: "Top Competitor! Keep Going!",
  base_color: "FFFFFF",
  primary_color: "6DFDFF",
  secondary_color: "001F8B",
  highlight_color: "6DFDFF",
  title_color: "58FE85",
  shadow_color: "124EA8",
  background_left_color: "0E60BC",
  background_right_color: "070B83",
  background_text_color: "2D7EFC",
  poster_fade_color: "AAFBF6"
};
export const winterRoyalePinScore = 25;
export const winterRoyaleFinalists = 200;
export const winterRoyaleGrandFinalists = 100;

// Each region's times on Epic's own dates, in UTC: [start, end] of each window.
const session = (startsAt, endsAt) => ({ startsAt: `${startsAt}:00.000Z`, endsAt: `${endsAt}:00.000Z` });
export const winterRoyaleRegions = {
  NAE: {
    name: "NA East",
    qualifiers: [session("2018-11-24T18:00", "2018-11-24T21:00"), session("2018-11-24T22:00", "2018-11-25T01:00"), session("2018-11-25T02:00", "2018-11-25T05:00"),
      session("2018-11-25T18:00", "2018-11-25T21:00"), session("2018-11-25T22:00", "2018-11-26T01:00"), session("2018-11-26T02:00", "2018-11-26T05:00")],
    finals: [session("2018-12-11T20:00", "2018-12-11T23:00"), session("2018-12-12T00:00", "2018-12-12T03:00")],
    grandFinals: [session("2018-12-12T22:00", "2018-12-13T02:00")]
  },
  EU: {
    name: "Europe",
    qualifiers: [session("2018-11-24T10:00", "2018-11-24T13:00"), session("2018-11-24T14:00", "2018-11-24T17:00"), session("2018-11-24T18:00", "2018-11-24T21:00"),
      session("2018-11-25T10:00", "2018-11-25T13:00"), session("2018-11-25T14:00", "2018-11-25T17:00"), session("2018-11-25T18:00", "2018-11-25T21:00")],
    finals: [session("2018-11-30T16:00", "2018-11-30T19:00"), session("2018-11-30T20:00", "2018-11-30T23:00")],
    grandFinals: [session("2018-12-01T17:00", "2018-12-01T21:00")]
  }
};

// A region's three schedules moved to begin on firstDay ("YYYY-MM-DD", the qualifiers' first day), whole days apart from
// Epic's. Throws an Error with the reason.
export function winterRoyaleSchedule(region, firstDay = winterRoyaleFirstDay) {
  const times = winterRoyaleRegions[region];
  if (!times) throw new Error(`The Winter Royale's regions are ${Object.keys(winterRoyaleRegions).join(" and ")}.`);
  const day = String(firstDay ?? "");
  const start = /^\d{4}-\d{2}-\d{2}$/.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : NaN;
  if (!Number.isFinite(start)) throw new Error("The qualifiers' first day is a date, YYYY-MM-DD.");
  const shift = start - Date.parse(`${winterRoyaleFirstDay}T00:00:00.000Z`);
  const moved = (list) => list.map(({ startsAt, endsAt }) => ({ startsAt: new Date(Date.parse(startsAt) + shift).toISOString(),
    endsAt: new Date(Date.parse(endsAt) + shift).toISOString() }));
  return { name: times.name, qualifiers: moved(times.qualifiers), finals: moved(times.finals), grandFinals: moved(times.grandFinals) };
}

// Makes the Winter Royale's three events in the tournament store (tournaments/store.js): {region ("NAE" or "EU"), firstDay}.
// Answers {qualifiers, finals, grandFinals}; on a refusal nothing is kept. Throws an Error with the reason.
export function createWinterRoyale(store, { region = "NAE", firstDay = winterRoyaleFirstDay } = {}, now = new Date()) {
  const schedule = winterRoyaleSchedule(region, firstDay);
  const made = [];
  try {
    const qualifiers = store.create({ name: `Winter Royale Qualifiers (${schedule.name})`, playlist: "showdownSolo", ruleset: "winterRoyale2018Qualifiers",
      windows: schedule.qualifiers, pinScore: winterRoyalePinScore, images: winterRoyaleImages, display: winterRoyaleQualifiersDisplay }, now);
    made.push(qualifiers);
    const finals = store.create({ name: `Winter Royale Finals (${schedule.name})`, playlist: "showdownSolo", ruleset: "winterRoyale2018Finals",
      windows: schedule.finals, qualifier: { eventId: qualifiers.id, places: winterRoyaleFinalists } }, now);
    made.push(finals);
    const grandFinals = store.create({ name: `Winter Royale Grand Finals (${schedule.name})`, playlist: "showdownSolo", ruleset: "winterRoyale2018GrandFinals",
      windows: schedule.grandFinals, qualifier: { eventId: finals.id, places: winterRoyaleGrandFinalists } }, now);
    return { qualifiers, finals, grandFinals };
  } catch (err) {
    for (const event of made) store.remove(event.id);
    throw err;
  }
}
