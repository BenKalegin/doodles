import type {Bounds, Coordinate} from "./bounds.js";

/**
 * Pure result of edge routing — geometry only, no markup. Produced by renderers
 * and consumed by render-quality assertions. Decoupled from how the polyline
 * was computed so other backends can supply the same shape.
 */
export interface EdgeRoute {
    /** ClassLink element id. */
    edgeId: string;
    /** Source node element id. */
    sourceNodeId: string;
    /** Target node element id. */
    targetNodeId: string;
    /** Ordered waypoints. First entry is the source attach point, last is target. */
    polyline: Coordinate[];
    /** Raw label text (may contain rich-text tags); empty when no label. */
    label: string;
    /** Approximate axis-aligned bounding box of the rendered label, in absolute coords. Absent when label is empty. */
    labelBox?: Bounds;
}
