# Community sentiment cross-check (Chinese web)

Taobao listing metrics (sales volume, shop rating, seller evaluates) measure
*fulfilment quality*, not *product quality*. A shop can ship a mediocre
product quickly and politely for years and keep a 4.8+ rating. Before
recommending a purchase where quality actually matters (materials,
components, tools — anything the user will judge by performance, not by
unboxing), cross-check candidate brands/products against Chinese community
sources. A canonical failure mode this catches: a 14-year Tmall shop with
70k+ sales whose product a reviewer's professional test model "completely
failed to form" — listing data alone would have ranked it #2.

> **Runtime portability**: tool names in this playbook use Claude Code's
> vocabulary (WebSearch, Agent tool, `run_in_background`). On other
> runtimes (e.g. Codex), substitute whatever web-search tool is available,
> and if there is no background-subagent mechanism, run the check
> synchronously — but still present the preliminary Taobao table *before*
> starting the sweep, so the user isn't blocked on it.

## When to run this

- The user asks "which should I buy" and the answer depends on product
  performance (not just price/logistics).
- Candidates are commodity products with many near-identical listings
  (filament, tools, sensors, power supplies) where brand reputation is the
  main differentiator.
- Skip when the purchase is trivially reversible, purely logistical, or the
  user already named the exact product.
- **Skip for globally-standardized professional parts** — ICs, sensors,
  MCUs, modules, passives, and similar spec-sheet-defined components.
  Their performance is set by the datasheet and global reputation, not by
  Chinese community sentiment; a Bilibili sweep adds almost nothing beyond
  clone/counterfeit signal, which the search layer already provides
  (`suspectClone`, silkscreen screenshot verification). For these, do NOT
  run the Chinese sweep by default. Instead, invite the user to supply
  context (known-good part numbers, prior usage, application constraints)
  or ask whether they want a **generic professional search** instead —
  datasheets, manufacturer errata, EEVblog / Reddit / international forum
  reports — via ordinary WebSearch, outside this playbook.

The dividing line is *who defines quality*: brand-differentiated commodity
goods (filament, tools, power supplies, printed/consumer products) are
judged by user experience → Chinese community check applies; standardized
engineering parts are judged by spec compliance and authenticity → clone
detection + professional sources apply.

## Source map — what works, what doesn't

### Bilibili comment sections (best signal, fully scriptable)

Comment sections under review/横评 videos are the richest source: owners
report long-term outcomes, UP主 replies carry extra weight (they tested),
and "提名X" (nominations) surface dark-horse brands no review covered.

Working API recipe (no login needed as of 2026-07):

```bash
# 1. Resolve BV-id -> aid
curl -s "https://api.bilibili.com/x/web-interface/view?bvid=BV1xxxxxxx" \
  -H "User-Agent: Mozilla/5.0"          # -> .data.aid  (also .title, .stat.view)
# code 62012 => video went private; move on.

# 2. Top comments + nested replies (mode=3 = by like count)
curl -s "https://api.bilibili.com/x/v2/reply/main?type=1&oid=<aid>&mode=3" \
  -H "User-Agent: Mozilla/5.0" -H "Referer: https://www.bilibili.com"
# -> .data.replies[]: .like, .content.message, .replies[] (nested)
```

Or use the bundled helper which does both steps and prints a compact digest:

```bash
./scripts/bilibili-comments.sh BV1xxxxxxx
```

**Finding the videos**: the Bilibili search API
(`x/web-interface/wbi/search/type`) requires wbi signing — do NOT burn time
on it. Locate videos with WebSearch instead:
`<brand/product> 评测 site:bilibili.com`, `<category> 横评 site:bilibili.com`.
Then pull comments via the API above.

### Zhihu

- `zhuanlan.zhihu.com` articles return 403 to unauthenticated fetches.
  Usually the WebSearch snippet/summary is all you get — often enough.
- **Trust heuristic**: a zhuanlan article that reads as pure praise for one
  brand ("强韧抗冲的X线材", feature-list prose, no measurements, no
  competitors) is almost certainly a soft ad (软文). Treat as
  vendor-published marketing, not community signal. Independent Zhihu
  answers under 问题 pages are more trustworthy than zhuanlan posts.

### Other sources

- `smzdm.com` (什么值得买): good buying guides but fetches are flaky
  (ECONNREFUSED seen). Try once, don't retry hard.
- Independent blog roundups (口碑汇总 posts) are useful secondary
  confirmation; weigh them below first-hand comments.
- `tieba.baidu.com`: searchable via `site:` queries; fetch reliability
  varies.
- Taobao 问大家 / review sections: already partially visible in
  `open-href` rawText — quote real buyer reviews when present.

## Weighing the evidence

1. **First-hand long-term reports beat everything** ("用了一年还能打" /
   "第二年就砸头上").
2. **UP主 replies in their own comment section** — they ran the tests;
   a one-line verdict there can outweigh the video itself.
3. **Repeated independent nominations** of the same brand across unrelated
   threads = strong positive (dark-horse detector).
4. **Cross-source agreement**: one B站 comment + one independent roundup
   saying the same thing is worth more than either alone.
5. **Soft-ad discount**: vendor-tone zhuanlan/SEO articles count as zero.
6. **Recency matters**: a 2023 verdict on a brand may predate a product-line
   overhaul; prefer comments from the last ~18 months when they conflict.

## Running the check as a background subagent

The sweep costs minutes (WebSearch rounds + comment pulls); the Taobao
table is ready in seconds. Default flow when the check is warranted:

1. Finish the Taobao search / detail pulls and settle a shortlist.
2. **Launch the subagent first** (Agent tool, general-purpose,
   `run_in_background: true`), **then** present the candidate table to the
   user marked "preliminary — community verdict pending". Launching first
   means the sweep runs while the user reads.
3. On the subagent's completion notification, post the follow-up: confirmed
   picks, killed picks (with the quote that killed them), dark-horse brands
   the community nominated that the search never surfaced.

Subagent prompt template — fill the bracketed parts, keep the rest:

> Research Chinese community sentiment for these <category> brands:
> <brand list with prices/listing stats>. The buyer's use case: <one
> line>. Method: (a) locate review/横评 videos via WebSearch
> `<brand> 评测 site:bilibili.com` and `<category> 横评 site:bilibili.com`;
> (b) pull comment sections with
> `~/.claude/skills/taobao/scripts/bilibili-comments.sh <BV-id>` —
> UP主 replies and long-term owner reports carry the most weight;
> (c) check independent roundups (口碑汇总). Treat zhuanlan.zhihu.com
> praise articles as soft ads (zero weight). Do NOT attempt the Bilibili
> wbi search API. Return: per-brand verdict (recommend / avoid /
> insufficient data) with the load-bearing Chinese quote and source URL
> for each, plus any dark-horse brand repeatedly nominated in comments.

Scale the sweep to stakes: one video's comments for a cheap trial
purchase; multi-source (2–3 videos + roundups) when the user will buy in
quantity or build on the result.

## Reporting back

- When community evidence contradicts an earlier listing-data
  recommendation, say so explicitly and revise the ranking — don't quietly
  blend the two.
- Attribute claims: "UP主 replied that…", "a commenter who owned both
  said…" — the user should be able to judge the source's weight.
- Link every video/article cited so the user can verify.
- Keep original Chinese quotes for load-bearing verdicts; they are easier
  to re-find and harder to distort in translation.
