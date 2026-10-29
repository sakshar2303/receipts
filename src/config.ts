import { z } from "zod";
import { CLAIM_TYPES } from "./types.js";

/**
 * Everything a project may want to tune. Defaults live here; `receipts.config.json`
 * can override any key. Patterns are regular expression sources matched against
 * one normalised command segment ("npm run test", not "cd app && npm test | tail").
 */
export const ConfigSchema = z
  .object({
    commands: z
      .object({
        test: z.array(z.string()),
        build: z.array(z.string()),
        typecheck: z.array(z.string()),
        lint: z.array(z.string()),
        /** Scripts that run several checks at once, such as "npm run check". */
        composite: z.array(z.string()),
      })
      .strict(),
    testFiles: z.array(z.string()),
    /** Edits to these files never make a test or build claim stale. */
    docFiles: z.array(z.string()),
    manifests: z.array(z.string()),
    claimTypes: z.partialRecord(z.enum(CLAIM_TYPES), z.boolean()),
  })
  .strict();

export type Config = z.infer<typeof ConfigSchema>;

const PM = String.raw`(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?`;

export const DEFAULT_CONFIG: Config = {
  commands: {
    test: [
      String.raw`^${PM}test(?::[\w:-]+)?\b`,
      String.raw`^(?:vitest|jest|mocha|ava|tap|jasmine|karma)\b`,
      String.raw`^(?:python3?\s+-m\s+)?pytest\b`,
      String.raw`^python3?\s+-m\s+unittest\b`,
      String.raw`^go\s+test\b`,
      String.raw`^cargo\s+(?:test|nextest)\b`,
      String.raw`^(?:playwright|cypress\s+run)\b`,
      String.raw`^(?:deno|bun)\s+test\b`,
      String.raw`^node\s+--test\b`,
      String.raw`^(?:rspec|phpunit|mvn\s+test|gradle\s+test|\./gradlew\s+test|dotnet\s+test)\b`,
    ],
    build: [
      String.raw`^${PM}build(?::[\w:-]+)?\b`,
      String.raw`^(?:vite|next|nuxt|astro|remix)\s+build\b`,
      String.raw`^(?:tsup|webpack|rollup|esbuild|parcel\s+build)\b`,
      String.raw`^tsc\s+(?:-b|--build)\b`,
      String.raw`^(?:cargo|go|dotnet|gradle|\./gradlew)\s+build\b`,
      String.raw`^(?:make|mvn\s+(?:package|install|compile))\b`,
    ],
    typecheck: [
      String.raw`^${PM}(?:typecheck|type-check|check-types|types|tsc)\b`,
      String.raw`^(?:tsc|vue-tsc)(?!\s+(?:-b|--build)\b)\b`,
      String.raw`^(?:mypy|pyright|basedpyright)\b`,
      String.raw`^cargo\s+check\b`,
    ],
    lint: [
      String.raw`^${PM}(?:lint|eslint)(?::[\w:-]+)?\b`,
      String.raw`^(?:eslint|biome\s+(?:check|lint)|oxlint|stylelint)\b`,
      String.raw`^ruff\s+check\b|^ruff$`,
      String.raw`^(?:flake8|pylint|golangci-lint|rubocop)\b`,
      String.raw`^cargo\s+clippy\b`,
      String.raw`^prettier\s+.*--check\b`,
    ],
    composite: [String.raw`^${PM}(?:check|ci|verify|validate|precommit|pre-commit)\b`],
  },
  testFiles: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/*_test.go",
    "**/test_*.py",
    "**/*_test.py",
  ],
  docFiles: [
    "**/*.md",
    "**/*.mdx",
    "**/*.txt",
    "**/*.rst",
    "docs/**",
    "**/LICENSE*",
    "**/CHANGELOG*",
  ],
  manifests: [
    "**/package.json",
    "**/requirements*.txt",
    "**/pyproject.toml",
    "**/Cargo.toml",
    "**/go.mod",
    "**/Gemfile",
    "**/composer.json",
  ],
  claimTypes: {},
};
