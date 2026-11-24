/**
 * Layout hints — produced by parsers (Mermaid frontmatter, user prefs),
 * consumed by the layout layer. Shared via doodles-core so neither side
 * needs to depend on the other for these types.
 */

export const LayoutDirection = {
    TopToBottom: "TB",
    BottomToTop: "BT",
    LeftToRight: "LR",
    RightToLeft: "RL",
} as const;
export type LayoutDirection = (typeof LayoutDirection)[keyof typeof LayoutDirection];

export interface LayoutHints {
    direction?: LayoutDirection;
    rankSep?: number;
    nodeSep?: number;
    edgeSep?: number;
    /**
     * For LR / RL layouts, fold the layer chain into multiple rows once the
     * column count exceeds this value. Defaults to a sensible cap so cyclic
     * flowcharts don't render as one extremely wide line. Pass 0 or a very
     * large number to disable wrapping.
     */
    maxColsPerRow?: number;
    /**
     * Author-declared flow spines, as raw ids referencing the source language's
     * own identifiers (Mermaid node / subgraph ids). Each spine is an ordered
     * list; the layout forces each id to an earlier rank (layer) than the next,
     * overriding the structural rank the engine would otherwise pick. Importers
     * produce this from the `flow:` frontmatter key; the layout layer resolves
     * the raw ids to internal element ids before use.
     */
    flow?: readonly (readonly string[])[];
}
