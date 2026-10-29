# Decisions

Short records of choices that are not obvious from the code.

## Runtime dependencies

The budget is fewer than 10. Each entry says why it earns its place.

| Package   | Why                                                                            |
| --------- | ------------------------------------------------------------------------------ |
| commander | Subcommands, typed options and generated `--help` without hand-rolled parsing. |

Planned for later milestones: `zod` (config and LLM output validation), `picocolors`
(terminal colour that respects `NO_COLOR`), `picomatch` (glob matching for sensitive paths
and test files).

Deliberately left out:

- `dotenv`: Node 22 ships `process.loadEnvFile()`.
- `openai` SDK: Ollama, Groq and OpenRouter all speak the same chat-completions HTTP shape,
  so plain `fetch` with a small typed wrapper is enough.

## Node version

Node 22.13 or newer. `node:sqlite` is unflagged from 22.13, which lets Receipts read
OpenCode-format databases without native modules. It still prints an experimental warning
on some versions; the SQLite reader will suppress that one warning so terminal output
stays clean.

## TypeScript 6, not 7

TypeScript 7 (the native compiler) is out, but `typescript-eslint` supports
`typescript < 6.1`. We pin `~6.0` so type-aware linting works, and will move when the
linter supports 7.

## Build: tsup, bundled into one file

`tsup` produces a single `dist/receipts.js` with every dependency inlined, so a
`npx github:` install has nothing extra to resolve at run time. `node:` imports stay
external. The package builds itself through `prepare`, so installing from GitHub works
without committing `dist/`. tsup is in maintenance mode; it is stable and sufficient here.

## Exit code 2 for usage errors

Commander exits with 1 on a parse error, but 1 means "a claim matched `--fail-on`". The
entry point maps every Commander error to 2 so hooks never mistake a typo for a failing
receipt.
