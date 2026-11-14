import { datedEvent, datedModesOf, shiftedDatedSchedule, validDatedSchedule } from "../events/datedflags.js";
import { spacedOdditySchedule } from "../events/season4flags.js";

// The admin panel's Events page, in plain words (Core-Backend #351): each event as players know it, the builds it is on, its
// state now ("on now", "scheduled", "off", "follows Epic's dates") and one control (Off, Epic's dates, Custom start/end, Start
// now). It is a view over the stores the events already have (events config rocketLaunch, season4Flags.oddities,
// datedFlags, stormDestruction, contentUpdates, meteorStrike and the event mode), so their own routes and saved settings are
// unchanged; scheduleEventPatch turns the one control into those stores' settings.

// Each event: kind "build" (it runs on its builds by itself, as Epic ran it; the event mode above them switches it), or one
// with a schedule of its own. ranges are the changelists players see it on (the "what players see now" line).
export const eventCards = [
  { id: "fortnitemares2017", kind: "build", seasons: [1], name: "Fortnitemares 2017", builds: "1.8 – 1.9", ranges: [[3724489, 3757339]], force: "force_fortnitemares",
    about: "Save the World's Halloween: Hexsylvania, Candy, the Fortnitemares Llama and its quests.", flags: ["EventFlag.Fortnitemares"] },
  { id: "mutantStorms", kind: "build", seasons: [1, 2], name: "Mutant Storms", builds: "1.9.1 – 1.10, 2.3 – 2.4.2", ranges: [[3775276, 3790078], [3847564, 3870737]],
    force: "force_mutantstorms", about: "Save the World's storm mission alerts with Storm Tickets, the Vindertech (1.9.1 – 1.10) or Hydraulic (2.3 – 2.4.2) quests and llamas.",
    flags: ["EventFlag.Vindertech", "EventFlag.ActiveStorms", "EventFlag.ActiveMiniBosses"] },
  { id: "winter2017", kind: "build", seasons: [2], name: "Survive the Holidays (Winterfest 2017)", builds: "1.11 – 2.2", ranges: [[3807424, 3841827]], force: "force_winter2017",
    about: "Mini-Boss alerts, Snowflake Tickets and Holiday Survival Llamas; in Battle Royale (1.11 – 2.1) the winter lobby, the holiday Battle Bus and gift supply drops.",
    flags: ["EventFlag.Winter2017", "EventFlag.PassiveStorms", "EventFlag.LobbyWinterDecor", "EventFlag.WinterBattleBus", "EventFlag.SupplyDropGift"] },
  { id: "spring2018", kind: "build", seasons: [2, 3], name: "Spring It On!", builds: "2.5 – 3.3", ranges: [[3889387, 3942182]],
    about: "Valentine's and Lunar New Year quests, Firecracker Tickets and the Spring Llama; Brave Beginnings from 3.1, Luck of the Storm on 3.3.",
    flags: ["EventFlag.Spring2018Valentines", "EventFlag.Spring2018Phase1", "EventFlag.Spring2018Phase2", "EventFlag.Spring2018Phase3", "EventFlag.PassiveStorms", "EventFlag.PassiveMiniBosses"] },
  { id: "contentUpdates", kind: "contentUpdates", seasons: [2], name: "Season 2 loot updates", builds: "1.11 – 2.4", ranges: [[3807424, 3858292]],
    about: "Epic's loot hotfixes of Season 2 (new and vaulted items). A gameserver takes them when it starts.", flags: [] },
  { id: "storm2018", kind: "build", seasons: [3], name: "Into the Storm", builds: "3.5.1 – 3.6", ranges: [[4000805, 4019403]],
    about: "Survive the Storm's return, Mutant Storm alerts with Storm Tickets and the Into the Storm Llama; the Encore from 3.5.2.",
    flags: ["EventFlag.Storm2018Phase1", "EventFlag.Storm2018Phase2", "EventFlag.SurviveTheStorm", "EventFlag.ActiveStorms", "EventFlag.PassiveMiniBosses"] },
  { id: "meteorStrike", kind: "choice", seasons: [3], name: "Meteor shower (Season 3's finale)", builds: "3.6", ranges: [[4019403, 4019403]],
    about: "How far the comet's meteor shower has gone. Restart the game and the server after a change.", flags: [] },
  { id: "blockbuster2018", kind: "build", seasons: [4], name: "Blockbuster", builds: "4.0 – 4.5", ranges: [[4039451, 4166199]],
    about: "Save the World's Blockbuster quest line (Parts 1 to 4), Mini-Boss alerts with Blockbuster Tickets, the Blockbuster Llama; the Season 4 lobby.",
    flags: ["EventFlag.Blockbuster2018Phase1", "EventFlag.Blockbuster2018Phase2", "EventFlag.Blockbuster2018Phase3", "EventFlag.Blockbuster2018Phase4", "EventFlag.ActiveMiniBosses", "EventFlag.PassiveStorms", "EventFlag.LobbySeason4"] },
  { id: "rocket", kind: "rocket", seasons: [4], name: "Rocket launch (Blast Off)", builds: "4.5", ranges: [[4159770, 4166199]], startLabel: "Launches at",
    about: "The villain lair's rocket counts down, launches, cracks the sky and leaves the lair gone. Matches running then play it.",
    flags: ["EventFlag.BR_S4_Geode_Countdown", "EventFlag.BR_S4_Geode_Begin", "EventFlag.BR_S4_Geode_Over", "EventFlag.BR_S4_Rift_Growth"] },
  { id: "oddities", kind: "oddities", seasons: [4], name: "Rifts of July (objects vanish and appear)", builds: "4.5", ranges: [[4159770, 4166199]],
    startLabel: "First rift forms", endLabel: "Last object rifted",
    about: "Eight rifts take the map's objects away (the Durrr Burger head, the Tomato Head …) or bring new ones in, one a day.",
    flags: ["EventFlag.BR_S4_Oddity_01_Tell … _08_Tell", "EventFlag.BR_S4_Oddity_01_Event … _08_Event"] },
  { id: "roadTrip2018", kind: "build", seasons: [5], name: "Road Trip and Challenge the Horde", builds: "5.0 – 5.41", ranges: [[4204761, 4363240]],
    about: "Save the World's Road Trip quests, Road Trip Tickets and llama, and Challenge the Horde; the Season 5 lobby.",
    flags: ["EventFlag.RoadTrip2018", "EventFlag.Horde", "EventFlag.LobbySeason5"] },
  { id: "birthday", kind: "dated", dated: "birthday", seasons: [5], name: "Birthday Challenges (Fortnite's 1st Birthday)", builds: "5.10 – 5.21", ranges: [[4225813, 4288479]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "The Birthday Challenges (a back bling, emoticon and spray), the birthday Battle Bus and supply drops, and Save the World's Birthday quests and llama." },
  { id: "tomatoRift", kind: "dated", dated: "tomatoRift", seasons: [5], name: "Tomato Town's rift", builds: "5.21", ranges: [[4288479, 4288479]],
    key: "tell", endStep: "event", startLabel: "Rift forms", endLabel: "Stone tomato head appears",
    about: "A rift forms over Uncle Pete's Pizza Pit, then spits out a stone tomato head." },
  { id: "cube", kind: "dated", dated: "cube", seasons: [5], name: "The Cube (Kevin)", builds: "5.30 – 5.41", ranges: [[4305896, 4363240]],
    key: "spawn", endStep: "lake", nowLeadSeconds: 30, startLabel: "The Cube appears", endLabel: "It sinks into Loot Lake",
    about: "The purple crack and its lightning (5.30), the Cube appearing, rolling to its seven runes and sinking into Loot Lake (5.40 – 5.41)." },
  { id: "highStakes", kind: "dated", dated: "highStakes", seasons: [5], name: "High Stakes", builds: "5.40 – 5.41", ranges: [[4352937, 4363240]],
    key: "challenges", endOfKey: true, startLabel: "Challenges start", endLabel: "Challenges end",
    about: "The High Stakes Challenges (play The Getaway, damage Jewel carriers, pick up Jewels)." },
  { id: "stormDestruction", kind: "storm", seasons: [5], name: "Storm Destruction (the storm destroys builds)", builds: "5.40 – 5.41", ranges: [[4352937, 4363240]],
    about: "The storm's edge flashes and destroys structures in the last four circles. Restart the game and the server after a change.", flags: ["Athena.bMegaStormEnabled (hotfix)"] },
  { id: "cramSession2018", kind: "build", seasons: [6], name: "Cram Session", builds: "6.00 – 6.10", ranges: [[4395664, 4480234]],
    about: "Save the World's Season 6 mini-event: Mini-Boss alerts with Gold, its quest lines and Weekly Store weapons; the Season 6 lobby.",
    flags: ["EventFlag.ActiveMiniBosses", "EventFlag.PassiveStorms", "EventFlag.LobbySeason6"] },
  // Its flags are served to 6.20 too, but 6.20's island scripting watches POI0, POI1 and the crack instead (events/events.js).
  { id: "island", kind: "dated", dated: "island", seasons: [6], name: "Floating island", builds: "6.00 – 6.10", ranges: [[4395664, 4480234]],
    key: "lake", endStep: "home", startLabel: "Rises over Loot Lake", endLabel: "Back over Loot Lake",
    about: "The island over Loot Lake floats to the seven runes the Cube lifted and back. Needs the build's server-assets pak." },
  { id: "fortnitemares2018", kind: "build", seasons: [6], name: "Fortnitemares 2018", builds: "6.20 – 6.31", ranges: [[4497486, 4573279]],
    about: "The Cube Monsters' modes, the Fortnitemares Challenges, the Halloween lobby and Battle Bus; Save the World's Fortnitemares Part 1 (Hexsylvania, Candy), and on 6.22 to 6.31 Part 2 (Battle Royale's Fortnitemares is over there: its challenges stay).",
    flags: ["EventFlag.Fortnitemares", "EventFlag.FortnitemaresPhase1", "EventFlag.FortnitemaresPhase2 (6.22 – 6.31)", "EventFlag.ActiveMiniBosses", "EventFlag.LTM_Fortnitemares", "EventFlag.LobbySeason6Halloween (6.20, 6.21)", "EventFlag.HalloweenBattleBus (6.20, 6.21)", "POI0 (6.20, 6.21)", "POI1 (6.22)", "EventFlag.LTM_LilKevin (6.21 – 6.31)", "EventFlag.Fortnitemares_Part4 (6.21)"] },
  { id: "butterfly", kind: "dated", dated: "butterfly", seasons: [6], name: "The Butterfly (the Cube's end)", builds: "6.21", ranges: [[4526925, 4526925]],
    key: "butterfly", startLabel: "The Butterfly happens",
    about: "The Cube cracks and drains into the lake, then bursts: every player in a match goes to the In-Between and back. Matches running then play it. Fortnitemares' modes end with it and Solo, Duos and Squads come back; Before the event puts the map back as it was, the Fortnitemares modes with it." }
];
export const eventCard = (id) => eventCards.find((card) => card.id === id);

const modeLabels = { off: "Off", before: "Before the event", dates: "Epic's dates", custom: "Custom", build: "As the build ran it", launch: "After the rocket launch", always: "Always on",
  season: "Epic's dates", all: "All on" };
export const meteorStrikePhases = [["none", "Comet only"], ["broadcast", "TVs show static"], ["meteors", "Meteors"], ["impact", "Meteors at their most"]];
const eventModeNames = { force_fortnitemares: "forces Fortnitemares 2017", force_mutantstorms: "forces the Mutant Storms", force_winter2017: "forces Survive the Holidays",
  custom: "serves only the flags listed under Advanced" };

const ms = (iso) => (iso ? Date.parse(iso) : null);
const onAt = (window, now) => Boolean(window) && ms(window.startAt) <= now && (window.endAt === null || now < ms(window.endAt));

// A schedule of steps ([{label, startAt, endAt}], null endAt: stays on) as plain words at nowMs: the step on now (the last
// that is), the next to start, or over.
function stepsState(steps, now) {
  const on = steps.filter((step) => onAt(step, now));
  const next = steps.filter((step) => step.startAt && ms(step.startAt) > now).sort((a, b) => ms(a.startAt) - ms(b.startAt))[0];
  if (on.length) {
    const current = on.at(-1);
    return { tone: "on", nowLabel: current.label, text: `On now: ${current.label}${next ? `. Next: ${next.label}, {at}` : ""}`, at: next?.startAt ?? null };
  }
  if (next) return { tone: "scheduled", text: `Scheduled: ${next.label}, {at}`, at: next.startAt };
  const ends = steps.filter((step) => step.endAt).map((step) => step.endAt).sort();
  return { tone: "over", text: steps.length ? "Over: ended {at}" : "Nothing scheduled", at: ends.at(-1) ?? null };
}

const datesPrefix = (state) => ({ ...state, tone: state.tone === "on" ? "on" : "dates", text: `Follows Epic's dates. ${state.text}` });

// Each event's state now, from the stores' own status views (the overview's): rocket (events/rocketlaunch.js
// rocketLaunchStatus), dated (events/datedflags.js datedFlagsStatus), season4 (events/oddities.js season4FlagsStatus), storm
// (events/stormdestruction.js stormDestructionStatus), the events config and whether the seasonal events run at all.
export function eventSchedules({ now = new Date(), config = {}, seasonalEvents = true, rocket, dated, season4, storm, links = {} }) {
  const nowMs = now.getTime();
  const mode = config.mode ?? "auto";
  const blocked = !seasonalEvents ? "Off: the Seasonal Events switch (Settings) is off" : mode === "off" ? "Off: the event mode is All off" : null;
  const datedById = Object.fromEntries((dated?.events ?? []).map((event) => [event.id, event]));

  const stateOf = (card) => {
    if (card.kind === "build") {
      if (mode === "auto") return { tone: "dates", nowLabel: "on", text: `Follows Epic's: runs on ${card.builds} by itself` };
      if (card.force === mode) return { tone: "on", nowLabel: "forced on", text: "On now: forced on every build by the event mode" };
      return { tone: "off", text: `Not running: the event mode ${eventModeNames[mode] ?? mode}` };
    }
    if (card.kind === "contentUpdates") {
      const updates = config.contentUpdates?.mode ?? "season";
      return updates === "all" ? { tone: "on", nowLabel: "all on", text: "On now: every update" } : { tone: "dates", text: "Follows Epic's dates on Season 2's replay" };
    }
    if (card.kind === "choice") {
      const phase = meteorStrikePhases.find(([id]) => id === (config.meteorStrike ?? "meteors")) ?? meteorStrikePhases[2];
      return { tone: phase[0] === "none" ? "off" : "on", nowLabel: phase[1].toLowerCase(), text: `On now: ${phase[1]}` };
    }
    if (card.kind === "storm") {
      if (!storm || storm.mode === "off" || storm.percent === 0) return { tone: "off", text: "Off" };
      if (storm.mode === "always") return { tone: "on", nowLabel: `${storm.percent}% of matches`, text: `On now: in ${storm.percent}% of 5.40 and 5.41 matches` };
      return storm.inDates ? { tone: "on", nowLabel: `${storm.percent}% of matches`, text: `Follows Epic's dates. On now: in ${storm.percent}% of 5.40 matches` }
        : { tone: "dates", text: "Follows Epic's dates (7 September on Season 5's replay, 5.40 only): off now" };
    }
    if (card.kind === "rocket") {
      const r = rocket ?? { mode: "off", phase: "unscheduled" };
      const prefix = r.mode === "dates" ? (state) => datesPrefix(state) : (state) => state;
      if (r.mode === "off") return { tone: "off", text: "Off: the rocket waits in its lair" };
      if (r.phase === "scheduled") return prefix({ tone: "scheduled", text: "Scheduled: launches {at}", at: r.launch });
      if (r.phase === "countdown") return prefix({ tone: "on", nowLabel: "counting down", text: "On now: counting down to the launch, {at}", at: r.launch });
      if (r.phase === "launching") return prefix({ tone: "on", nowLabel: "launching", text: "On now: the rocket is launching" });
      if (r.phase === "rift") return prefix({ tone: "on", nowLabel: "launched, the sky's crack grows", text: "On now: launched, the sky's crack grows until {at}", at: r.riftEnd });
      if (r.phase === "over") return prefix({ tone: "over", nowLabel: "launched", text: "Over: launched {at}", at: r.launch });
      return { tone: "off", text: "Off" };
    }
    if (card.kind === "oddities") {
      const s4 = season4 ?? { oddities: "off", rifts: [] };
      if (s4.oddities === "off") return { tone: "off", text: "Off: no rifts (switch them one by one under Advanced)" };
      if (mode !== "auto") return { tone: "off", text: "Paused: runs in the Automatic event mode only" };
      const rifts = s4.rifts.filter((rift) => rift.tellAt);
      if (!rifts.length) return { tone: "off", text: s4.oddities === "launch" ? "Waits for the rocket launch" : "Nothing scheduled" };
      const forming = rifts.find((rift) => ms(rift.tellAt) <= nowMs && nowMs < ms(rift.eventAt));
      const done = rifts.filter((rift) => ms(rift.eventAt) <= nowMs).length;
      const next = rifts.flatMap((rift) => [{ label: `rift ${rift.number} forms`, at: rift.tellAt }, { label: `rift ${rift.number} strikes`, at: rift.eventAt }])
        .filter(({ at }) => ms(at) > nowMs).sort((a, b) => ms(a.at) - ms(b.at))[0];
      const then = next ? `. Next: ${next.label}, {at}` : "";
      const result = forming ? { tone: "on", nowLabel: `rift ${forming.number} forming`, text: `On now: rift ${forming.number} is forming (${done} of ${rifts.length} struck)${then}`, at: next?.at ?? null }
        : done && next ? { tone: "on", nowLabel: `${done} of ${rifts.length} rifts struck`, text: `On now: ${done} of ${rifts.length} rifts struck${then}`, at: next.at }
        : next ? { tone: "scheduled", text: `Scheduled: ${next.label}, {at}`, at: next.at }
        : { tone: "over", text: "Over: every rift has struck" };
      return s4.oddities === "dates" ? datesPrefix(result) : s4.oddities === "launch" ? { ...result, text: `After the rocket launch. ${result.text}` } : result;
    }
    // A dated event (events/datedflags.js).
    const event = datedById[card.dated];
    if (!event) return { tone: "off", text: "Off" };
    if (event.mode === "off") {
      return { tone: "off", text: card.id === "butterfly" ? "Off: 6.21 keeps Fortnitemares' Cube Monsters' days (POI0) on; the Butterfly plays only by the flag switches under Advanced" : "Off" };
    }
    if (event.mode === "build") return { tone: "dates", nowLabel: "on", onRanges: [[4225813, 4240749]], text: "As the build ran it: on in 5.10 (counting down to 7 August on Season 5's replay), off in 5.21" };
    if (mode !== "auto") return { tone: "off", text: "Paused: runs in the Automatic event mode only" };
    // The Butterfly held before the event (Core-Backend #354): the map's pre-event state, with 6.21's Fortnitemares modes.
    if (event.mode === "before") {
      return { tone: "on", nowLabel: "before the event", text: "On now: the map before the event (Fortnitemares' Cube Monsters' days, POI0), and the Fortnitemares modes back with it; the Butterfly doesn't play" };
    }
    const state = stepsState(event.steps.map((step) => ({ label: step.label, ...(step.current ?? { startAt: null, endAt: null }) })).filter((step) => step.startAt), nowMs);
    return event.mode === "dates" ? datesPrefix(state) : state;
  };

  // The control's modes and the custom pickers' times now.
  const controlOf = (card) => {
    if (card.kind === "build") return { modes: [] };
    if (card.kind === "contentUpdates") return { mode: config.contentUpdates?.mode ?? "season", modes: ["season", "all"] };
    if (card.kind === "choice") return { mode: config.meteorStrike ?? "meteors", modes: meteorStrikePhases.map(([id]) => id), labels: Object.fromEntries(meteorStrikePhases) };
    if (card.kind === "storm") return { mode: storm?.mode ?? "dates", modes: ["off", "dates", "always"], percent: storm?.percent ?? 10 };
    if (card.kind === "rocket") {
      return { mode: rocket?.mode ?? "off", modes: ["off", "dates", "custom"], now: true, startAt: rocket?.launch ?? rocket?.at ?? null, countdownHours: rocket?.countdownHours ?? 48,
        original: rocket?.original ?? null };
    }
    if (card.kind === "oddities") {
      const rifts = (season4?.rifts ?? []).filter((rift) => rift.tellAt);
      return { mode: season4?.oddities ?? "off", modes: ["off", "dates", "launch", "custom"], now: true, startAt: rifts[0]?.tellAt ?? null, endAt: rifts.at(-1)?.eventAt ?? null };
    }
    const event = datedById[card.dated];
    const own = datedEvent(card.dated);
    const key = event?.steps.find((step) => step.step === card.key);
    const endRef = card.endOfKey ? key : card.endStep ? event?.steps.find((step) => step.step === card.endStep) : null;
    const shown = (step) => step?.current ?? step?.custom ?? step?.dates ?? null;
    return { mode: event?.mode ?? "off", modes: event?.modes ?? ["off", "dates", "custom"], now: true, startAt: shown(key)?.startAt ?? null,
      endAt: card.endOfKey ? shown(key)?.endAt ?? null : card.endStep ? shown(endRef)?.startAt ?? null : null, steps: own?.steps.length ?? 0 };
  };

  return eventCards.map((card) => {
    const control = controlOf(card);
    const state = blocked && card.kind !== "contentUpdates" ? { tone: "off", text: blocked } : stateOf(card);
    return {
      id: card.id, kind: card.kind, name: card.name, builds: card.builds, seasons: card.seasons, about: card.about, ranges: card.ranges,
      flags: card.flags ?? datedEvent(card.dated)?.steps.flatMap((step) => step.flags).filter((flag, index, all) => all.indexOf(flag) === index) ?? [],
      startLabel: card.startLabel ?? null, endLabel: card.endOfKey || card.endStep || card.kind === "oddities" ? card.endLabel : null,
      ...control, modeLabels: Object.fromEntries((control.modes ?? []).map((id) => [id, control.labels?.[id] ?? modeLabels[id] ?? id])),
      state, links: links[card.id] ?? []
    };
  });
}

// What players on each build see now: the events on now there, in plain words ("No event" without one).
export function buildsNow(builds, cards, storm) {
  return builds.map(({ version, cl }) => {
    const on = cards.filter((card) => (card.state.onRanges ?? card.ranges).some(([first, last]) => cl >= first && cl <= last))
      .filter((card) => card.kind === "storm" ? storm?.builds?.[cl] === true : card.state.nowLabel)
      .map((card) => (card.kind === "build" || card.state.nowLabel === "on" ? card.name : `${card.name}: ${card.state.nowLabel}`));
    return { version, cl, sees: on.length ? on.join(" · ") : "No event: the base game" };
  });
}

// The one control as the stores' settings: {event, mode, startAt?, endAt?, countdownHours?, percent?} to an events config
// patch ({rocketLaunch}, {season4Flags}, {datedFlags}, {stormDestruction}, {contentUpdates} or {meteorStrike}), or {error}.
// "now" is the custom mode from now (the key moment now, or nowLeadSeconds on). The current events config fills a
// custom mode chosen without times with the ones it has.
export function scheduleEventPatch(body, config = {}, now = new Date()) {
  const card = eventCard(body?.event);
  if (!card || card.kind === "build") return { error: `event must be one of ${eventCards.filter(({ kind }) => kind !== "build").map(({ id }) => id).join(", ")}` };
  const modes = card.kind === "rocket" ? ["off", "dates", "custom", "now"] : card.kind === "oddities" ? ["off", "dates", "launch", "custom", "now"]
    : card.kind === "storm" ? ["off", "dates", "always"] : card.kind === "contentUpdates" ? ["season", "all"] : card.kind === "choice" ? meteorStrikePhases.map(([id]) => id)
    : [...datedModesOf(datedEvent(card.dated)), "now"];
  const mode = body.mode;
  if (!modes.includes(mode)) return { error: `mode must be ${modes.join(", ")}` };
  const time = (value) => (value === undefined || value === null || value === "" ? null : typeof value === "string" && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : NaN);
  const start = mode === "now" ? now.getTime() + (card.nowLeadSeconds ?? 0) * 1000 : time(body.startAt);
  const end = mode === "now" ? null : time(body.endAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return { error: "startAt and endAt must be dates and times" };
  if (start !== null && end !== null && end <= start) return { error: "The end must be after the start" };
  const iso = (value) => new Date(value).toISOString();

  if (card.kind === "contentUpdates") return { patch: { contentUpdates: { mode } } };
  if (card.kind === "choice") return { patch: { meteorStrike: mode } };
  if (card.kind === "storm") {
    const percent = body.percent === undefined ? undefined : Number(body.percent);
    if (percent !== undefined && !(Number.isInteger(percent) && percent >= 0 && percent <= 100)) return { error: "percent must be 0 to 100" };
    return { patch: { stormDestruction: { mode, ...(percent === undefined ? {} : { percent }) } } };
  }
  if (card.kind === "rocket") {
    const hours = body.countdownHours === undefined ? {} : { countdownHours: body.countdownHours };
    if (mode === "off" || mode === "dates") return { patch: { rocketLaunch: { mode, ...hours } } };
    if (start === null) return config.rocketLaunch?.at ? { patch: { rocketLaunch: { mode: "custom", ...hours } } } : { error: "Pick the launch time" };
    return { patch: { rocketLaunch: { mode: "custom", at: iso(start), ...hours } } };
  }
  if (card.kind === "oddities") {
    if (mode !== "custom" && mode !== "now") return { patch: { season4Flags: { oddities: mode } } };
    if (start === null) return config.season4Flags?.schedule?.length ? { patch: { season4Flags: { oddities: "custom" } } } : { error: "Pick when the first rift forms" };
    // Eight rifts a spacing apart, each object going a spacing after its rift forms: the last object at start + 8 spacings.
    const spacingHours = end === null ? 24 : (end - start) / 8 / 3600000;
    const schedule = spacedOdditySchedule({ startAt: iso(start), spacingHours, warningHours: spacingHours });
    if (!schedule) return { error: "The rifts' times must be at most 30 days apart" };
    return { patch: { season4Flags: { oddities: "custom", schedule } } };
  }
  // A dated event: Epic's steps from its key moment, stretched or squeezed to the end when one is given.
  const event = datedEvent(card.dated);
  if (mode !== "custom" && mode !== "now") return { patch: { datedFlags: { [event.id]: { mode } } } };
  if (start === null) {
    return validDatedSchedule(event, config.datedFlags?.[event.id]?.schedule ?? [])?.length ? { patch: { datedFlags: { [event.id]: { mode: "custom" } } } }
      : { error: `Pick when ${card.startLabel.toLowerCase()}` };
  }
  const key = event.steps.find(({ id }) => id === card.key);
  const endRef = card.endOfKey ? key.end : card.endStep ? event.steps.find(({ id }) => id === card.endStep).start : null;
  if (end !== null && endRef === null) return { error: `${card.name} takes a start time only` };
  const scale = end === null ? 1 : (end - start) / (endRef - key.start);
  const schedule = shiftedDatedSchedule(event, { startAt: iso(start), step: card.key, scale });
  if (!schedule) return { error: "That end is too near or too far from the start (from a thousandth to ten times Epic's length)" };
  return { patch: { datedFlags: { [event.id]: { mode: "custom", schedule } } } };
}
