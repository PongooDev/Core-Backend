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

| Fortnite version | Status |
| --- | --- |
| Cert CL-3532353 (UE 4.16) | In progress 🚧 |

Core-Backend follows Core V2: one build at a time, each build fully working before the next.

## Contents

- [Running](#running)
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

The backend listens on port `5595`. Fortnite needs a redirect that sends its requests to `127.0.0.1:5595`.

Right now the backend only records what the client asks for. Login and profiles are next.

To run the tests:

```
npm test
```

## Config options

Core-Backend reads an optional `config.json` next to `package.json`.

| Option | Default | Purpose |
| --- | ---: | --- |
| `port` | `5595` | Port the backend listens on. |
| `dataDir` | `data` | Folder for accounts, profiles and logs. |

Example:

```json
{
  "port": 5595
}
```

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

For more help, join the [Core Discord](https://discord.gg/auzEaKs7AS).

## License

Core-Backend is licensed under the [GNU General Public License v3.0](LICENSE).

---
If you use Core-Backend in another project, please credit the Core project.
