---
name: taobao
description: >-
  Search and inspect Taobao/Tmall listings in read-only mode through a
  persistent Chromium profile. Use for 淘宝/Tmall product searches, listing
  URLs, vendor comparisons, product-detail or screenshot checks, opening a
  numbered result, purchase recommendations, or maintenance of the bundled
  taobao-agent-adapter. Cross-check community evidence only when product
  quality is experiential and the purchase stakes justify it. Also expose a
  read-only Xianyu/Goofish sourcing submode only when the original prompt
  contains the exact, case-sensitive, standalone token Ultrasource; without
  that token, never access Xianyu. Do not place orders, message sellers, or
  modify marketplace state.
---

# taobao

Use the bundled Taobao adapter project inside this skill by default.

- Bundled project: `assets/taobao-agent-adapter`
- Override project root with `TAOBAO_PROJECT_DIR` when you want to use an external checkout
- Dedicated profile: `~/.taobao-agent/profiles/taobao-chromium` (override with `TAOBAO_DATA_DIR`)
- Preferred browser workflow: attached Chromium on port `9222`
- Wrapper: `scripts/taobao.sh <action> [args...]` — run `taobao.sh help` for the full action list
- Cross-platform: auto-detection covers macOS, native Linux, and Windows Git
  Bash. WSL supports only a native Linux Chromium (normally through WSLg), not
  Windows-host Chrome. Set `CHROMIUM_PATH` when auto-detection fails.

## On activation

1. If the original prompt contains the exact standalone token `Ultrasource`,
   read `references/ultrasource.md` and use only its Xianyu submode. Otherwise,
   read `references/workflow.md` and follow the ordinary Taobao/Tmall flow.
2. **For live searches or recommendations where personalization matters, if
   `$TAOBAO_DATA_DIR/PREFERENCES.md` exists** (default
   `~/.taobao-agent/PREFERENCES.md`), read it. It carries this user's
   personal preferences for the taobao skill — trusted vendors, shipping
   defaults, browser handling preferences, anything specific to them
   that should not ship in the skill itself. Apply its guidance for the
   rest of the session. The file is optional; absence just means no
   personalization yet.
   Do not read this private file for code review, documentation, tests, or
   other adapter-maintenance tasks.
3. **Before the first live adapter/browser action in a session, run
   `./scripts/taobao.sh setup`.** Documentation, code review, and deterministic
   `test`/`verify` work do not require setup or access to user state. For live
   work this is a per-session check, not a one-time install
   step: the report takes ~1s and reveals misconfiguration (missing browser,
   broken symlink, Gatekeeper quarantine on macOS) that other actions would
   hit as opaque failures. If the report is clean, proceed straight to the
   user's request; only when it flags a failure do you run the full setup
   flow (browser pick, login) under "Initial setup" below. Treat "already
   set up" only as evidence from the setup report itself, not as an
   assumption.
4. Use `scripts/taobao.sh` for ordinary actions (doctor, probe, search,
   open-result, browser-*). For Xianyu use only
   `scripts/ultrasource.sh Ultrasource ...`; its exact-token gate must run
   before any Xianyu action. The wrappers `cd` into the project dir and
   delegate to `npm run` scripts.
5. For adapter maintenance, work in `assets/taobao-agent-adapter`; keep skill
   instructions and evaluation artifacts in their documented locations.
6. When Codex Computer Use is requested or a live UI field needs corroboration,
   read `references/codex-computer-use.md` and follow the installed
   `computer-use` skill. Keep the adapter first; Computer Use is a bounded
   verification sidecar, not the navigation driver.

## Safety boundary

- The adapter is read-only: search, inspect, screenshot, and download public
  listing images only.
- Never add to cart, place an order, initiate checkout/payment, message a
  seller, or change account/profile state.
- Accept direct product navigation only on exact HTTPS hosts
  `item.taobao.com` and `detail.tmall.com`. Never weaken this boundary to a
  substring match.
- Treat `login-wall` and `verification-wall` as user-action outcomes. Surface
  the screenshot once and pause; do not retry or attempt to bypass a challenge.
- Computer Use remains read-only under this skill. It may inspect and scroll an
  adapter-staged tab, but it may not click SKU, form, seller, account, cart, or
  purchase controls.
- Xianyu is a separately gated read-only surface. Accept direct listing input
  only on exact HTTPS host `www.goofish.com`, path `/item`, with a numeric `id`.
  Never click `聊一聊`, `我想要`, `立即购买`, favorites, follows, offers, or
  publishing controls. See `references/ultrasource.md` for sourcing and refusal
  boundaries.

## Codex visual verification

For an explicit visual/UI check, a missing critical field, `ssrSource: "dom"`,
or an SSR-drift warning, use the Codex sidecar in
`references/codex-computer-use.md`:

1. Open the retained exact href with `visual-open-attached --brief`. This
   validates the product URL, marks one owned tab, brings it forward, and leaves
   it open for Computer Use.
2. Verify the frontmost page identity against the returned expected href/item
   id before any UI action.
3. Read accessibility state first, screenshot second; inspect and scroll only.
4. Report adapter/UI matches and mismatches explicitly, then run
   `visual-close-attached`.

If a wall appears, the staged tab is already ready for user handoff. After the
user says it is cleared, run `visual-resume-attached --brief` exactly once; it
re-reads the same marked tab without navigation. A second wall is `blocked` and
ends the attempt.

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
data is in hand: (1) launch a background subagent (on Claude Code: the
Agent tool with `run_in_background: true`; on runtimes without a
background-subagent mechanism, run the sweep synchronously after step 2)
carrying the community-check playbook for the
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

**Users who installed via degit or the bundled tarball** have already done
the bootstrap (fetch or extract, place under the skills directory, restart
the agent) following `INSTALL.md`. Their first agent interaction usually starts with
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
   - **Skill not installed at the expected skills path** → create the
     symlink yourself:
     `ln -s <current-skill-dir> ~/.claude/skills/taobao` (Claude Code) or
     `ln -s <current-skill-dir> "$HOME/.agents/skills/taobao"`
     (Codex). This is the standard my-skills install pattern; prefer symlink
     over copy so repo updates propagate. Do not ask the user to copy-paste it.

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

After initial setup succeeds, subsequent sessions still run the quick `setup`
report per On-activation step 3 — it is a per-session check. What they skip is
the rest of this flow: the browser pick (step 1's `--browser` selection) and
login (step 4) happen again only when the report flags a failure. On a clean
report you still own execution — go straight to `probe-attached` or the user's
actual request.

## macOS browser notes

These rules exist because a past session lost ~20 minutes to a Gatekeeper
quarantine trap. Save future-you the detour.

- **Prefer whatever Chrome-family browser is already trusted on the machine.**
  If setup auto-detects Google Chrome, Edge, or Brave, use it. Do not install
  a second browser just to match the user's unrelated aesthetic preference.
- **If `browser-start` fails with "port did not come up in time" on macOS,
  assume quarantine first.** `remote-browser.sh` now checks for it and prints
  the exact `sudo xattr` command; follow that before diagnosing anything else.

Per-browser install/trust details, including why brew-cask Chromium and Arc
are traps, live in `references/browsers.md`.

## Rules

- Prefer the attached-browser workflow when possible.
- Run `*-attached` actions strictly sequentially — they share one CDP
  browser; concurrent attached calls navigate over each other and fail
  with `ERR_ABORTED`.
- Treat the dedicated Taobao Chromium profile as persistent state.
- Do not rely on brittle CSS selectors when network/state-based methods are available.
- If a live browser is required, keep the user's dedicated browser open until the attached action finishes.
- When evolving the adapter, run tests or smoke commands before claiming success.
- Before release, run `./scripts/taobao.sh verify`. For a real-site health
  check, start the managed browser and run `./scripts/taobao.sh e2e-live`.
  Interpret live status as `pass`, `fail`, `blocked`, or `drift`; never call a
  CAPTCHA-blocked or SSR-drifted run a pass. See `references/evaluation.md`.
- If search quality is weak, iteratively tighten the query before giving up: strip filler words, keep core product nouns/specs, try short Chinese synonyms, and only then broaden again.
- Keep skill documentation and implementation notes in English. If bilingual support is needed, apply it to user-visible output rather than the skill files themselves.
- Match user-visible output to the calling agent or user's language preferences rather than assuming Chinese. For Taobao work, still preserve Chinese product names, vendor names, and search keywords when they improve search quality or make results easier to verify.
