<h1>
  <img src="https://github.com/user-attachments/assets/28d73a41-1c02-4343-8365-3a19d0771d48" width="50" height="50" align="absmiddle" />
  &nbsp;Core-Backend
</h1>

**Core-Backend** is a community made universal Fortnite backend, made to be used with [Core V2](https://github.com/PongooDev/CoreV2). It runs on your own PC with no database: accounts are created automatically the first time you log in with a new name, and everything is saved as JSON files. Each Fortnite build gets the routes and profiles it needs, worked out from that build's own client.

This repository does NOT include Fortnite game files, a launcher, a redirect, or the gameserver.

> Core-Backend is an independent community project. It is not affiliated with, endorsed by, or supported by Epic Games.

**Please refer to the [Contributing](#contributing) section before posting an issue, Thank you!**

[Join the Core Discord](https://discord.gg/auzEaKs7AS) · [Core V2](https://github.com/PongooDev/CoreV2) · [Report an issue](https://github.com/PongooDev/Core-Backend/issues)

## Version support

| Status | Fortnite versions |
| --- | --- |
| Full support ✅ | 1.1 – 1.2 |
| In development 🚧 | 1.7.2 |

Core-Backend follows Core V2: one build at a time, each build fully working before the next, skipping builds nobody has a copy of. Full support is always one range: every build from the first version to the last one listed.

<details>
<summary>Every build by changelist</summary>

| Fortnite version | Build | Status |
| --- | --- | --- |
| 1.1 | Cert CL-3532353 (UE 4.16) | Full support ✅ |
| 1.2 | Release-Cert CL-3541083 (UE 4.16) | Full support ✅ |
| 1.7.2 | Release-Cert CL-3700114 (UE 4.16) | In development 🚧 |

</details>

## Contents

- [Running](#running)
- [Play with friends](#play-with-friends)
- [Config options](#config-options)
- [Contributing](#contributing)
- [Credits](#credits)
- [License](#license)

## Running

### Requirements
- Windows 10 or Windows 11
- [Node.js](https://nodejs.org) 22 or newer

### Run steps
1. Clone the repository:

   ```
   git clone https://github.com/PongooDev/Core-Backend

   cd Core-Backend
   ```

2. Install the dependencies:

   ```
   npm install
   ```

3. Start the backend:

   ```
   npm start
   ```

The backend listens on port `5595`, on `127.0.0.1` only: other PCs can't connect until you turn on remote access
([Play with friends](#play-with-friends)). Fortnite needs a redirect that sends its requests to `127.0.0.1:5595`. The Cert
build also works without one when launched with `-epicportal -httpproxy=127.0.0.1:5595`.

The Cert build logs in, reaches the Save the World frontend, and gets quest rewards and daily login rewards.

XMPP (presence, chat and parties) is served on the same port. The Cert client connects to XMPP straight over TCP,
not through the redirect; the backend's start-up hotfix (cloud storage `DefaultEngine.ini`) points it at the backend,
so nothing has to be set up for it.

The admin panel is at `http://127.0.0.1:5595/admin`, only from the same PC (no login; it refuses other machines and
other sites). It has:

- **Dashboard:** accounts, who is online, game sessions, uptime and version, recent logins, unanswered requests.
- **Players:** search accounts, then per player:
  - **Overview:** set the level, V-Bucks, skill points, research points, hero/survivor/schematic XP, boost XP,
    llama vouchers and training manuals; refill rest XP; reset today's mission alerts.
  - **Inventory:** the account, backpack, storage and collection book items by kind, with level, quantity and remove,
    100 to a page; **Group copies** shows one row per template and removes the extra copies (squad members stay).
  - **Give:** quick grants, or search any item, hero, schematic, llama, voucher, quest, skill tree node or banner.
    Heroes, schematics, survivors, defenders and llamas are one item each: at most 500 per grant, and more than 10
    asks first.
  - **Quests:** complete, claim or remove quests; skip the tutorial.
  - **Storm shields:** set each storm shield's level.
  - **Account:** kick (logs the player out everywhere), ban with a reason and unban, reset chosen profiles or all
    progress, delete the account.
- **Sessions:** registered game servers with their mode, region, players and state; end a session.
- **Friends:** turn remote access on or off, set the public address, and see what friends enter and which ports to
  forward ([Play with friends](#play-with-friends)).
- **Logs:** the backend's console live (filter, pause) and the requests nothing answered.

Changes save at once; a player who is in the game sees them after the next profile refresh (Kick makes the game
reload).

To run the tests:

```
npm test
```

## Play with friends

Friends on other PCs can log in to your backend and join your gameservers.

**On your PC (the host):**

1. Open the admin panel's **Friends** page and press **Turn on remote access**. The backend then listens on every
   network interface instead of `127.0.0.1` only (at once, no restart). Allow Node.js through Windows Firewall if it
   asks, and Fortnite too when your gameservers start.
2. For friends on the internet, forward these ports on your router to your PC, with the same port numbers:

   | Protocol | Port | For |
   | --- | --- | --- |
   | TCP | `5595` (the backend's port) | Login, MCP, XMPP chat and parties |
   | UDP | `7777` and up, one per gameserver | The game |
   | UDP | `15000` and up, one per gameserver | The gameserver's beacon (joining) |

   The Friends page lists the ports your running gameservers use. Friends on your network, or on a VPN such as
   Tailscale, ZeroTier, Hamachi or Radmin, need no forwarding.
3. Optionally set **Public address** to your public IP or a dynamic DNS name. Players are sent to your gameservers at
   the IP they connected to, so it is only needed when friends connect with a host name or without `CoreRedirect.dll`.
4. Tell your friends the address: your public IP (or your network/VPN address, which the Friends page shows) and the
   port, e.g. `203.0.113.7:5595`. They need the same Fortnite build as you.

**On your friend's PC:** in [Core Launcher](https://github.com/PongooDev/Core-Launcher), Settings → Backend → **A
friend's backend**, enter the address, **Test connection**, Save, and Play. Without the launcher, start the game with
`-CoreBackend=http://<address>:<port>` (CoreRedirect.dll) and `-httpproxy=<address>:<port>`.

Your friend gets an account on your backend, named after their player name. Core doesn't check passwords, so anyone who
can reach the port can log in with any name: only share the address with people you trust (Players → Account can kick
and ban). The admin panel and the launcher's `/core/api` routes still only answer on your PC; the one route other
machines get is `GET /core/api/status` (`{"name":"Core-Backend","version":...}`), which the launcher uses to check
the connection.

Gameserver addresses: a gameserver on your PC registers as `127.0.0.1`, which another PC can't use. A player on your
PC gets that; a player on your network or VPN gets the address they reached the backend on; a player on the internet
gets the public address when one is set, else the IP they connected to. The same goes for the XMPP address in the
start-up hotfix.

## Config options

Core-Backend reads an optional `config.json` from the folder it is started in. Command-line options override it.

| Option | Command line | Default | Purpose |
| --- | --- | ---: | --- |
| `port` | `--port <n>` | `5595` | Port the backend listens on (`0` picks a free one; the log says which). |
| `dataDir` | `--data <folder>` | `data` | Folder for accounts, profiles, tokens and logs. |
| `emptyServerWaitMs` | | `30000` | How long a client's search for an empty gameserver waits for one to register or free up before it is answered with none. |
| `remoteAccess` | `--remote-access` / `--local-only` | `false` | Let other PCs connect: listen on every interface instead of `127.0.0.1` only ([Play with friends](#play-with-friends)). |
| `listenAddress` | `--listen <ip>` | | With remote access on, listen on this one address of your PC (e.g. its VPN address) instead of every interface. |
| `publicAddress` | `--public-address <ip or host>` | | The address players on the internet are sent to for your gameservers and XMPP. A host name is looked up every 5 minutes. |
| `battleRoyaleNews` | | Core's | The Battle Royale lobby's news box (1.7.2+): `{"title": "...", "body": "..."}`. |
| | `--config <file>` | `config.json` | Config file to read. |

`remoteAccess` and `publicAddress` can also be changed on the admin panel's Friends page, which saves them in
`<dataDir>/network.json` (kept with the accounts, so launcher updates keep them). That file overrides `config.json`;
an option given on the command line overrides both and can't be changed in the panel.

Example:

```json
{
  "port": 5595,
  "remoteAccess": true,
  "publicAddress": "203.0.113.7"
}
```

From a launcher: `node src/main.js --port 5595 --data <folder>`. It never prompts, prints `Listening on port <n>` when
ready, exits with code 1 if the port is taken and 2 for bad options, and shuts down cleanly on Ctrl+C or SIGTERM.

Requests the backend doesn't handle yet are saved to `data/logs/unknown/<CL>.jsonl`, one file per Fortnite build.

## Contributing

Contributions are welcome, whether it is code or an issue report.

### Issue reports

Include all of the following in a report if possible:

1. Fortnite version and CL
2. What you did and what happened
3. Backend log
4. The `data/logs/unknown/<CL>.jsonl` file for your build
5. Core-Backend commit
6. Anything else that may help

**Issues that are overly broad or provide too little information to accurately show or reproduce the problem may be closed until the required details are supplied.**

### Code

Before submitting code:

1. Keep unrelated fixes in separate pull requests
2. Keep your code clean and readable.
3. Test your code and include the builds you tested it on.
4. Base routes and profile data on what the build's client actually sends and expects, not on other builds.
5. Avoid broad version gates unless the compatibility boundary is understood and supported by testing or other evidence.

**Pull requests may be declined when they are inaccurate, untested, overly broad, unrelated to the reported issue, or harmful to other supported versions.**

## Credits

- **PongooDev** — project creator and primary maintainer
- [Core-Backend contributors](https://github.com/PongooDev/Core-Backend/graphs/contributors)
- [LawinServer](https://github.com/Lawin0129/LawinServer) — its copy of Epic's Save the World world info is where the
  theater layouts in `gamedata/theaters.json` come from (GPL-3.0), converted by `tools/theaters/import.mjs`

For more help, join the [Core Discord](https://discord.gg/auzEaKs7AS).

## License

Core-Backend is licensed under the [GNU General Public License v3.0](LICENSE).

---
If you use Core-Backend in another project, please credit the Core project.
