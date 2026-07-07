# Taobao Skill Workflow

## Project paths
- Bundled project root: `assets/taobao-agent-adapter` (resolved relative to this skill directory)
- Override project root with `TAOBAO_PROJECT_DIR` when you want an external checkout
- **Read-only installs** (e.g. Codex copies skills into `~/.codex/skills`
  unwritable to normal tool calls): the wrapper mirrors the adapter sources
  to `$TAOBAO_DATA_DIR/runtime/taobao-agent-adapter`, building and running
  there. Re-synced on every invocation (~1s when warm; `node_modules`/`dist`
  are preserved). Two triggers: a copied (non-symlink) install under the
  Codex skills dir is ALWAYS mirrored — writability is not a stable signal
  there, since escalated-permission runs can pass a write probe and would
  pollute the bundle — and any other install falls back to a write probe.
  The stderr line `Skill bundle treated as read-only; using runtime adapter
  copy at …` tells you which mode you're in. An explicit
  `TAOBAO_PROJECT_DIR` always wins and skips the mirror; symlinked dev
  checkouts build in place as before.
- User data dir: `~/.taobao-agent/` (overridable via `TAOBAO_DATA_DIR`) — holds:
  - `config.sh` — persisted browser path
  - `profiles/taobao-chromium/` — Chrome login profile
  - `playwright/` — `remote-browser.sh` launch log
  - `downloads/screenshots/`, `downloads/galleries/` — generated artefacts
- Attached browser port: `9222`

## Default command wrapper
Invoke the wrapper from inside the installed skill directory:

```bash
./scripts/taobao.sh <action> [args...]
```

Typical absolute paths depending on how the skill was installed:

```bash
# Claude Code (macOS, Linux, Windows via Git Bash / WSL)
~/.claude/skills/taobao/scripts/taobao.sh <action> [args...]

# Codex
"${CODEX_HOME:-$HOME/.codex}/skills/taobao/scripts/taobao.sh" <action> [args...]
```

The wrapper auto-detects its own location, runs `npm install` the first time
it needs `node_modules`, and then delegates to `npm run` scripts inside the
bundled adapter project.

## Browser executable
`scripts/taobao.sh browser-start` launches a dedicated Chromium-family browser
via `assets/taobao-agent-adapter/scripts/remote-browser.sh`. That script tries,
in order:

1. `CHROMIUM_PATH` environment variable, if set
2. A platform-specific candidate list covering macOS, Linux, and Windows
   (`Google Chrome`, `Chromium`, `Microsoft Edge`, `Brave Browser`, etc.)

If no browser is found, set `CHROMIUM_PATH` explicitly. For example on macOS:

```bash
export CHROMIUM_PATH='/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
```

## Common actions
### First-time setup
```bash
taobao.sh setup                         # report + interactive browser menu (TTY)
taobao.sh setup --browser /path/to/bin  # persist a browser non-interactively
taobao.sh setup --clear-browser         # forget the persisted choice
taobao.sh setup --non-interactive       # report only, no menu
taobao.sh setup --help
```

`setup` is safe to re-run. On a TTY it lists all Chromium-family browsers
found on the machine and prompts for a numbered selection; non-interactively
it just lists them and expects `--browser` on a follow-up call. The chosen
browser is persisted to `~/.taobao-agent/config.sh` (or
`$TAOBAO_DATA_DIR/config.sh`) and sourced by `scripts/taobao.sh` on every
invocation, so subsequent commands do not need `CHROMIUM_PATH` in the
environment.

If the skill folder still has a pre-2026-05 `.taobao-config.sh` /
`.profiles/` / `.playwright/` / `downloads/` from a prior install, `setup`
migrates them to the new data dir on first run — login state is
preserved, only file locations change.

Address any `[fail]` line before running real commands. See `SKILL.md`
"Initial setup" for the full walkthrough and `references/browsers.md` for
per-browser install/trust notes.

### Environment / project checks
```bash
taobao.sh install
taobao.sh doctor
taobao.sh test
taobao.sh browser-status
```

### Attached-browser workflow
```bash
taobao.sh browser-start
taobao.sh browser-status
taobao.sh probe-attached
taobao.sh search-attached "esp32"
taobao.sh open-result-attached "esp32" 1
taobao.sh open-href-attached "https://item.taobao.com/item.htm?id=..."
taobao.sh download-images-attached "esp32" 1
taobao.sh browser-stop
```

### Non-attached workflow
```bash
taobao.sh probe
taobao.sh search "esp32"
taobao.sh open-result "esp32" 1
taobao.sh open-href "https://item.taobao.com/item.htm?id=..."
taobao.sh download-images "esp32" 1
```

### Index stability — when to use `open-href` over `open-result`
`open-result` re-runs the search and picks the candidate at the given 1-based
index. Taobao re-ranks results between calls (ad slots, personalization,
A/B buckets), so the index can drift to a different listing than the one the
agent originally saw. When the candidate's href is already known from a prior
`search` call, prefer `open-href` — it bypasses search entirely and goes
straight to the listing. Pass the `href` field from the search-result
candidate verbatim.

## Attached actions are sequential — never run them concurrently
All `*-attached` actions drive the same CDP browser and navigate its tabs.
Two attached commands in flight at once (e.g. `probe-attached` and
`search-attached` in parallel) navigate over each other and fail with
`ERR_ABORTED`. Run them one after another; each returns in seconds, so
there is nothing to gain from parallelizing anyway.

## Preferred operating mode
Use the attached-browser workflow when:
- the user is already logged in
- a persistent session matters
- you need access to the real live browser state

## What currently works
- `probe`
- `probe-attached`
- `search`
- `open-result`
- `open-href` (direct-open by URL — index-stable)
- `download-images`
- structured candidate extraction from search results
- product-detail opening and basic detail extraction
- thumbnail extraction from search results when present
- detail image gallery extraction and optional local download
- attached browser reuse via CDP

## Structured fields on search candidates
Each entry in `candidates[]` exposes these fields in addition to the obvious
`title` / `price` / `sales` / `rawText`:

- `platform`: `"taobao" | "tmall" | "tmall-flagship"` — derived from href host
  and shop-name suffix. `tmall-flagship` is the highest trust tier (assurance
  programs like 假一赔四 apply, official-brand presence is strict).
- `previouslyBought`: `true` when the rawText contains `买过的店` or
  `我买过的宝贝`. Reflects the logged-in user's purchase history with this
  shop — a strong personalized trust signal.
- `shopAgeYears`: integer pulled from `X年老店` markers (e.g. `13年老店 → 13`).
- `tags`: array of promo / fulfilment / guarantee labels — `包邮`, `可开发票`,
  `对公支付`, `假一赔四`, `退货宝`, `公益宝贝`, `次日达`, `24小时内发`,
  `48小时内发`, `券后价`, `免运费`. Use these as filter or scoring inputs
  rather than re-parsing rawText.
- `location` is now a province/SAR whitelist match — no longer accidentally
  eats price-modifier tokens like `券后价`.
- `suspectClone` / `suspectReason`: flagged when the title carries a known
  domestic-clone vendor suffix (`-HXY` for 华轩阳, `-CMSEMICON`, `-CXSC`)
  or a marketing-keyword telltale (`替代品`, `平替`, `国产替代`, `国产化`).
  When `suspectClone` is true, treat the listing as a second-source part —
  not 1:1 register-compatible with the original brand.

## Structured fields on product detail (`open-result` / `open-href`)
On top of `name` / `price` / `shop` / `imageUrls` / `rawTextPreview`, detail
responses now also expose:

- `productImageUrls`: a curated subset of `imageUrls` — strips small UI
  chrome (under 200×200 px) and shop-banner images, prefers `item_pic`
  URLs. Use this when you only want 3–5 images to verify packaging or
  silkscreen.
- `priceTiers`: best-effort staircase pricing pulled from rendered text
  (`{qty, price}` pairs). Often empty — Tmall ladder pricing usually lives
  in the SKU panel or mtop API, neither of which we currently parse.
- `moq`: best-effort 起订量 / 起订数 extraction. Same caveat as
  `priceTiers` — only fires when the value leaks into the visible body.
- `shop` extraction now blacklists UI-chrome strings like `收藏的店铺` and
  `免费开店` and falls back to a head-of-rawText scan when the anchor
  selector misses the real shop name.

## SSR-injected detail data (`__ICE_APP_CONTEXT__`)

`open-result` and `open-href` first try to read the SSR data the page rendered
from, at `window.__ICE_APP_CONTEXT__.loaderData.home.data.res`. Both
`detail.tmall.com` and `item.taobao.com` listings expose this on the current
`tbpc_detail_2025` build, so primary fields are typically authoritative
rather than DOM-scraped:

- `price` / `priceTitle` — from `componentsVO.priceVO.price`
- `shop` / `shopId` / `sellerId` — from `seller`
- `sellerEvaluates` — three-row scorecard (宝贝描述 / 卖家服务 / 物流服务) from
  `seller.evaluates`. Reliable shop-trust signal beyond `shopAgeYears`.
- `sales` — from `item.vagueSellCount` (cumulative, not just 30-day)
- `quantity` / `quantityText` — actual stock count from `skuCore.sku2info`
- `productImageUrls` — from `item.images` when available, falls back to
  DOM-scraped image set otherwise
- `ssrSource` flags `"ice-context"` when these came from SSR data,
  `"dom"` when the page didn't expose the structure (older builds, future
  drift) and the response is built from DOM scraping.

If Taobao bumps the SSR layout, every ICE field returns undefined and the
DOM extractor takes over silently. This is the right failure mode — a
missing field beats a wrong one.

When this happens on a known detail-host URL (`detail.tmall.com` or
`item.taobao.com`), the adapter pushes
`ICE_CONTEXT_PATH_DRIFT_SUSPECTED: …` into `detail.warnings`. Surface
that warning to the caller so they don't silently trust the
weaker-fidelity DOM-scraped fields. The fix when this fires: rerun the
SSR exploration probes (see git history of `parseIceContextDetail`),
update the cherrypicked subtrees in `readIceContextRaw`, refresh the
`src/test/fixtures/ice-context-detail.json` snapshot, and confirm the
unit tests still pass.

The corresponding search-side API tap is intentionally not implemented:
search results are already SSR-rendered into the HTML and read via
`collectAnchorCandidates`, and search-result index drift is solved by
`open-href` rather than re-routing through the mtop search API (which
would require client-side sign computation against a moving signature).

## Screenshots and verification walls

- `open-result` and `open-href` capture a full-page PNG by default and return
  the path in `detail.screenshotPath`. Read the PNG with the multimodal Read
  tool to verify package, silkscreen, batch markings, and other visual
  attributes that text extraction misses (e.g. `LSM6DSV` should show V3 top
  mark, `ICM-42688-P` should show I428P / 1428P — `HXY` clones look
  visibly different).
- Pass `--no-screenshot` when you only need text fields and want to avoid
  the ~0.5–1.5 MB PNG write per call.
- Screenshots land under `~/.taobao-agent/downloads/screenshots/` with a
  slugified label (`open-href-…png`, `open-result-<query>-<n>-…png`).
  Override the data dir with `TAOBAO_DATA_DIR`.
- When a Taobao verification or login wall intercepts a request, the
  response sets `requiresUserAction: true`, captures a screenshot of the
  wall (so the agent can see slider CAPTCHA / login form), and returns
  early with empty candidates — do not retry blindly. Surface the
  screenshot to the user and pause until they have cleared the challenge.

## Current limitations
- detail extraction is still heuristic, not perfect
- detail-page `shop` and `price` can pick up unrelated UI text (e.g. left-nav
  buttons like `收藏的店铺`); search-results `shop` is more reliable
- no full SKU / shipping / attribute parser yet
- anti-bot / CAPTCHA handling is intentionally manual-first
- `LOCATION_WHITELIST` is province/SAR-level; city-only listings (rare) are
  not extracted

## Large JSON output — avoid terminal truncation
`search` / `search-attached` responses include a verbose `networkTap` array
that can push the JSON past the tool-output limit, truncating the
`candidates` you actually need. Pass `--brief` to drop the tap at the
source (works on `search`, `open-result`, `open-href` and their `-attached`
variants):

```bash
taobao.sh search-attached "<query>" --brief
```

Omit `--brief` only when diagnosing walls/session issues — the tap is where
`SESSION_EXPIRED` and CAPTCHA redirects show up.

For searches you intend to re-rank or reuse, still redirect to a scratchpad
file: it preserves `href`s for later `open-href` calls (index-stable) and
avoids re-searching:

```bash
taobao.sh search-attached "<query>" --brief > q.raw 2>&1
sed -n '/^{/,$p' q.raw > q.json   # strip npm banner lines before the JSON
```

## Login detection
`loggedInLikely` is backed by a signed mtop `getUserSimple` call made from
the page (authoritative — reports the live session, not the remembered
`tracknick` cookie). It falls back to the old text+cookie heuristic only
when the mtop probe is inconclusive (non-taobao origin, missing `_m_h5_tk`
token, CORS drift). A `probe-attached` reporting `loggedInLikely: false`
means the user really must re-login in the dedicated window.

## Community sentiment cross-check
Listing metrics measure fulfilment, not product quality. For
quality-sensitive "which should I buy" questions, cross-check brands against
Chinese community sources (Bilibili comment sections via
`scripts/bilibili-comments.sh`, independent roundups; Zhihu zhuanlan praise
= soft ad). Full playbook: `references/community-check.md`.

## Search query refinement rule
- Start with the shortest product-defining query that should work on Taobao.
- Preserve meaningful specs/materials/model names.
- Remove filler like “best”, “cheap”, “high quality”, or full-sentence phrasing.
- If results are noisy, try concise Chinese synonyms before adding more English descriptors.
- Prefer Chinese product nouns, vendor terms, and marketplace wording in actual Taobao queries; use English model names/specs as supplements, not replacements.
- In user-facing summaries, match the recipient's preferred language, but keep original Chinese titles, shop names, or key search terms whenever they help verification or re-search.
- Only broaden the query after at least one tighter attempt fails.

## Notes
- If `browser-status` says remote debugging is down, run `browser-start` (or ask the user to, if your environment can't launch GUIs).
- If a command requires a live browser, do not ask the user to close it until the action finishes.
- This skill bundles the adapter project for portability; update the bundled copy when adapter behavior changes.
- Use `TAOBAO_PROJECT_DIR` only when you intentionally want to point at an external checkout.
