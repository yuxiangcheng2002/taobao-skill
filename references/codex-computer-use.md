# Codex visual verification with Computer Use

Use this workflow only in a Codex desktop runtime that exposes the
`computer-use` skill. The structured adapter remains the primary source. UI
inspection is a corroboration layer for facts that the adapter or its static
screenshot cannot establish reliably.

## Routing rule

Use the cheapest reliable layer in this order:

1. Adapter JSON from `open-href-attached --brief`.
2. The adapter PNG through image input for static packaging, markings, or
   layout claims.
3. Computer Use for facts that require the live rendered UI, such as a value
   visible in the accessibility tree but absent from DOM/SSR extraction.
4. User handoff for login or verification walls.

Do not invoke Computer Use merely because it is available. It is slower and
less deterministic than the adapter. Trigger it when the user explicitly asks
for a visual/UI check, a critical field is absent, `ssrSource` is `dom`, a drift
warning appears, the static screenshot is insufficient, or the adapter and UI
appear to disagree.

## Stage an owned tab

The ordinary adapter actions intentionally create background tabs and close
them when extraction finishes. Computer Use therefore must use the dedicated
staging actions:

```bash
./scripts/taobao.sh visual-open-attached "<exact candidate href>" --brief
./scripts/taobao.sh visual-resume-attached --brief
./scripts/taobao.sh visual-close-attached
```

`visual-open-attached` validates the exact HTTPS product host, retires only an
older tab carrying this workflow's marker, opens the product in the managed
profile, assigns marker `taobao-codex-visual-v1`, brings the tab to the front,
and leaves it open. Its JSON contains:

- `visualInspection.expectedHref` and `expectedItemId`;
- `visualInspection.observedUrl` and `observedTitle`;
- adapter detail fields and screenshot evidence;
- a one-attempt `resume` hint when a login or verification wall intervenes.

Never navigate with Computer Use to create this state. The adapter's exact-host
validator and managed CDP profile are the ownership boundary.

## Computer Use procedure

1. Run the normal setup and browser ownership checks, then stage the known
   product href with `visual-open-attached --brief`.
2. If the result is a wall, follow the handoff procedure below. Do not inspect
   or click the challenge with Computer Use.
3. Identify the configured Chromium app from the setup/doctor report. Follow
   the installed `computer-use` skill: request a fresh app state, prefer the
   accessibility tree, and use the screenshot only when AX is incomplete.
4. Before any scroll or other UI action, compare the frontmost page title and
   visible product identity with `observedTitle`, `expectedHref`, and
   `expectedItemId`. If the target is ambiguous, perform no UI action, close
   the marked tab, and report `ownership-failed`.
5. Read only the fields needed for the user's question. In this initial slice,
   Computer Use may inspect and scroll. It must not click SKU selectors, forms,
   links, seller controls, account controls, or purchase controls.
6. Fetch a fresh app state after every scroll. Never reuse stale element
   indexes.
7. Compare normalized UI values with adapter values and report discrepancies;
   do not silently replace one source with the other.
8. Close the staged tab with `visual-close-attached` after evidence collection,
   unless the user is actively clearing a wall in it.

Read-only Computer Use does not need confirmation. The Taobao skill remains
stricter than the generic Computer Use policy: it never uses UI automation to
add to cart, buy, check out, pay, message a seller, change an address, or alter
account state.

## Wall handoff and one-shot resume

When `requiresUserAction: true`:

1. Surface `state`, `url`, `screenshotPath`, and the `resume` hint once.
2. Tell the user that the managed Taobao window is frontmost and ask them to
   clear the login/verification challenge themselves.
3. Pause. Do not solve CAPTCHA, drag a slider, type credentials, or retry.
4. Only after the user explicitly says the wall is cleared, run
   `visual-resume-attached --brief` once. This observes the marked tab without
   re-navigation, preserving the original href.
5. If the resumed result still has `requiresUserAction: true`, its
   `attemptsRemaining` is zero. Stop and report `blocked`; do not loop.

After a successful resume, continue the read-only verification and then close
the marked tab.

## Verification report

Use this compact structure in the user-visible answer:

```text
Visual verification: match | mismatch | insufficient | blocked | ownership-failed
Target: <exact href or item id>
Field checks:
- name: adapter=<value> | UI=<value> | match=<yes/no/unknown> | source=<AX/screenshot>
- price: ...
- shop: ...
Mismatches: <explicit list or none>
Evidence: <adapter screenshot path; whether a fresh Computer Use state was read>
Limits: <hidden or ambiguous fields>
```

Normalize whitespace, currency symbols, and thousands separators before
comparison, but do not collapse a price range into a single price. Return
`match` only when at least two relevant fields are comparable and none
conflict. Any critical conflict is `mismatch`; fewer than two comparable fields
is `insufficient`.

## Optional live UI E2E

Run this only after the deterministic `verify` gate and the ordinary read-only
`e2e-live` health check. Use one retained exact href, stage it, and corroborate
name, price, and shop through a fresh Computer Use state.

Pass criteria:

- the staged marker reports one owned tab and the expected item id;
- the frontmost UI identity agrees with the staged metadata;
- at least two of name, price, and shop are visible and agree after
  normalization;
- zero forbidden clicks or text-entry actions occur;
- the marked tab is closed at the end;
- wall outcomes are `blocked`, not `pass` or adapter failure.

Keep adapter JSON, PNG evidence, the normalized field comparison, and the tool
trace. Do not persist cookies, raw account text, addresses, tokens, or an
unredacted full AX dump.
