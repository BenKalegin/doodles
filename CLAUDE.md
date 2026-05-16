# CLAUDE.md

Guidance for Claude Code when working in the doodles repository.

## Commands

```bash
pnpm build            # build all packages
pnpm typecheck        # tsc --noEmit across the workspace
pnpm test             # vitest run (single pass)
pnpm test:watch       # vitest watch mode
```

Run a single test file:
```bash
pnpm vitest run packages/doodles-svg/test/golden/golden.test.ts
```

## Code Style & Architecture

- **No long methods.** Break functions longer than ~30 lines into smaller, well-named private helpers.
- **DRY.** Extract repeated logic into shared helpers immediately — never duplicate more than two lines.
- **SOLID principles.** SRP (one responsibility per file/class/function), OCP (data-driven dispatch over if/else chains), LSP, ISP (small focused interfaces), DIP (depend on abstractions, inject dependencies).
- **Typecheck must pass.** Run `pnpm typecheck` after every change.
- **No magic numbers.** Every numeric literal must be a named constant. Exceptions: `0`, `1`, `-1`, and simple arithmetic identities.
- **No magic strings.** Same rule for string literals that represent enum-like values. Use the paired const + type pattern below.
- **No fallbacks.** No backward-compatibility shims, no degraded-mode code paths. If a feature requires a capability, fail loudly rather than silently falling back.

## Constants & Enums — Domain Co-location

- **No catch-all files.** Never create `constants.ts` or `enums.ts` barrel files. Each constant and enum lives in the module that owns its domain concept.
- **Co-locate with the owner.** A constant used by one file belongs in that file (unexported). A constant shared within one domain belongs in the module defining the concept.
- **Enum const objects over raw strings.** Always use the `const` object member — never the raw string literal. This enables rename-safe refactors and compile-time exhaustiveness checks.
- **Paired const + type pattern.** Every enum-like value uses:
  ```ts
  export const Foo = { Bar: "bar", Baz: "baz" } as const;
  export type Foo = (typeof Foo)[keyof typeof Foo];
  ```
  Compare with `value === Foo.Bar`, not `value === "bar"`.

## Commit Rules

- **Never commit or push unless explicitly asked.** Wait for the user to review and request.
- **Commit messages: one line.** Single concise line; second line only when genuinely necessary, with no blank separator and no trailers (no `Co-Authored-By`, no "Generated with…").

## Release

This repo is published via the shared `release-all` skill (see `.claude/skills/release-all/`). The skill auto-detects unreleased commits and propagates version bumps through filigree → doodles → clouddiagram → axonize.
