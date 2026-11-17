# MCP commands and profiles

## Routes (src/services/mcp/profile.js)

| Route | Table | Caller |
| --- | --- | --- |
| `POST /fortnite/api/game/v2/profile/:accountId/client/:command` | `clientCommands` (`commands/index.js`) | the player's client, own account only |
| `POST /fortnite/api/game/v2/profile/:accountId/public/:command` | `publicCommands` (`commands/server.js`) | anyone (QueryPublicProfile) |
| `POST /fortnite/api/game/v2/profile/:accountId/dedicated_server/:command` | `serverCommands` (`commands/server.js`) | Core's gameserver |
| `POST /fortnite/api/admin/account/:accountId/:profileId/command/:command` | `adminCommands` | the admin panel |

A command missing from its table is answered with Epic's `errors.com.epicgames.fortnite.operation_not_found`.
Requests no route answers are logged per build to `<dataDir>/logs/unknown/<CL>.jsonl`; ask reporters for that file.

## A command handler

One file per command, named after Epic's command (`src/services/mcp/commands/SetAffiliateName.js`):

- a header comment: the profile class it belongs to (`UFortMcpProfileCommonCore`), the build and CL it first
  appears in, its parameters from the SDK, what the client reads back (with the exe address), and which choices are
  Core's (`🟡`);
- `export function setAffiliateName({ req, session })`: read `req.body`, get a profile tracker with
  `session.profile("<profileId>")` (`athena`, `common_core`, `profile0`, `campaign`, ...), change stats and items
  through the tracker so profile changes and revisions are sent;
- throw `new McpError("errors.com.epicgames....", message)` with Epic's error code for a refusal;
- register it in `clientCommands` (or `serverCommands`, `adminCommands`) in alphabetical order.

Profile logic shared by commands lives in `src/profiles/` (`athena.js`, `common.js`, `items.js`,
`quests.js`, `heroes.js`, `homebase.js`, ...).

## Finding the commands a build sends

- The build's SDK: the `UFortMcpProfile*` classes' functions and their parameter structs (`*_parameters.hpp` in
  `C:\Dumper-7\<build>\CppSDK\SDK`). Diff against the previous build's SDK for new or changed commands.
- The exe's strings (IDA, read-only): command names and route templates.
- `logs/unknown/<CL>.jsonl` from a real session.

For a new build, list every command name in the new SDK that `clientCommands` and `serverCommands` don't have, and
every parameter list that changed. A missing handler means a client error or a feature that silently does nothing.

## Tests

Command tests start a backend with `startBackend()` (`tests/helpers.js`), log in as the build (its User-Agent), call
the route with `send`, and check the profile changes. Pin the build the command is for and one build without it.
