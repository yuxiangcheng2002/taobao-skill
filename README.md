# taobao

Agent-friendly Taobao adapter. Search, inspect, and extract structured product
data from `s.taobao.com` / `item.taobao.com` / `detail.tmall.com` through a
persistent, logged-in Chromium profile — without writing or maintaining
brittle CSS selectors.

This is a Claude Code skill. It bundles a TypeScript Playwright adapter,
exposes it through a thin shell wrapper, and ships first-time setup,
attached-browser workflow, and structured responses agents can score and
filter without re-parsing raw text.

## When to use it

Reach for this skill when you need to:

- **Source electronic components** by part number — see live offers,
  shop reputation, prices, available stock, and verify package /
  silkscreen via screenshots before committing.
- **Compare vendors** for the same SKU across price, shop credibility,
  delivery, and counterfeit risk.
- **Inspect a specific listing** by URL — open it, pull structured price
  / shop / SKU / image data, and persist a full-page screenshot.
- **Triage Chinese-clone parts** — the adapter flags listings whose
  titles carry domestic-clone vendor suffixes (e.g. `-HXY`, `-CMSEMICON`)
  or marketing tells (`平替`, `国产替代`, `替代品`).

It is *not* a scraping framework, an anti-bot toolkit, or a synchronous
storefront API. CAPTCHA / verification walls are handled by surfacing
them to the user — never by automated solving.

## Quick start

Install the skill (one command via [`degit`](https://github.com/Rich-Harris/degit)):

```bash
mkdir -p ~/.claude/skills
npx -y degit yuxiangcheng2002/taobao-skill ~/.claude/skills/taobao
```

Restart Claude Code so it registers the new skill. From any session, ask
Claude something like "set up taobao" or "search Taobao for ESP32" and
the agent will:

1. Run `./scripts/taobao.sh setup` (verifies Node, npm, browser, Gatekeeper).
2. Run `./scripts/taobao.sh browser-start` — pauses to ask you to log
   into Taobao in the dedicated window once.
3. Run `./scripts/taobao.sh probe-attached` to confirm the session is live.
4. Proceed with whatever you actually asked for.

For full install details (including offline / tarball fallback) see
[`INSTALL.md`](INSTALL.md). For per-OS browser-trust quirks see
[`references/browsers.md`](references/browsers.md). For the agent's
runtime guidance see [`SKILL.md`](SKILL.md) and
[`references/workflow.md`](references/workflow.md).

## Architecture

The skill folder holds **only code and documentation** — read-only,
re-extractable, replaceable. All user-generated state (login cookies,
screenshots, browser config) lives under `~/.taobao-agent/`, isolated
from the skill.

```
~/.claude/skills/taobao/                  (the skill — code + docs only)
├── SKILL.md                              # Skill manifest — agent-facing summary
├── README.md                             # This file
├── INSTALL.md                            # Bootstrap steps for tarball recipients
├── scripts/
│   ├── taobao.sh                         # Wrapper: cd into adapter, run npm scripts
│   └── setup.sh                          # First-time environment / browser picker
├── references/
│   ├── workflow.md                       # Agent runbook (actions, fields, fallbacks)
│   └── browsers.md                       # Per-OS install / trust notes
└── assets/taobao-agent-adapter/          # Bundled TypeScript adapter
    ├── src/
    │   ├── cli.ts                        # CLI entrypoint
    │   └── taobao/
    │       ├── adapter.ts                # search / openResult / openByHref / downloadImages
    │       ├── browser.ts                # CDP attach + persistent-context launch
    │       ├── parser.ts                 # Search-candidate field extraction + clone detection
    │       ├── network.ts                # Best-effort response capture
    │       ├── state.ts                  # Page-state inference (home / search / detail / wall)
    │       ├── config.ts                 # Resolves project root, data dir, browser path
    │       └── types.ts                  # Shared response shapes
    └── scripts/remote-browser.sh         # Start / stop / status the dedicated Chromium window

~/.taobao-agent/                          (user data — survives skill re-installs)
├── config.sh                             # Persisted CHROMIUM_PATH (written by setup)
├── profiles/taobao-chromium/             # Persistent browser profile — login lives here
├── playwright/                           # remote-browser.sh launch log
└── downloads/
    ├── screenshots/                      # PNGs from open-result / open-href
    └── galleries/                        # image dumps from download-images
```

The skill side stays thin: the wrapper, setup, references. All adapter
logic — Playwright, CDP, parsers — sits inside
`assets/taobao-agent-adapter/`. `TAOBAO_PROJECT_DIR` lets you point at an
external checkout when iterating on the adapter; `TAOBAO_DATA_DIR`
overrides where user state lives.

## Setup

The skill uses a **dedicated Chromium profile** so a manual login persists
across sessions. The first-time path is:

1. **`./scripts/taobao.sh setup`** — checks Node ≥ 22, npm, curl, the
   skill symlink, the bundled adapter, and a Chromium-family browser.
   Auto-discovers Chrome / Edge / Brave / cached Playwright Chromium and
   persists the choice in `.taobao-config.sh`. Re-runnable.
2. **macOS quarantine handling** — Chrome / Edge / Brave installed via
   Homebrew cask are tagged with `com.apple.quarantine`, which silently
   prevents `--remote-debugging-port` from binding. Setup detects this
   and prints the exact `sudo xattr -dr com.apple.quarantine …` command;
   run it once.
3. **`./scripts/taobao.sh doctor`** — first build (`tsc`) + an
   environment-summary JSON (platform, paths, headless flag, profile
   exists?).
4. **`./scripts/taobao.sh browser-start`** — launches the dedicated
   Chromium window with `--remote-debugging-port=9222` and the persistent
   profile under `assets/taobao-agent-adapter/.profiles/taobao-chromium/`.
   Log into Taobao in this window. Leave it open.
5. **`./scripts/taobao.sh probe-attached`** — confirms the adapter can
   attach to port 9222 and that `loggedInLikely: true`.

After step 5 the skill is ready. Subsequent sessions skip 1 and 4 unless
the profile loses its session.

## Action reference

All actions go through `./scripts/taobao.sh <action> [args...]`. The
canonical command reference (with full code-block examples and per-action
caveats) lives in [`references/workflow.md`](references/workflow.md);
the table below is the at-a-glance index.

| Action | Purpose |
|---|---|
| `setup` | First-time check / browser picker (TTY menu or `--browser <path>`) |
| `doctor` | Build + JSON env summary |
| `test` | Run the unit tests under `src/test/` |
| `browser-start` / `-status` / `-stop` | Lifecycle of the dedicated Chromium |
| `probe` / `probe-attached` | Visit `taobao.com` and report state + login |
| `search` / `search-attached <query>` | Search and return up to 10 structured candidates |
| `open-result` / `-attached <query> <index>` | Re-search and open the Nth candidate |
| `open-href` / `-attached <url>` | Open a specific URL (index-stable, preferred) |
| `download-images` / `-attached <query> <index>` | Save the listing's gallery to `downloads/` |

The `*-attached` variants reuse the persistent logged-in profile via CDP.
Non-attached variants spin up a fresh persistent context for one-off use.

### `search` response

The canonical schema — including fallback behaviour and recent-change
notes — is in [`references/workflow.md`](references/workflow.md#structured-fields-on-search-candidates).
The summary below shows the field set at-a-glance. Each entry in
`candidates[]`:

| Field | Source | Notes |
|---|---|---|
| `index`, `title`, `href` | DOM anchor | Stable handle for `open-href` |
| `price`, `sales`, `location` | rawText regex | Province whitelist for `location` |
| `shop` | rawText | Skips UI-chrome blacklist (`收藏的店铺`, `免费开店`, …) |
| `platform` | href + shop suffix | `taobao` / `tmall` / `tmall-flagship` |
| `previouslyBought` | rawText | True when listing carries `买过的店` / `我买过的宝贝` |
| `shopAgeYears` | rawText | Integer from `X年老店` |
| `tags` | rawText | `包邮`, `可开发票`, `对公支付`, `假一赔四`, `退货宝`, `公益宝贝`, `次日达`, `24小时内发`, `48小时内发`, `券后价`, `免运费` |
| `suspectClone` / `suspectReason` | title | Clone-vendor suffix (`-HXY`, `-CMSEMICON`) or marketing keyword |
| `thumbnailUrl` | DOM img | Search-result thumbnail |
| `rawText` | Full source string | For agents that want their own parsing |

Top-level: `state`, `url`, `loggedInLikely`, `candidateCount`, `networkTap`,
plus `screenshotPath` + `requiresUserAction:true` when a CAPTCHA / login
wall intercepts the request.

### `open-result` / `open-href` response

Full schema (including SSR-vs-DOM fallback rules and the
`ICE_CONTEXT_PATH_DRIFT_SUSPECTED` warning condition) is in
[`references/workflow.md`](references/workflow.md#ssr-injected-detail-data-__ice_app_context__).
`detail` carries:

| Field | Primary source | Notes |
|---|---|---|
| `price`, `priceTitle` | `componentsVO.priceVO.price` (SSR) | DOM regex fallback |
| `shop`, `shopId`, `sellerId` | `seller` (SSR) | DOM blacklist + head fallback |
| `sellerEvaluates` | `seller.evaluates` (SSR) | Three-row scorecard: 宝贝描述 / 卖家服务 / 物流服务 |
| `sales` | `item.vagueSellCount` (SSR) | Cumulative, not 30-day |
| `quantity`, `quantityText` | `skuCore.sku2info["0"]` (SSR) | Live stock count + display string |
| `productImageUrls` | `item.images` ∩ chrome-filter | Up to 5 curated, primary `item_pic` |
| `imageUrls` | DOM `<img>` scan | Full set; `productImageUrls` is the curated subset |
| `priceTiers`, `moq` | rendered text | Best-effort, often empty |
| `screenshotPath` | Playwright | Full-page PNG under `downloads/screenshots/` |
| `ssrSource` | Adapter | `"ice-context"` when SSR data drove primary fields, else `"dom"` |
| `warnings` | Adapter | Non-fatal advisories — currently `ICE_CONTEXT_PATH_DRIFT_SUSPECTED` when a detail-host URL fell back to DOM scraping (signals Taobao SSR drift) |
| `requiresUserAction` | state inference | True when verification / login wall intercepted |
| `rawTextPreview` | `body.innerText()` | First 1200 chars, for ad-hoc parsing |

Pass `--no-screenshot` to skip the PNG when only structured fields are
needed (saves ~0.5–1.5 MB per call).

`picked` mirrors the search-candidate shape so callers can treat
`open-href` and `open-result` symmetrically.

## Worked example: sourcing an IC

Suppose you want a TDK ICM-42688-P bare IC. Search:

```bash
./scripts/taobao.sh search-attached "ICM-42688-P"
```

A typical result set will surface several distinct buying patterns the
structured fields make explicit:

- A **Tmall flagship** listing — `platform: 'tmall-flagship'`,
  `tags` typically include `假一赔四`, `退货宝`, sometimes `可开发票`.
  Highest platform-guarantee tier; the right pick when you need
  invoicing or counterfeit-indemnity coverage. Prices run ~30–60%
  above the cheapest item.taobao stalls.
- An **item.taobao.com** listing with `previouslyBought: true` — Taobao
  has tagged the shop as one you've bought from before. Lower price
  than the flagship, real personalized trust signal.
- A **clone** listing — `suspectClone: true`, `suspectReason:
  'suffix:-HXY'`. The `-HXY` suffix is the 华轩阳 domestic clone of
  TDK's ICM IMUs (LGA-14 package vs TDK's QFN-14, ¥7–12 vs ¥30+).
  Register-similar but drift / noise / temperature behaviour are not
  1:1. Treat as a second-source part, not a drop-in.

Open a candidate and verify visually:

```bash
./scripts/taobao.sh open-href-attached "<href from search candidate>"
```

The detail response will carry `price`, `shop`, `quantity`,
`sellerEvaluates` (a three-row scorecard from
`seller.evaluates` — 宝贝描述 / 卖家服务 / 物流服务), and a
full-page `screenshotPath`. Read the PNG to confirm the package and
silkscreen match the TDK datasheet (`I428P` / `1428P` on QFN-14) — for
ICs this visual check is the difference between trusting the listing
and not.

Vendor-specific trust calls (which Tmall flagships are best for ST,
which item.taobao stalls have given you good batches before) belong in
`~/.taobao-agent/PREFERENCES.md` — outside the skill, per-user.

## Design decisions worth knowing

- **User state lives under `~/.taobao-agent/`, not in the skill folder** —
  login cookies, screenshots, image dumps, and the persisted browser
  path all sit outside the skill so the skill itself is read-only and
  re-extractable. Override the location with `TAOBAO_DATA_DIR`. Setup
  auto-migrates from the pre-2026-05 in-skill layout if it finds
  legacy paths on first run.
- **Persistent logged-in profile over re-login** — Taobao session
  cookies live in `~/.taobao-agent/profiles/taobao-chromium/`. Re-login
  only when the setup report flags the profile as missing session data.
- **Attached-browser via CDP, not headless** — keeps the user logged in,
  avoids triggering Taobao's headless-detection, and makes
  CAPTCHA / verification visually obvious.
- **`open-href` over `open-result`** — search results re-rank between
  calls (ad slots, personalization). The candidate's `href` is stable;
  the candidate's index is not. Use `open-href` whenever you already
  have a target URL.
- **SSR `__ICE_APP_CONTEXT__` over DOM scraping** — Taobao's 2025
  detail pages embed canonical product data at
  `loaderData.home.data.res`. Reading from there gives the same data
  the page rendered from. DOM scraping remains as a fallback when the
  shape changes.
- **Structured search-candidate fields over rawText** — agents can
  filter / score by `platform`, `previouslyBought`, `shopAgeYears`,
  `suspectClone`, `tags` directly. `rawText` stays as the source of
  truth for unrecognized signals.
- **Background tab creation via raw CDP** — `context.newPage()` would
  bring Chrome to the macOS foreground on every action, stealing focus.
  The adapter issues `Target.createTarget({background: true})` through
  a browser-level CDP session and picks the resulting page up via the
  context's `page` event.
- **Verification walls short-circuit** — when state is `verification-wall`
  or `login-wall`, the adapter returns early with
  `requiresUserAction: true` and a screenshot of the wall, instead of
  spinning on selectors that will never resolve.
- **Best-effort over fragile certainty** — `priceTiers` and `moq` only
  fire when the values leak into the visible rendered text; they're
  documented as best-effort. SKU panels and the mtop detail API are
  out of scope.

## Limitations

- **Mtop search-API tap is not implemented.** Search results are
  SSR-rendered into the HTML (already covered by the existing
  parser); calling the mtop search API directly would require
  client-side `sign` computation against a moving signature, with
  little payoff over `search` + `open-href`.
- **`priceTiers` / `moq`** rarely appear in the rendered body; tier
  pricing usually lives in the SKU panel behind a click and is not
  scraped.
- **Detail-page `shop` extraction** is two-stage: anchor blacklist
  then head-of-rawText scan. New UI-chrome strings can sneak past
  if Taobao adds them — extend `SHOP_NAME_BLACKLIST` in
  `parser.ts` when you spot a regression.
- **The `__ICE_APP_CONTEXT__` path will drift** with Taobao SSR
  bumps. The fallback to DOM scraping is silent (a missing field
  beats a wrong one), and `ssrSource` flags which path produced
  the data so callers can scope their trust accordingly.
- **City-only listings** (no province) are not extracted into
  `location` — the whitelist is province / SAR-level.

## Development

The bundled adapter:

```bash
cd assets/taobao-agent-adapter
npm install                  # auto-runs on first wrapper invocation
npm run build                # tsc -p tsconfig.json
npm test                     # 21 unit tests covering parser + state
npm run smoke:doctor         # JSON env summary
```

The wrapper handles `cd` and `npm run` for you when called through
`./scripts/taobao.sh`. Edit TypeScript under `src/`; running any
wrapper action triggers a rebuild via `npm run build`.

When adding extraction logic:

- New search-candidate fields → `parser.ts` (`summarizeCandidate`)
  and `types.ts` (`ProductSummary`); add a unit test.
- New detail fields from SSR → `adapter.ts`
  (`extractIceContextDetail`) and `types.ts` (`ProductDetail`).
- New tag / clone keyword → extend `TAG_PATTERNS` /
  `CLONE_KEYWORD_PATTERNS` / `CLONE_SUFFIX_PATTERNS` in `parser.ts`.

Network-traffic debugging: `searchResult.networkTap` and
`openResult.networkTap` carry the most recent ~12–15 captured
responses (Taobao-host JSON / JS / h5api). URLs matching
`/h5/mtop.taobao.detail.getdetail`, `…getdesc`, or `…pcdetail.*`
include their full body (capped at 200 KB) in `fullBody` so
downstream code can parse without re-fetching.

## Cross-references

- [`SKILL.md`](SKILL.md) — agent-facing manifest, setup walkthrough,
  rules, dos / don'ts. Loaded into Claude's context when the skill
  triggers.
- [`references/workflow.md`](references/workflow.md) — runbook with
  the action list, structured-field documentation, and SSR
  extraction notes.
- [`references/browsers.md`](references/browsers.md) — per-OS notes
  on installing and trusting a Chromium-family browser the adapter
  can attach to.
- [`assets/taobao-agent-adapter/README.md`](assets/taobao-agent-adapter/README.md)
  — adapter-project README (older; prefer the docs above for
  current behaviour).
