# Contributing

Thanks for helping. Receipts is small on purpose; changes that keep it that way are the
easiest to accept.

## Setup

Node 22.13 or later.

```bash
npm install
npm run check
```

`npm run check` runs the typecheck, ESLint and Prettier, the build, every test and a smoke
test of the built CLI. It must pass before a pull request is merged, and CI runs it on Node
22 and 24.

## Rules for changes

- **Verdicts stay deterministic.** A model may help find claims, never decide them. A
  behaviour claim is always `needs-review`.
- **No real transcripts in the repository.** Tests and fixtures are written by hand. Real
  sessions can hold code, paths and secrets.
- **A new claim pattern comes with a test** in `test/extract/patterns.test.ts`, and a case in
  `eval/fixtures/` if it changes a verdict. Run `npm run eval` and include the before and
  after numbers in the pull request.
- **A new checker or flag** needs a unit test for every verdict it can return, an entry in
  `docs/verdicts.md` or `docs/flags.md`, and text for `receipts explain`.
- **The built CLI is committed.** After changing `src/`, run `npm run build` and commit
  `dist/receipts.js` with your change. CI fails if it is out of date.
- **No new runtime dependency** without a line in `docs/decisions.md` saying why it earns
  its place.
- Commit messages follow Conventional Commits (`feat(check): …`, `fix(extract): …`).

## Layout

| Path          | What is there                                           |
| ------------- | ------------------------------------------------------- |
| `src/ingest`  | Claude Code and OpenCode readers, discovery, turns      |
| `src/diff`    | Git and patch change sets, the edit timeline            |
| `src/extract` | Claim extraction: patterns, the optional model, merge   |
| `src/check`   | One checker per claim type, command and outcome parsing |
| `src/flags`   | Risk detectors and secret redaction                     |
| `src/report`  | Terminal, Markdown, JSON schema and the HTML report     |
| `eval/`       | Hand-written eval cases, scoring and the labelling tool |
| `scripts/`    | Smoke test and the README screenshots                   |
