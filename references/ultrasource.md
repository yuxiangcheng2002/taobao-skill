# Ultrasource: read-only Xianyu sourcing

Use this submode to search and inspect public Xianyu listings through the
official Goofish web surface. It is intentionally nested inside the Taobao
skill because both workflows share the same managed Chromium profile and
Alibaba login state.

## Activation contract

Activate this submode only when the original user prompt contains the exact,
case-sensitive, standalone token `Ultrasource`.

- Match: `Ultrasource find a used Keyence sensor`
- Match: `请用 Ultrasource，找 MGN12 拆机导轨`
- No match: `ultrasource`, `ULTRASOURCE`, `UltraSource`, `UltrasourceX`
- No match: a Xianyu/闲鱼 request that omits `Ultrasource`

The model-level rule is backed by the command gate. Every Xianyu action must go
through:

```bash
./scripts/ultrasource.sh Ultrasource <action> [args...]
```

The wrapper rejects a missing or near-match token before dependency, browser,
CDP, or network work. Do not set `ULTRASOURCE_TRIGGER` manually or call the
compiled Xianyu CLI directly.

If the user mentions Xianyu without the exact token, do not browse it. Briefly
say that the gated mode requires `Ultrasource`.

## Trusted web boundary

Xianyu's current public website is `goofish.com`. The adapter creates search
URLs itself at `https://www.goofish.com/search?q=...`. Direct listing input is
accepted only when URL parsing yields all of the following:

- protocol `https:`
- exact host `www.goofish.com`
- path `/item`
- numeric `id`
- no userinfo, non-default port, suffix host, or lookalike subdomain

The adapter canonicalizes accepted listing URLs and drops tracking parameters.
Do not broaden this to arbitrary `*.goofish.com`, `2.taobao.com`, mobile deep
links, URL shorteners, or third-party buying-agent sites without a fresh,
documented trust review.

Official basis:

- Alibaba describes Xianyu as its consumer community and second-hand market.
- Xianyu's current service agreement defines the service as including the
  `goofish.com` website and says unauthenticated users may use basic browsing
  and search.

## Live workflow

Before the first live action, follow the parent skill's setup check and read
`$TAOBAO_DATA_DIR/PREFERENCES.md` when it exists.

1. Search with a concise Chinese query:

   ```bash
   ./scripts/ultrasource.sh Ultrasource search 'KEYENCE LK-G5001 控制器' --brief
   ```

2. Review structured candidates. Treat every listing as a lead, not verified
   inventory or proof of authenticity. Prefer exact model matches, actual-item
   photos, concrete condition/provenance, useful seller-history signals, and a
   plausible price over generic popularity.

3. Refine a noisy search in a bounded sequence: exact model; model plus Chinese
   item noun; remove filler; add a relevant condition such as `拆机`, `库存`, or
   `故障` only when the user wants it. Preserve useful false positives as
   alternate leads rather than silently changing the target.

4. Open a returned canonical href, never an index from a re-run search:

   ```bash
   ./scripts/ultrasource.sh Ultrasource open-href \
     'https://www.goofish.com/item?id=1068945084433' --brief
   ```

5. Compare visible condition, seller history, wants/views, location, included
   parts, stated defects, screenshots, and risk signals. Do not equate a seller
   badge or `百分百好评` with authenticity.

6. If the page becomes `login-wall` or `verification-wall`, show its screenshot
   once and pause. Do not retry, solve a CAPTCHA, or route around the wall.

For an optional real-site health check, run the sequential read-only suite:

```bash
./scripts/ultrasource.sh Ultrasource e2e-live
```

It records `pass`, `fail`, or `blocked` separately and never turns a wall into
a successful result. The deterministic parent `verify` suite remains the
release gate; live ranking and inventory are too unstable to gate a release.

## Sourcing judgment

Prioritize evidence that is unusually valuable on a C2C market:

- exact model and revision, quantity, included accessories, and visible labels
- actual-item photos versus catalog/stock images
- explicit defects, repairs, missing parts, rust, locked state, or test status
- seller age, sold-count, location, refresh recency, and category consistency
- whether the price is per part, deposit, repair fee, digital file, or bundle
- whether the same seller appears to hold commercial inventory rather than a
  one-off personal item

Surface adapter risk signals explicitly:

- `digital-or-nonphysical`
- `no-returns`
- `off-platform-payment`
- `counterfeit-language`
- `account-or-credential`
- `stolen-goods-language`
- `weak-provenance`

These are triage flags, not proof. Read the listing before drawing a conclusion.

## Safety and state boundary

This mode is read-only. It may search, inspect public listing pages, take
screenshots, and report links. It must not click or invoke `聊一聊`, `我想要`,
`立即购买`, favorites, follows, offers, publishing, cart, checkout, payment,
address, account, or location controls.

Do not help source goods or services whose requested purpose is illegal or
rights-violating, including stolen property, credentials/accounts/identity
documents, payment instruments, controlled drugs or weapons, malware access,
or covert surveillance intended to violate privacy. For ambiguous dual-use
electronics or legitimate surplus lab/industrial equipment, do not presume
misconduct: search the lawful item and state any concrete listing risk.

## Report format

Lead with a compact candidate table:

| # | Listing | Price | Location | Seller signal | Risk | Link |
|---|---|---:|---|---|---|---|

Then give:

1. strongest leads and why;
2. missing facts that prevent confidence;
3. scam/authenticity/provenance flags;
4. one bounded next search or inspection action, if useful.

Never describe the result as a purchase recommendation without separating
listing claims from independently verified facts.
