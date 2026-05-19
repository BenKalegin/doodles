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

## Test-first is mandatory for layout work

Doodles' job is producing correct layouts; the DSL-based golden tests are the source of truth, not visual inspection. **Never** fix a layout bug by eyeballing the rendered SVG and iterating on code. The order is always:

1. **Reproduce in a test first.** Add a **`.mmd` fixture** under `packages/doodles-svg/test/golden/fixtures/` that reproduces the failing layout, **with anonymized labels** (see below), and add a describe block in `golden.test.ts` with DSL assertions (`.noOverlap()`, `.noNodeIntersection()`, `.noLabelOverlap()`, `.leftOf()`, `.centeredOver()`, etc.) that **fail** on the current code. Run the test and confirm it's red.
2. **Make the test green.** Change the layout code until the test passes. Don't rebuild downstream consumers (clouddiagram, axonize) or open the rendered SVG to verify — the test is the verification.
3. **Keep the test.** The new test stays as a permanent regression check.
4. **Render the example SVG.** `node scripts/render-rule-example.mjs <fixture-name>` extracts the rendered SVG from the golden snapshot and writes `docs/layout-rules/images/<fixture>.svg`. Commit it.
5. **Document the rule.** Add or update a file under `docs/layout-rules/` following the structure in `docs/layout-rules/README.md`, and link it from that README's index. A layout fix without a rule file is incomplete.

### Fixture anonymization (mandatory)

Real-world labels never appear in fixtures. Two schemes:

- **Topology rules** (placement, routing, ordering): use **Alice in Wonderland** names — `Alice`, `Hatter`, `Cheshire`, `Caterpillar`, `Gryphon`, `Dormouse`, `Mouse`, `Knave`, `Duchess`, `Mock`, `Pat`, `Bill`. Default for everything.
- **Width-sensitive rules** (wrapping, column sizing, text metrics): use **`nodeXXXX`** width-matched to the original label, e.g. `node1234[node12345678]` for a 12-char label.

If you're unsure, the rule is topology. Use Alice. See `docs/layout-rules/README.md` for the full convention.

Why this matters: visual inspection misses bugs that the strict DSL catches (`.leftOf` passes when x=1.0/1.01 but boxes still overlap), wastes tokens on rebuild loops, and produces fixes that pass one screenshot but regress on another diagram. DSL assertions describe *what humans expect to see* in engine-agnostic terms — they survive layout-engine swaps and structural refactors. Anonymization keeps the test about topology, not about whatever real-world diagram surfaced the bug.

DSL methods available — see `packages/doodles-layout/src/layoutTesting.ts` for the full surface. Common ones: positional (`leftOf`/`rightOf`/`above`/`below`, `orderedLeftToRight`/`orderedTopToBottom`, `sameRow`/`sameColumn`, `centeredOver`, `centeredHorizontallyWith`), structural (`cluster().contains()`, `insideCluster`), edge (`edges().count()`, `noCrossings`, `noNodeIntersection`, `noLabelOverlap`), bbox (`nodes(...).noOverlap()`). If the bug needs an assertion that doesn't exist yet, add it to the DSL first.

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
