# taobao-agent-adapter

TypeScript Playwright adapter bundled inside the `taobao` skill. Not meant
to be used standalone — invoke it through the skill wrapper.

For end-to-end documentation (architecture, setup, action reference,
response shapes, design decisions, limitations) see the canonical README
one level up:

→ [`../../README.md`](../../README.md)

For agent-runtime guidance (when to call which action, structured-field
docs, SSR fallback behaviour) see:

→ [`../../references/workflow.md`](../../references/workflow.md)

## Local development

```bash
cd assets/taobao-agent-adapter
npm install        # installed automatically by the wrapper on first run
npm run build      # tsc -p tsconfig.json
npm test           # 21 unit tests
npm run smoke:doctor   # JSON env summary
```

The skill wrapper (`scripts/taobao.sh`) handles `cd` and `npm run` for
you when calling actions through the skill — direct `npm run` is only
needed when iterating on the TypeScript itself.

Pointing the skill at an out-of-tree checkout: set `TAOBAO_PROJECT_DIR`
to the path of your working copy.
