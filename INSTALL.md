# Installing the taobao skill

This file is for humans installing the skill on a fresh machine. The agent
inside Claude Code can guide everything once the skill is registered, but
cannot guide its own installation (chicken and egg). Run the steps below;
afterwards the agent takes over.

The recommended install is one command via [`degit`](https://github.com/Rich-Harris/degit),
which fetches the skill directly from the public mirror at
[yuxiangcheng2002/taobao-skill](https://github.com/yuxiangcheng2002/taobao-skill).
If you can't use `degit` (offline, locked-down network, etc.) the tarball
flow still works — see "Tarball install" below.

## Prerequisites

- **Claude Code** or **Codex** installed and working. (The skill was built
  against Claude Code; Codex reads the same `SKILL.md` format — install
  under `$CODEX_HOME/skills` instead, see below.)
- **Node.js 22+** (`node -v` to check; `brew install node` on macOS,
  distro package on Linux, [nodejs.org](https://nodejs.org) on Windows).
- **A Chromium-family browser** — Google Chrome, Microsoft Edge, or Brave.
  The skill auto-detects and works with whichever you have. (Do not install
  Chromium via Homebrew on macOS — the cask ships unsigned and triggers
  Gatekeeper. Stick with Chrome / Edge / Brave.)

## Recommended install — one command via `degit`

Claude Code:

```bash
mkdir -p ~/.claude/skills
npx -y degit yuxiangcheng2002/taobao-skill ~/.claude/skills/taobao
```

Codex:

```bash
mkdir -p "${CODEX_HOME:-$HOME/.codex}/skills"
npx -y degit yuxiangcheng2002/taobao-skill "${CODEX_HOME:-$HOME/.codex}/skills/taobao"
```

`degit` (no `npm install` of the package itself) just fetches the latest
state of the public repo's `main` branch into the target directory. It
takes a couple of seconds and leaves no `.git/` behind, so subsequent
re-runs cleanly overwrite to the newest version.

Then restart Claude Code — quit and relaunch (or run `/reload-skills`
if your build supports it). The skill is registered when Claude Code
scans `~/.claude/skills/` on startup.

Updating later: the same `npx degit … --force` command pulls the latest
release. Your login state under `~/.taobao-agent/` is untouched.

## Tarball install (fallback)

For environments without `degit` access or when you've been handed a
`.tar.gz` directly:

```bash
tar -xzf taobao-skill-clean-*.tar.gz
mkdir -p ~/.claude/skills
mv taobao ~/.claude/skills/taobao
```

If you'd rather keep the extracted folder where it is and just register it:

```bash
ln -s "$(pwd)/taobao" ~/.claude/skills/taobao
```

Then restart Claude Code as above.

## After install: let the agent finish setup

Open a new Claude Code session and type something like:

```
set up taobao
```

…or simply ask Claude to search Taobao for anything:

```
search Taobao for ESP32
```

The agent will:

1. Run `./scripts/taobao.sh setup` to verify Node, npm, browser, and the
   symlink. If a browser is missing or quarantined, it will tell you the
   exact command to run (some, like `sudo xattr -dr com.apple.quarantine
   /Applications/Google\ Chrome.app`, need your sudo).
2. Run `./scripts/taobao.sh doctor` to install npm dependencies and
   compile the TypeScript adapter.
3. Run `./scripts/taobao.sh browser-start` to open a dedicated Chrome
   window with a persistent profile. **The agent will pause here** and ask
   you to log into Taobao in that window. Log in once; the session is
   reused on every future call.
4. Run `./scripts/taobao.sh probe-attached` to confirm the login took.
5. Then proceed with the original request.

## What ships in this tarball

- `SKILL.md`, `README.md` — agent and human documentation
- `scripts/taobao.sh`, `scripts/setup.sh` — wrapper and first-time check
- `references/workflow.md`, `references/browsers.md` — agent runbook and
  per-OS browser notes
- `assets/taobao-agent-adapter/` — TypeScript Playwright adapter
  (`src/`, `package.json`, `tsconfig.json`, etc.)

## What does NOT ship (and why)

User-generated state and build artefacts are excluded:

- **Login cookies / browser profile** — would leak the original user's
  Taobao session. You create your own on first `browser-start`.
- **Persisted browser path** — specific to the original machine. Setup
  writes a fresh one for you.
- **`node_modules/`, `dist/`, `npm-cache/`** — built on first run by
  `taobao.sh doctor`.
- **Screenshots and image dumps** from prior sessions.

## Where your runtime data lives

Once you start using the skill, all stateful data lands under
`~/.taobao-agent/` (override with the `TAOBAO_DATA_DIR` env var if you
prefer somewhere else). The skill folder itself stays read-only —
re-extracting a newer tarball over `~/.claude/skills/taobao/` will not
touch your login state, screenshots, or browser config.

```
~/.taobao-agent/
├── config.sh                 # persisted browser path (written by setup)
├── profiles/taobao-chromium/ # your Taobao login cookies live here
├── playwright/               # browser-launch log
└── downloads/
    ├── screenshots/          # full-page PNGs from open-result / open-href
    └── galleries/            # image dumps from download-images
```

To wipe everything (e.g. log out, start clean): `rm -rf ~/.taobao-agent`.
The next `setup` + `browser-start` rebuilds it.

## Troubleshooting

- **"set up taobao" doesn't trigger the skill** → Claude Code likely
  didn't pick up the new skill. Quit and relaunch, then verify
  `ls ~/.claude/skills/taobao/SKILL.md` resolves.
- **`browser-start` says "port did not come up in time"** (macOS) →
  Gatekeeper has quarantined the browser. Run the `sudo xattr -dr
  com.apple.quarantine` command setup printed.
- **Login wall keeps appearing** → Taobao session expired. Run
  `browser-start` again, log in interactively, then `probe-attached`.
- **`npm install` times out fetching from `registry.npmjs.org`** → some
  networks throttle the npm registry. The Yarn mirror carries the same
  packages:

  ```bash
  npm install --registry=https://registry.yarnpkg.com \
    --replace-registry-host=always --no-audit --no-fund
  ```
- **Anything else** → ask Claude. The skill itself is documented well
  enough that the agent can usually self-diagnose from the wrapper output.
