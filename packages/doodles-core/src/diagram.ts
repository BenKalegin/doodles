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
}
