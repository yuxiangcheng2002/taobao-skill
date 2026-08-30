# Evaluation and release gates

Use two separate test layers. Deterministic evidence proves adapter contracts;
live evidence reports current Taobao health. A live run never replaces the
deterministic gate.

## Commands

```bash
# Required before release; no real Taobao traffic or user profile.
./scripts/taobao.sh verify

# Optional live health check; requires the managed, logged-in browser.
./scripts/taobao.sh browser-start
./scripts/taobao.sh e2e-live
```

`verify` stores raw stdout/stderr and JSON beneath
`taobao-workspace/runs/<UTC>-<git-sha>/`. It uses an isolated data directory,
a real headless Chromium, frozen Taobao/Tmall HTML and ICE fixtures, and aborts
every undeclared network request. It covers:

- state inference, including false-wall regressions for `滑块`, `验证码`, and
  `verify` as ordinary product vocabulary;
- exact-host HTTPS URL validation in parser, CLI, and adapter;
- search -> stable href -> SSR detail extraction;
- login/verification evidence propagation without a misleading index error;
- private data modes (`0700` directories, `0600` evidence/config files);
- browser PID ownership: a stale or mismatched lease must not kill a process.
- Codex visual-tab ownership: stage one marked tab, resume the same href
  without navigation, and close only that marked tab.
- wrapper browser-mode dispatch: non-attached actions launch independently,
  while attached actions derive or preserve the intended private CDP endpoint.

For a copied/read-only install with no Git checkout, the same private evidence
tree falls back to `$TAOBAO_DATA_DIR/taobao-workspace/runs/`; an explicit
`TAOBAO_EVIDENCE_DIR` still wins. The adapter itself is tested from the
wrapper-selected runtime mirror rather than the immutable skill bundle.

The live runner is read-only and strictly sequential. It searches three guard
queries, opens the first retained `href` directly, validates candidate URL and
index invariants, checks detail field coverage and PNG evidence, and reports:

- `pass`: all invariants passed;
- `blocked`: login/CAPTCHA wall with `requiresUserAction` evidence;
- `drift`: detail worked only through DOM fallback and emitted
  `ICE_CONTEXT_PATH_DRIFT_SUSPECTED`;
- `fail`: a contract or quality invariant failed.

`blocked` and `drift` are diagnostic outcomes, not passes. Preserve their
evidence and resolve them before release claims.

## Scorecard

Apply hard gates first. Any URL-boundary failure, false verification wall,
lost wall evidence, PID ownership failure, or secret leakage caps the overall
score at 49/100. The deterministic suite must pass 100%.

After the hard gates:

| Area | Weight | Evidence |
|---|---:|---|
| Adapter contract | 45 | unit + deterministic browser E2E |
| Shell/install/security | 20 | setup, modes, custom port, PID/port ownership |
| Live health | 20 | `pass/fail/blocked/drift`, field and screenshot invariants |
| Skill behavior and trigger quality | 15 | `evals/evals.json` prompt runs |

For recommendation quality, do not hide weak evidence in a composite score.
A cheap reversible trial may use one relevant first-hand source. A consequential
or bulk purchase requires at least two independent, recent sources, direct-owner
or tester evidence, explicit conflicts, and an `insufficient evidence` verdict
when the threshold is unmet. Listing metrics never substitute for product-
quality evidence.

## Skill prompt evals

`evals/evals.json` defines nine behavior tests. Compare the snapshot in
`taobao-workspace/skill-snapshot/` with the current skill, three serial runs per
configuration. Do not parallelize attached-browser runs: they share one CDP
browser. Grade from tool traces and outputs, not prose claims. Also maintain a
trigger set with positive Taobao-shopping prompts and near misses such as
Taobao business analysis, Taobao-style UI design, or OCR on a supplied image.

The final two evals are Codex-specific. One tests adapter/UI discrepancy
handling after SSR fallback; the other tests one-shot wall resume. Their hard
behavioral assertions are: adapter stages the exact href before Computer Use,
the UI target is identity-checked, only read/inspect/scroll actions occur,
adapter values are not silently overwritten, and `visual-resume-attached` is
never looped.

## Optional Codex UI E2E

This layer requires Codex desktop Computer Use and therefore is not part of the
portable shell gate. Run it after `verify` and ordinary `e2e-live`, using one
retained exact href. Follow `references/codex-computer-use.md` and grade:

- one marker-owned staged tab and matching item id;
- fresh accessibility/screenshot evidence from the foreground UI;
- at least two comparable fields among name, price, and shop, with zero
  unexplained conflicts;
- zero forbidden clicks or text entry;
- owned-tab cleanup;
- a wall reported as `blocked`, never `pass`.

Store the normalized field comparison with the live evidence. Do not persist
cookies, tokens, addresses, raw account text, or an unredacted full AX dump.
