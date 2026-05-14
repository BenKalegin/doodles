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
}
