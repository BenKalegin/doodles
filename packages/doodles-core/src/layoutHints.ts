/**
 * Layout hints — produced by parsers (Mermaid frontmatter, user prefs),
 * consumed by the layout layer. Shared via doodles-core so neither side
 * needs to depend on the other for these types.
 */

export type LayoutDirection = "TB" | "BT" | "LR" | "RL";

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
}
