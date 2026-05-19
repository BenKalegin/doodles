import {ElementType, PortAlignment, type Bounds, type Coordinate, type EdgeRoute} from "@benkalegin/doodles-core";
import {parseRichText} from "./text.js";
import type {RenderableDoodle} from "./index.js";
import type {ThemeTokens} from "./theme.js";

export type {EdgeRoute};

// Sans-serif average character advance as a fraction of font size. Rough but
// good enough for "do two label boxes overlap?" checks. Tightened pads vs.
// monospace (~0.6) — visual measurements on system-ui at 14px sit near 0.55.
const CHAR_WIDTH_RATIO = 0.55;
const LABEL_PADDING_X = 4;
const LABEL_PADDING_Y = 2;
const COLLINEAR_TOLERANCE_PX = 1;

/**
 * Route every ClassLink in `diagram` to a polyline + optional label box.
 * Pure: same input → same output, no side effects, no SVG strings.
 */
export function routeEdges(diagram: RenderableDoodle, theme: ThemeTokens): EdgeRoute[] {
    const routes: EdgeRoute[] = [];
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.ClassLink) continue;
        const route = routeEdge(el, diagram, theme);
        if (route) routes.push(route);
    }
    return routes;
}

function routeEdge(link: any, diagram: RenderableDoodle, theme: ThemeTokens): EdgeRoute | undefined {
    const endpoints = resolveEndpoints(link, diagram);
    if (!endpoints) return undefined;
    const {sourceNodeId, targetNodeId, from, to, srcAlign, tgtAlign, srcBounds, tgtBounds} = endpoints;

    // Detour bounds. Cross-cluster: use cluster bounds so the route clears
    // sibling leaves on the way out of the source's cluster (or into the
    // target's). Intra-cluster: use leaf bounds — pushing the pivot past the
    // cluster's outer edge would overshoot the target sibling and U-turn.
    const srcCluster = clusterContaining(sourceNodeId, diagram);
    const tgtCluster = clusterContaining(targetNodeId, diagram);
    const sameContainer = srcCluster !== undefined && srcCluster === tgtCluster;
    const srcDetourBounds = sameContainer
        ? srcBounds
        : (srcCluster !== undefined ? diagram.nodes[srcCluster]?.bounds ?? srcBounds : srcBounds);
    const tgtDetourBounds = sameContainer
        ? tgtBounds
        : (tgtCluster !== undefined ? diagram.nodes[tgtCluster]?.bounds ?? tgtBounds : tgtBounds);

    const polyline = orthogonalRoute(from, to, srcAlign, tgtAlign, srcDetourBounds, tgtDetourBounds);
    const label = String(link.text ?? "");
    const base: EdgeRoute = {edgeId: String(link.id), sourceNodeId, targetNodeId, polyline, label};
    if (!label) return base;
    return {...base, labelBox: measureLabelBox(label, polylineMidpoint(polyline), theme)};
}

function clusterContaining(nodeId: string, diagram: RenderableDoodle): string | undefined {
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.Cluster) continue;
        if (!(el as {memberNodeIds?: string[]}).memberNodeIds?.includes(nodeId)) continue;
        return String(el.id);
    }
    return undefined;
}

interface ResolvedEndpoints {
    sourceNodeId: string;
    targetNodeId: string;
    from: Coordinate;
    to: Coordinate;
    srcAlign: PortAlignment | undefined;
    tgtAlign: PortAlignment | undefined;
    srcBounds: Bounds;
    tgtBounds: Bounds;
}

function resolveEndpoints(link: any, d: RenderableDoodle): ResolvedEndpoints | undefined {
    const p1 = d.elements[link.port1];
    const p2 = d.elements[link.port2];
    if (!p1 || !p2) return undefined;
    const fromNode = d.elements[p1.nodeId];
    const toNode = d.elements[p2.nodeId];
    if (!fromNode || !toNode) return undefined;
    const fromBounds = d.nodes[fromNode.id]?.bounds;
    const toBounds = d.nodes[toNode.id]?.bounds;
    if (!fromBounds || !toBounds) return undefined;

    const p1Pos = d.ports?.[link.port1];
    const p2Pos = d.ports?.[link.port2];
    return {
        sourceNodeId: String(fromNode.id),
        targetNodeId: String(toNode.id),
        from: portPosition(fromBounds, p1Pos),
        to: portPosition(toBounds, p2Pos),
        srcAlign: p1Pos?.alignment,
        tgtAlign: p2Pos?.alignment,
        srcBounds: fromBounds,
        tgtBounds: toBounds,
    };
}

/**
 * Compute the port attach point on a node's perimeter. When alignment is
 * unset the port falls back to the node center, matching the prior renderer.
 */
export function portPosition(
    bounds: Bounds,
    port: {alignment?: PortAlignment; edgePosRatio?: number} | undefined,
): Coordinate {
    const alignment = port?.alignment;
    const ratio = (port?.edgePosRatio ?? 50) / 100;
    switch (alignment) {
        case PortAlignment.Left:
            return {x: bounds.x, y: bounds.y + bounds.height * ratio};
        case PortAlignment.Right:
            return {x: bounds.x + bounds.width, y: bounds.y + bounds.height * ratio};
        case PortAlignment.Top:
            return {x: bounds.x + bounds.width * ratio, y: bounds.y};
        case PortAlignment.Bottom:
            return {x: bounds.x + bounds.width * ratio, y: bounds.y + bounds.height};
        default:
            return {x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2};
    }
}

// Clearance kept between a back-edge route and the bbox of either endpoint
// when the two ports face the same direction (a U-detour). Larger than the
// typical edge stroke width so the route reads as "going around" rather than
// "hugging the corner."
const SAME_FACE_DETOUR_PAD = 20;

/**
 * Orthogonal route between two ports. The first segment leaves the source
 * perpendicular to its face; the last segment enters the target perpendicular
 * to its face.
 *
 *   - Opposite faces (V↔V or H↔H, e.g. Bottom→Top) → 3 segments, midpoint pivot
 *     (the long horizontal/vertical lives in the channel between rows/cols).
 *   - Cross axis (V↔H) → 2 segments, single elbow.
 *   - Same face (e.g. Right→Right back-edge from a cycle) → 5 segments, U-detour
 *     that escapes past both bboxes before bending back.
 *
 * Falls back to dx/dy magnitude when alignment is unknown.
 */
function orthogonalRoute(
    from: Coordinate,
    to: Coordinate,
    srcAlign: PortAlignment | undefined,
    tgtAlign: PortAlignment | undefined,
    srcBounds: Bounds,
    tgtBounds: Bounds,
): Coordinate[] {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const sameFace = srcAlign !== undefined && srcAlign === tgtAlign;
    const backEdge = srcAlign !== undefined && tgtAlign !== undefined && isBackEdgeForFace(from, to, srcAlign);

    if (Math.abs(dx) < COLLINEAR_TOLERANCE_PX || Math.abs(dy) < COLLINEAR_TOLERANCE_PX) {
        if (sameFace) return sameFaceDetour(from, to, srcAlign!, srcBounds, tgtBounds);
        if (backEdge) return crossAxisBackEdgeDetour(from, to, srcAlign!, tgtAlign!, srcBounds, tgtBounds);
        return [from, to];
    }
    if (sameFace) return sameFaceDetour(from, to, srcAlign!, srcBounds, tgtBounds);
    if (backEdge) return crossAxisBackEdgeDetour(from, to, srcAlign!, tgtAlign!, srcBounds, tgtBounds);

    const srcVertical = isVerticalAlignment(srcAlign);
    const tgtVertical = isVerticalAlignment(tgtAlign);
    const srcHorizontal = isHorizontalAlignment(srcAlign);
    const tgtHorizontal = isHorizontalAlignment(tgtAlign);

    if (srcVertical && tgtVertical) {
        const midY = pivotBetweenContainers(from.y, to.y, srcBounds, tgtBounds, "y", srcAlign!);
        return [from, {x: from.x, y: midY}, {x: to.x, y: midY}, to];
    }
    if (srcHorizontal && tgtHorizontal) {
        const midX = pivotBetweenContainers(from.x, to.x, srcBounds, tgtBounds, "x", srcAlign!);
        return [from, {x: midX, y: from.y}, {x: midX, y: to.y}, to];
    }
    if (srcVertical && tgtHorizontal) {
        return [from, {x: from.x, y: to.y}, to];
    }
    if (srcHorizontal && tgtVertical) {
        return [from, {x: to.x, y: from.y}, to];
    }
    // Unknown alignment on at least one side — pivot on the dominant axis.
    if (Math.abs(dy) > Math.abs(dx)) {
        const midY = from.y + dy / 2;
        return [from, {x: from.x, y: midY}, {x: to.x, y: midY}, to];
    }
    const midX = from.x + dx / 2;
    return [from, {x: midX, y: from.y}, {x: midX, y: to.y}, to];
}

/**
 * "Back-edge" from a port's POV: the target sits behind the face, not in
 * front of it. A Right port whose target is to its left, a Bottom port whose
 * target is above it, etc. Direct elbow routes for these collapse through
 * the source bbox, so the router takes a U-detour instead.
 */
function isBackEdgeForFace(from: Coordinate, to: Coordinate, srcAlign: PortAlignment): boolean {
    switch (srcAlign) {
        case PortAlignment.Right: return to.x < from.x;
        case PortAlignment.Left: return to.x > from.x;
        case PortAlignment.Top: return to.y > from.y;
        case PortAlignment.Bottom: return to.y < from.y;
        default: return false;
    }
}

/**
 * U-detour for a back-edge where source and target face different axes
 * (e.g. Right → Top). Both endpoints step out perpendicular to their face
 * past the outer bbox edge, then meet at the corner formed by those two
 * outer lines. When the faces are on the same axis but opposite sides
 * (Right → Left, Top → Bottom), an additional cross-axis hop is needed.
 */
function crossAxisBackEdgeDetour(
    from: Coordinate,
    to: Coordinate,
    srcAlign: PortAlignment,
    tgtAlign: PortAlignment,
    srcBounds: Bounds,
    tgtBounds: Bounds,
): Coordinate[] {
    // For cross-axis cases the exit step is anchored to the source's outer
    // lines and the entry step to the target's — using a single combined
    // outer would push the entry past the *source* cluster on the wrong side
    // when source and target are in separate clusters, creating a long
    // back-segment that re-enters the source cluster's row.
    const srcOuter = outerLinesOf(srcBounds);
    const tgtOuter = outerLinesOf(tgtBounds);
    const exit = perpendicularStepOut(from, srcAlign, srcOuter);
    const entry = perpendicularStepOut(to, tgtAlign, tgtOuter);

    const srcVertical = isVerticalAlignment(srcAlign);
    const tgtVertical = isVerticalAlignment(tgtAlign);
    if (srcVertical !== tgtVertical) {
        // Cross-axis: 4 segments. Two corner choices fit the L-shape:
        //   A = (exit.x, entry.y) — exit-first then horizontal to entry
        //   B = (entry.x, exit.y) — horizontal first to entry's column, then exit
        // B keeps the long segment at exit.y (just outside the source cluster),
        // which is obstacle-free by construction; A keeps the long segment at
        // entry.y (target's row), which on a Bottom→Left back-edge cuts back
        // through the source cluster's row and hits sibling leaves.
        const corner = {x: entry.x, y: exit.y};
        return [from, exit, corner, entry, to];
    }
    // Same axis, opposite faces (Right↔Left or Top↔Bottom): 5 segments. Need
    // to traverse cross-axis between source's outer line and target's outer.
    // The combined outer is appropriate here because the cross-axis sweep has
    // to clear both bboxes on the same side.
    const right = Math.max(srcOuter.right, tgtOuter.right);
    const left = Math.min(srcOuter.left, tgtOuter.left);
    const top = Math.min(srcOuter.top, tgtOuter.top);
    const bottom = Math.max(srcOuter.bottom, tgtOuter.bottom);
    if (srcVertical) {
        const sideX = pickDetourSide(from.x, to.x, left, right);
        return [from, exit, {x: sideX, y: exit.y}, {x: sideX, y: entry.y}, entry, to];
    }
    const sideY = pickDetourSide(from.y, to.y, top, bottom);
    return [from, exit, {x: exit.x, y: sideY}, {x: entry.x, y: sideY}, entry, to];
}

/**
 * Pick the elbow pivot for a same-axis L-route so it lands *outside* the
 * source's container on the exit side, not at the geometric midpoint.
 *
 * The naive midpoint lands inside the source's container when the container
 * is wide enough — and intra-container siblings on the exit face (e.g., a
 * Tool factory sitting just to the right of an AgentService) end up sliced
 * by the vertical leg of the L. Picking a pivot past the container's outer
 * edge guarantees the leg clears any sibling without the router needing
 * obstacle awareness.
 *
 * The pivot is clamped to lie between source and target so it never overshoots
 * past the target's far side (which would re-introduce a back-edge).
 */
function pivotBetweenContainers(
    fromCoord: number,
    toCoord: number,
    srcBounds: Bounds,
    tgtBounds: Bounds,
    axis: "x" | "y",
    srcAlign: PortAlignment,
): number {
    const midpoint = (fromCoord + toCoord) / 2;
    const forward = toCoord > fromCoord ? 1 : -1;
    const srcOuter = axis === "x"
        ? (srcAlign === PortAlignment.Right ? srcBounds.x + srcBounds.width : srcBounds.x)
        : (srcAlign === PortAlignment.Bottom ? srcBounds.y + srcBounds.height : srcBounds.y);
    const tgtOuter = axis === "x"
        ? (toCoord > fromCoord ? tgtBounds.x : tgtBounds.x + tgtBounds.width)
        : (toCoord > fromCoord ? tgtBounds.y : tgtBounds.y + tgtBounds.height);
    // Lower bound: past source container's exit edge.
    const lower = srcOuter + forward * SAME_FACE_DETOUR_PAD;
    // Upper bound: stop before the target container's near edge so we don't
    // overshoot into it.
    const upper = tgtOuter - forward * SAME_FACE_DETOUR_PAD;
    const inRange = forward > 0
        ? Math.max(midpoint, lower)
        : Math.min(midpoint, lower);
    return forward > 0 ? Math.min(inRange, upper) : Math.max(inRange, upper);
}

function outerLinesOf(b: Bounds): OuterLines {
    return {
        right: b.x + b.width + SAME_FACE_DETOUR_PAD,
        left: b.x - SAME_FACE_DETOUR_PAD,
        top: b.y - SAME_FACE_DETOUR_PAD,
        bottom: b.y + b.height + SAME_FACE_DETOUR_PAD,
    };
}

interface OuterLines {right: number; left: number; top: number; bottom: number}

function perpendicularStepOut(port: Coordinate, face: PortAlignment, outer: OuterLines): Coordinate {
    switch (face) {
        case PortAlignment.Right: return {x: outer.right, y: port.y};
        case PortAlignment.Left: return {x: outer.left, y: port.y};
        case PortAlignment.Top: return {x: port.x, y: outer.top};
        case PortAlignment.Bottom: return {x: port.x, y: outer.bottom};
        default: return port;
    }
}

/**
 * U-shaped detour for back-edges whose endpoints sit on the same face. The
 * route escapes perpendicular to the shared face past the outer edge of both
 * bboxes, runs along the cross-axis to align with the target, then enters
 * straight in. Bias the cross-axis travel to clear both bboxes on the
 * smaller-extent side (above vs below for horizontal faces, etc.).
 */
function sameFaceDetour(
    from: Coordinate,
    to: Coordinate,
    face: PortAlignment,
    srcBounds: Bounds,
    tgtBounds: Bounds,
): Coordinate[] {
    if (face === PortAlignment.Right) {
        const outerX = Math.max(srcBounds.x + srcBounds.width, tgtBounds.x + tgtBounds.width) + SAME_FACE_DETOUR_PAD;
        const aboveY = Math.min(srcBounds.y, tgtBounds.y) - SAME_FACE_DETOUR_PAD;
        const belowY = Math.max(srcBounds.y + srcBounds.height, tgtBounds.y + tgtBounds.height) + SAME_FACE_DETOUR_PAD;
        const sideY = pickDetourSide(from.y, to.y, aboveY, belowY);
        return [from, {x: outerX, y: from.y}, {x: outerX, y: sideY}, {x: to.x, y: sideY}, to];
    }
    if (face === PortAlignment.Left) {
        const outerX = Math.min(srcBounds.x, tgtBounds.x) - SAME_FACE_DETOUR_PAD;
        const aboveY = Math.min(srcBounds.y, tgtBounds.y) - SAME_FACE_DETOUR_PAD;
        const belowY = Math.max(srcBounds.y + srcBounds.height, tgtBounds.y + tgtBounds.height) + SAME_FACE_DETOUR_PAD;
        const sideY = pickDetourSide(from.y, to.y, aboveY, belowY);
        return [from, {x: outerX, y: from.y}, {x: outerX, y: sideY}, {x: to.x, y: sideY}, to];
    }
    if (face === PortAlignment.Top) {
        const outerY = Math.min(srcBounds.y, tgtBounds.y) - SAME_FACE_DETOUR_PAD;
        // Source-target separated horizontally: 3-segment U that drops straight
        // into target's top from above. The "down" segment lives in the gap
        // between source's column and target's column, so it doesn't slide
        // along the target's top border.
        const horizontalGap = Math.abs(from.x - to.x) > (srcBounds.width + tgtBounds.width) / 2;
        if (horizontalGap) {
            return [from, {x: from.x, y: outerY}, {x: to.x, y: outerY}, to];
        }
        // Source-target stacked vertically (rare same-face case): the original
        // 5-segment side-detour is needed because a 3-segment route would
        // collapse straight through both bboxes.
        const leftX = Math.min(srcBounds.x, tgtBounds.x) - SAME_FACE_DETOUR_PAD;
        const rightX = Math.max(srcBounds.x + srcBounds.width, tgtBounds.x + tgtBounds.width) + SAME_FACE_DETOUR_PAD;
        const sideX = pickDetourSide(from.x, to.x, leftX, rightX);
        return [from, {x: from.x, y: outerY}, {x: sideX, y: outerY}, {x: sideX, y: to.y}, to];
    }
    // Bottom
    const outerY = Math.max(srcBounds.y + srcBounds.height, tgtBounds.y + tgtBounds.height) + SAME_FACE_DETOUR_PAD;
    const leftX = Math.min(srcBounds.x, tgtBounds.x) - SAME_FACE_DETOUR_PAD;
    const rightX = Math.max(srcBounds.x + srcBounds.width, tgtBounds.x + tgtBounds.width) + SAME_FACE_DETOUR_PAD;
    const sideX = pickDetourSide(from.x, to.x, leftX, rightX);
    return [from, {x: from.x, y: outerY}, {x: sideX, y: outerY}, {x: sideX, y: to.y}, to];
}

/**
 * For a U-detour, pick which side of the bbox pair to traverse along. Picks
 * whichever option produces the shorter total cross-axis travel
 * (|side − from| + |to − side|) — so a back-edge inside one row goes the
 * conventional way (above for horizontal layouts) while a cross-row edge
 * crosses through the gap between rows toward the target instead of looping
 * the long way around.
 */
function pickDetourSide(from: number, to: number, optionA: number, optionB: number): number {
    const costA = Math.abs(optionA - from) + Math.abs(to - optionA);
    const costB = Math.abs(optionB - from) + Math.abs(to - optionB);
    return costA <= costB ? optionA : optionB;
}

function isVerticalAlignment(a: PortAlignment | undefined): boolean {
    return a === PortAlignment.Top || a === PortAlignment.Bottom;
}

function isHorizontalAlignment(a: PortAlignment | undefined): boolean {
    return a === PortAlignment.Left || a === PortAlignment.Right;
}

/**
 * Point halfway along a polyline by arc length. The endpoint midpoint sits
 * on the chord between the two endpoints — for a U-detour route the chord
 * crosses straight through the source bbox, so labels placed there overlap
 * the node. Walking the polyline keeps the label on the visible path.
 */
function polylineMidpoint(points: readonly Coordinate[]): Coordinate {
    if (points.length === 0) return {x: 0, y: 0};
    if (points.length === 1) return points[0]!;
    let total = 0;
    const segLengths: number[] = [];
    for (let i = 1; i < points.length; i++) {
        const a = points[i - 1]!;
        const b = points[i]!;
        const len = Math.hypot(b.x - a.x, b.y - a.y);
        segLengths.push(len);
        total += len;
    }
    if (total === 0) return points[0]!;
    let remaining = total / 2;
    for (let i = 0; i < segLengths.length; i++) {
        const len = segLengths[i]!;
        if (remaining <= len) {
            const a = points[i]!;
            const b = points[i + 1]!;
            const t = len === 0 ? 0 : remaining / len;
            return {x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t};
        }
        remaining -= len;
    }
    return points[points.length - 1]!;
}

/**
 * Approximate the bounding box of a rendered edge label. The renderer centers
 * text on a point and grows multi-line content symmetrically; we mirror that
 * here using a sans-serif advance estimate (the renderer doesn't measure text
 * either — it relies on `text-anchor="middle"`).
 */
function measureLabelBox(label: string, center: Coordinate, theme: ThemeTokens): Bounds {
    const lines = parseRichText(label);
    const longestChars = lines.reduce((max, line) => {
        const chars = line.spans.reduce((sum, span) => sum + span.text.length, 0);
        return Math.max(max, chars);
    }, 0);
    const width = longestChars * theme.font.size * CHAR_WIDTH_RATIO + LABEL_PADDING_X * 2;
    const height = lines.length * theme.font.lineHeight + LABEL_PADDING_Y * 2;
    return {
        x: center.x - width / 2,
        y: center.y - height / 2,
        width,
        height,
    };
}
