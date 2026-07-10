# Layout Rules

Plain-English statement of every layout rule doodles enforces, with an anonymized example and a link to the failing-test fixture that pins it.

Rules are **add-only**. When code changes the rendered layout in a way that's visible to humans, the change needs a rule file here — even if the change is "remove rule X." (Removing a rule is a new rule that says "X no longer applies.")

## Reading order

Skim this index, click into the rule that matches what you're seeing. Each rule file is short by design: one statement, one rationale, one example. If a rule needs several paragraphs to explain, it's actually several rules — split it.

## Index

### Row & column placement
- [linear-tail-after-fork](./linear-tail-after-fork.md) — A linear chain hanging off a fork sits on one shared row, not a staircase.
- [row-center-align-by-height](./row-center-align-by-height.md) — Nodes in the same row are aligned by their vertical centers, not their tops. Multi-line labels next to single-line ones no longer kink the connecting edges.

### Edge routing
- [back-edge-gutter-routing](./back-edge-gutter-routing.md) — Back-edges route through the gutter below their source row. Same-row dips below the row; cross-row uses the gutter between the rows. Never through exterior space above row 1.
- [tb-back-edge-side-gutter](./tb-back-edge-side-gutter.md) — TB/BT mirror: back-edges route through the gutter beside the source column, never through the interior of the cluster. Prevents back-edges from slicing through intermediate nodes whose column sits between source and target.
- [fork-cross-row-perpendicular-exit](./fork-cross-row-perpendicular-exit.md) — Forward edges from a fork that cross to a different row exit the source's cross-axis face (Bottom/Top), not the in-flow face. Keeps the in-row branch on its natural face and lets port distribution clear incoming back-edges.
- [route-around-intermediate-node](./route-around-intermediate-node.md) — A same-row forward edge that would slice through a non-endpoint node detours through the gutter below the source row (Bottom → Top). Catches the decision-diamond-with-re-merge pattern where the skip-rank branch passes through the intermediate column.
- [back-edge-stacked-column-riser](./back-edge-stacked-column-riser.md) — A same-face back-edge between two nodes stacked in one column returns via a tight riser just outside the shared face, not a loop up over the top of the stack. Kills the tall stray riser a "gleaning loop" 2-cycle produced beside a TB pipeline.
- [fork-straight-spine-port](./fork-straight-spine-port.md) — When a node fans out and one child is centre-aligned with it, that edge is pinned to the face centre and runs perpendicularly straight; the branch siblings distribute around it. Keeps the pipeline spine a straight line instead of every edge doglegging off a fractional port.

## Conventions

### Fixture anonymization

Real-world labels (`User request`, `search_agents`, `Supervisor LLM call`) **must not appear in fixtures**. They leak product context, drift in length, and bias the reader toward "is this layout correct for that specific app?" instead of "is this layout correct for this topology?".

Two anonymization schemes, picked by what the rule is about:

| Rule depends on…           | Scheme                                | Example                                                    |
|----------------------------|---------------------------------------|------------------------------------------------------------|
| Topology only              | **Alice in Wonderland** names         | `Alice`, `Hatter`, `Cheshire`, `Caterpillar`, `Gryphon`, `Dormouse`, `Mouse`, `Knave`, `Duchess`, `Mock`, `Pat`, `Bill` |
| Label width / text metrics | **`nodeXXXX`** width-matched          | `node1234[node12345678]` to match a 12-char label          |

Default to Alice. Switch to `nodeXXXX` only when the rule itself is "the layout responds correctly to label width." If you're not sure, the rule is topology — use Alice.

Pick names from the Alice cast that aren't already used in nearby fixtures so a grep for `Hatter` doesn't return ten unrelated tests. If you run out of names, the cast has dozens; check the Wikipedia "List of Alice in Wonderland characters" article.

### One rule per file

Each rule file follows this structure:

```markdown
# Rule: <short name in kebab-case-equivalent words>

## Statement
<one sentence — the rule as a human would read it aloud>

## Rationale
<one paragraph — what mental model the rule serves, and what the
reader experiences when the rule is broken>

## Example

\`\`\`mermaid
flowchart LR
    ...anonymized source...
\`\`\`

![rendered example](./images/<rule-slug>.svg)

## Test
- Fixture: `packages/doodles-svg/test/golden/fixtures/<fixture>.mmd`
- Describe block: `golden: <fixture-name>` in `golden.test.ts`
- Key assertion: `<the DSL line that pins the rule>`

## Anti-example (optional)
<the failure shape, if it's instructive — usually a screenshot or
a short description of what dagre / unfixed code produces>
```

Keep each section ≤ ~5 lines. If the rationale needs more, link out — don't expand inline.

### Rendering the example SVG

The example image is the **fixture's rendered SVG with the rule's fix applied**, saved as a standalone file under `images/`. Generate it via:

```bash
node scripts/render-rule-example.mjs <fixture-name>
```

The script extracts the rendered SVG from the golden snapshot file and writes it to `docs/layout-rules/images/<fixture-name>.svg`. Run `pnpm test` first to make sure the snapshot baseline is current. Commit the SVG. CI is the ultimate truth — the SVG in the doc is for human eyeballing only.

## Adding a new rule (the TDD workflow)

The repo's existing TDD rule (`CLAUDE.md` → *Test-first is mandatory for layout work*) gets two extra steps. Full sequence:

1. **Reproduce.** Add an anonymized fixture under `packages/doodles-svg/test/golden/fixtures/<fixture>.mmd`. Use Alice names unless the rule depends on label width.
2. **Red.** Add a describe block in `golden.test.ts` with DSL assertions that fail on current code. Run `pnpm test` and confirm red.
3. **Green.** Change the layout code until the assertions pass.
4. **Render.** `node scripts/render-rule-example.mjs <fixture>` to extract the rendered SVG from the snapshot and write `docs/layout-rules/images/<fixture>.svg`.
5. **Document.** Add `docs/layout-rules/<rule-slug>.md` following the structure above. Link it from this README's index.

Steps 4 + 5 are not optional. A layout fix without a rule file is a fix without an explanation; the next person hitting a similar issue won't know whether the existing behavior is "intentional" or "haven't gotten to it yet."
