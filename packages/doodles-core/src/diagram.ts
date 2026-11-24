import {type Coordinate, zeroCoordinate} from "./bounds.js";
import type {ElementRef} from "./element.js";

export interface DiagramDisplay {
    width: number;
    height: number;
    scale: number;
    offset: Coordinate;
}

export const defaultDiagramDisplay: DiagramDisplay = {
    width: 0,
    height: 0,
    scale: 1,
    offset: zeroCoordinate
};

/**
 * Minimal Diagram surface that doodles-layout reads/writes. Consumers
 * (clouddiagram editor, axonize) may extend with their own fields (selection,
 * sticky notes, editing state, etc.) — those are not visible to layout.
 */
export interface Diagram extends ElementRef {
    title?: string;
    display: DiagramDisplay;
    /**
     * Author-declared flow spines resolved to internal element ids. Each spine
     * is an ordered list of node / cluster ids the layout should rank in order
     * (earlier id → earlier layer), overriding the structural rank. Produced by
     * importers from the `flow:` frontmatter key (after resolving the raw source
     * ids); consumed by doodles-layout's re-layout pass.
     */
    layoutFlow?: readonly (readonly string[])[];
}
