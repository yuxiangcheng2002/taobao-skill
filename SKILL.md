---
name: taobao
description: Use the Taobao agent adapter project to navigate Taobao through a persistent Chromium profile, attached remote-debugging browser, Playwright state detection, structured search results, and product-detail extraction. Use when a user asks to search Taobao, inspect products, compare vendors, open the Nth result, attach to the dedicated Taobao browser, or continue work inside the taobao-agent-adapter project.
---

# taobao

Use the bundled Taobao adapter project inside this skill by default.

- Bundled project: `assets/taobao-agent-adapter`
- Override project root with `TAOBAO_PROJECT_DIR` when you want to use an external checkout
- Dedicated profile: `~/.taobao-agent/profiles/taobao-chromium` (override with `TAOBAO_DATA_DIR`)
- Preferred browser workflow: attached Chromium on port `9222`
- Wrapper: `scripts/taobao.sh <action> [args...]` — run `taobao.sh help` for the full action list
- Cross-platform: the wrapper and `remote-browser.sh` auto-detect a Chromium-family browser on macOS, Linux, and Windows (Git Bash / WSL). Set `CHROMIUM_PATH` only if auto-detection fails.

## On activation

1. Read `references/workflow.md`.
2. **If `$TAOBAO_DATA_DIR/PREFERENCES.md` exists** (default
   `~/.taobao-agent/PREFERENCES.md`), read it. It carries this user's
   personal preferences for the taobao skill — trusted vendors, shipping
   defaults, browser handling preferences, anything specific to them
   that should not ship in the skill itself. Apply its guidance for the
   rest of the session. The file is optional; absence just means no
   personalization yet.
3. **On the very first invocation in a session, run `./scripts/taobao.sh setup`
   before anything else.** Do not jump straight to `browser-status`, `search`,
   or any other action. The setup report takes ~1s, reveals misconfiguration
   (missing browser, broken symlink, Gatekeeper quarantine on macOS) that other
   actions would hit as opaque failures, and is the difference between a
   smooth flow and a multi-round diagnostic detour. Treat "already set up"
   only as evidence from the setup report itself, not as an assumption.
4. Use `scripts/taobao.sh` for all actions (doctor, probe, search, open-result,
   browser-*). The wrapper `cd`s into the project dir and delegates to
   `npm run` scripts.
5. Work in the project dir, not in this skill folder.

## Community sentiment cross-check

Taobao metrics measure fulfilment, not product quality. When the user asks
"which should I buy" and the answer hinges on how well the product performs
(materials, tools, brand-differentiated commodity goods), read
`references/community-check.md` and
cross-check candidate brands against Chinese community sources — Bilibili
review-video comment sections first (`scripts/bilibili-comments.sh <BV-id>`
pulls them without login; locate videos via WebSearch `site:bilibili.com`,
not the wbi-signed search API). Zhihu zhuanlan praise pieces are usually
soft ads — weigh them as zero. If community evidence contradicts the
listing-data ranking, revise the recommendation explicitly rather than
blending the two.

Exception: globally-standardized professional parts (ICs, sensors, MCUs,
passives) are judged by datasheet compliance and authenticity, not Chinese
community sentiment — skip the sweep, rely on `suspectClone` + screenshot
verification, and offer the user a generic professional search (datasheets,
errata, international forums) instead. Details in the reference.

**Two-phase delivery (default when the check is warranted):** don't make
the user wait on the community sweep. As soon as the Taobao search/detail
data is in hand: (1) launch a background subagent (Agent tool,
`run_in_background: true`) carrying the community-check playbook for the
shortlisted brands, then (2) immediately present the candidate table to the
user, with the ranking explicitly marked as **preliminary — listing data
only, community verdict pending**. When the subagent's notification
arrives, deliver the verdict as a follow-up: confirm or revise the ranking,
and say which (if any) preliminary picks the community evidence killed.
Never present the preliminary ranking as final, and don't hold the table
back waiting for the sweep. See "Running the check as a background
subagent" in `references/community-check.md` for the subagent prompt
template.

## Initial setup

If this is the user's first time using the skill on this machine — or they say
something like "set up taobao", "it's broken, start over", "first time on this
Mac", "I just installed this skill" — walk through the setup phase before
running any real command. Do not assume it has been done; run the check.

**Recipients of the bundled tarball** have already done the bootstrap
(extract, place under `~/.claude/skills/`, restart Claude Code) by hand
following `INSTALL.md`. Their first agent interaction usually starts with
"set up taobao" or a direct request like "search Taobao for X". In either
case, run the Automatic sequence below before doing real work — the skill
folder may be in place while `npm install`, the browser pick, and login
still need to happen.

**Execute the commands yourself via the shell. Do not paste checklists for the
user to copy and run.** The user only needs to act in two situations:

- Something is genuinely missing (Node, browser, symlink) and installing it
  requires their permissions or a system action.
- `browser-start` has opened the dedicated Chrome window and they need to log
  into Taobao once.

Everything else — running the wrapper, reading output, chaining to the next
step — is your job.

### Automatic sequence

1. **Run `./scripts/taobao.sh setup`.** The report is safe to re-run. When
   invoked on a TTY it also shows a numbered browser menu; you (the agent)
   will usually not have a TTY, so read the candidate list in the "Browser"
   section of the report and pick one explicitly with
   `./scripts/taobao.sh setup --browser <path>`. Prefer an already-trusted
   Chrome / Edge / Brave over a `[quarantined]` candidate. The list also
   includes Chromium binaries cached by terminal tools or Node projects
   (Playwright, Puppeteer, Chrome for Testing) — these are labelled
   `Chromium (Playwright cache)` or similar and are usually an excellent
   choice: already downloaded, not Gatekeeper-quarantined, isolated from
   daily browsing. If a tool installs Chromium somewhere exotic, expose it
   via the `TAOBAO_EXTRA_BROWSERS` env var (colon-separated paths) before
   running setup. The selection is persisted to `~/.taobao-agent/config.sh`
   (or `$TAOBAO_DATA_DIR/config.sh`) and picked up by every subsequent
   wrapper call — you do not need to re-export `CHROMIUM_PATH`. See
   `references/browsers.md` for a per-browser cheat sheet.

2. **If the report had any `[fail]` line, stop and resolve it before
   continuing.** Typical fixes — propose the exact command, run it if it is
   safe and local, otherwise ask the user:
   - **node/npm missing** → ask the user to install Node.js 22+ (macOS:
     `brew install node`; Linux: distro package; Windows: nodejs.org). This
     needs their action, not yours.
   - **No Chromium-family browser found** → ask them to install Chrome,
     Chromium, Edge, or Brave. If a browser is installed at a non-standard
     path, set `CHROMIUM_PATH` and re-run setup. Example for macOS:
     `export CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'`
   - **Skill not installed at `~/.claude/skills/taobao`** → create the
     symlink yourself:
     `ln -s <current-skill-dir> ~/.claude/skills/taobao`. This is the
     standard my-skills install pattern; prefer symlink over copy so repo
     updates propagate. Do not ask the user to copy-paste it.

3. **Run `./scripts/taobao.sh doctor`.** This triggers the first
   `npm install`, builds TypeScript, and prints a JSON environment summary.
   Verify `platform`, `arch`, and `chromiumExecutablePath` look correct and
   move on. Only stop to ask the user if something looks wrong.

4. **If the setup report said the profile had no session data, run
   `./scripts/taobao.sh browser-start` yourself.** Then — and only then —
   stop and tell the user: "I've opened a dedicated Chrome window. Please log
   into Taobao in that window, then tell me when you're done. Leave the
   window open." Wait for their confirmation. Do not ask them to run
   `browser-start`; you run it, they just log in.

5. **Run `./scripts/taobao.sh probe-attached`.** A healthy result means setup
   is complete and the skill is ready for real queries. Report success in one
   sentence and then proceed to whatever the user originally asked for
   (`search-attached`, `open-result-attached`, etc.).

After initial setup succeeds, subsequent sessions should skip steps 1 and 4
unless the environment visibly changes (new machine, new OS, missing browser).
When skipped, you still own execution — go straight to `probe-attached` or the
user's actual request.

## macOS browser notes

These rules exist because a past session lost ~20 minutes to a Gatekeeper
quarantine trap. Save future-you the detour.

- **Prefer whatever Chrome-family browser is already trusted on the machine.**
  If setup auto-detects Google Chrome, Edge, or Brave, use it. Do not install
  a second browser just to match the user's unrelated aesthetic preference.
- **Do not suggest `brew install --cask chromium` on macOS.** The cask is
  deprecated (slated for removal) and ships an unsigned build. macOS tags it
  with `com.apple.quarantine`, which causes `--remote-debugging-port` to
  silently fail to bind — the script will report "port did not come up in
  time" with no obvious cause. If the user explicitly asks for Chromium and
  nothing else, warn them about the quarantine step first:
  `sudo xattr -dr com.apple.quarantine /Applications/Chromium.app` (needs
  sudo because `/Applications` is system-owned).
- **Arc is Chromium-based but unreliable for remote debugging.** Do not add it
  to `CHROMIUM_PATH`. If the user says "I use Arc", explain that `browser-start`
  opens its own dedicated window regardless of what they browse with daily,
  and recommend pointing it at Chrome/Edge/Brave instead.
- **If `browser-start` fails with "port did not come up in time" on macOS,
  assume quarantine first.** `remote-browser.sh` now checks for it and prints
  the exact `sudo xattr` command; follow that before diagnosing anything else.

## Rules

- Prefer the attached-browser workflow when possible.
- Treat the dedicated Taobao Chromium profile as persistent state.
- Do not rely on brittle CSS selectors when network/state-based methods are available.
- If a live browser is required, keep the user's dedicated browser open until the attached action finishes.
- When evolving the adapter, run tests or smoke commands before claiming success.
- If search quality is weak, iteratively tighten the query before giving up: strip filler words, keep core product nouns/specs, try short Chinese synonyms, and only then broaden again.
- Keep skill documentation and implementation notes in English. If bilingual support is needed, apply it to user-visible output rather than the skill files themselves.
- Match user-visible output to the calling agent or user's language preferences rather than assuming Chinese. For Taobao work, still preserve Chinese product names, vendor names, and search keywords when they improve search quality or make results easier to verify.
