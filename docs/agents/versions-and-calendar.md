# Versions, seasons, events and the calendar

## Which build is asking

- `src/builds/context.js`: the request's build, read from the game's User-Agent
  (`++Fortnite+Release-7.20-CL-4727874`). Code runs per build with `inBuild(build, fn)` / `currentBuild()`.
- `src/builds/detect.js`:
  - `certBuild` (CL-3532353, 1.1);
  - `buildVersions`: CL to the version players call it, the same names as Core-Launcher's `KnownBuilds`;
  - `buildReleases`: the day Epic released a build (UTC), for builds whose season's events are dated;
  - `battleRoyaleBuilds` (1.8 onwards) and the season comments (which versions each season covers).
- `src/builds/allowed.js`: the admin's "Allowed Builds" setting.

Two CLs of one version exist (4.5, 5.0, 5.10, 6.00, 6.01, 6.02, 6.10): the earlier one is named with a `.0` suffix
(`5.0.0`), and plays on the later one's data when Core has no paks for it.

## Events and limited-time modes

- `src/events/events.js`: which events run on the requesting build and when (`configureEvents`,
  `activeEventFlags`), combining the season's replay date with each event's builds.
- One file per event in `src/events/` (`fortnitemares2018.js`, `fourteendays.js`, `icestorm.js`, `distantfog.js`, ...):
  the builds it exists on, its event flags or calendar events, and its dates.
- `src/events/ltms.js`: limited-time modes, by build and date. With the admin's **Original dates** option on, a mode
  runs in Epic's real windows, on the builds whose paks have its playlist; off, each mode follows its admin switch.
- `src/events/datedflags.js`: dated event flags.
- Seasons are **replayed**: the admin sets when the season's replay starts; "today" on the replay maps to a day of
  the original season.

Rules:
- Serve each build only what its own paks have. The same feature can use different calendar events on two builds
  (6.30's fog bank watches `BR_S6_Approach_01/02`, 6.31's iceberg `BR_S6_Approach_03` and `_Overlap`). Check the
  map's Blueprints in FModel for the event names the build watches.
- Dates come from the patch notes and the issue's own list. Where hours aren't recorded, say so (`🟡`).
- A change for one build must leave the other builds' calendars unchanged; pin both in tests.

## The calendar route

`src/services/fortnite/calendar.js` answers the timeline (`FCalendarDownload`): channels `client-events` (active
events and flags, `seasonEnd`, `weeklyStoreEnd`) and `client-matchmaking` (per-region queue switches such as 50v50
and the lobby's event queues). Its header comment documents each build's shape (1.8, 1.10, 1.11...). The client asks
again at `cacheExpire`, so it is never later than the next store rotation.

## Hotfixes and client config

- `src/services/fortnite/cloudstorage.js` serves the hotfix ini files (DefaultEngine, DefaultGame...).
- The hotfix ini text is parsed in a mode where an **unquoted `//` starts a comment**: always quote URL values,
  `Key="http://127.0.0.1:5595/..."` (#349, #355).
- From 6.20 the client reads no loose `.ini` except `GameUserSettings.ini`, and the hotfix arrives after the login
  screen. Config the client needs at login goes in Core-Launcher's config pak, not here.

## Version and lightswitch

`src/services/fortnite/version.js` and `src/services/lightswitch/` answer the version check and service status; the
"Allowed Builds" setting answers an unlisted build with "Update Required".
