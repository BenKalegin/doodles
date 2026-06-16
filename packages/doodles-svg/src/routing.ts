import {ElementType, PortAlignment, type Bounds, type Coordinate, type EdgeRoute, insetBounds, segmentEntersRect} from "@benkalegin/doodles-core";
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
    const ctx = buildRoutingContext(diagram);
    const routes: EdgeRoute[] = [];
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.ClassLink) continue;
        const route = routeEdge(el, diagram, theme, ctx);
        if (route) routes.push(route);
    }
    return routes;
}

/**
 * Per-diagram facts the obstacle-aware reroute needs, computed once instead of
 * rescanning every element for each edge (which would make routing O(E²)):
 * node interiors to avoid, candidate riser columns, and each source's outgoing
 * edge count.
 */
interface RoutingContext {
    obstacles: Bounds[];
    riserColumns: number[];
    outgoingCount: Map<string, number>;
}

function buildRoutingContext(diagram: RenderableDoodle): RoutingContext {
    const obstacles: Bounds[] = [];
    const columns = new Set<number>();
    const outgoingCount = new Map<string, number>();
    for (const el of Object.values(diagram.elements)) {
        if (el?.type === ElementType.ClassNode) {
            const b = diagram.nodes[el.id]?.bounds;
            if (!b) continue;
            const interior = insetBounds(b, OBSTACLE_INTERIOR_INSET_PX);
            if (interior.width > 0 && interior.height > 0) obstacles.push(interior);
            columns.add(b.x - RISER_GAP_MARGIN_PX);
            columns.add(b.x + b.width + RISER_GAP_MARGIN_PX);
        } else if (el?.type === ElementType.ClassLink) {
            const p1 = diagram.elements[(el as {port1: string}).port1];
            if (!p1) continue;
            const src = String(p1.nodeId);
            outgoingCount.set(src, (outgoingCount.get(src) ?? 0) + 1);
        }
    }
    return {obstacles, riserColumns: [...columns], outgoingCount};
}

function routeEdge(link: any, diagram: RenderableDoodle, theme: ThemeTokens, ctx: RoutingContext): EdgeRoute | undefined {
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

    const direct = orthogonalRoute(from, to, srcAlign, tgtAlign, srcDetourBounds, tgtDetourBounds);
    // A source with a single outgoing edge has no fan-out to disturb, so the
    // reroute may flip its exit face to reach a shorter clear column.
    const canFlipExit = ctx.outgoingCount.get(sourceNodeId) === 1;
    const polyline = rerouteAroundObstacles(direct, srcAlign, tgtAlign, srcBounds, tgtBounds, ctx, canFlipExit);
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

// Matches the renderer's hairline node stroke and layoutTesting's intersection
// inset: a route grazing a node's perimeter (a port attach stub) is legal, but
// entering the inset interior is a strike-through.
const OBSTACLE_INTERIOR_INSET_PX = 0.5;
// Keep a rerouted riser at least this far off any node edge, so it reads as
// "running down the gutter between columns" rather than hugging a border.
const RISER_GAP_MARGIN_PX = 20;

/**
 * The base router (`orthogonalRoute`) is not obstacle-aware: a cross-cluster
 * back-edge whose single riser lands in a column occupied by an unrelated node
 * slices straight through it (the documented TB-routing gap). This pass repairs
 * only such routes — if the route already clears every node it is returned
 * unchanged, so clean edges (and their golden snapshots) are untouched.
 *
 * Scope: horizontal-exit / horizontal-target routes (the H↔H container case).
 * It searches for a riser column whose vertical leg and both connecting legs
 * clear every node interior, entering the target through whichever face that
 * column approaches, and keeps the shortest such route. When `canFlipExit` is
 * set the opposite source face is considered too — letting a back-edge that
 * would otherwise loop the long way around a cluster take the near side.
 */
function rerouteAroundObstacles(
    polyline: Coordinate[],
    srcAlign: PortAlignment | undefined,
    tgtAlign: PortAlignment | undefined,
    srcBounds: Bounds,
    tgtBounds: Bounds,
    ctx: RoutingContext,
    canFlipExit: boolean,
): Coordinate[] {
    if (!isHorizontalAlignment(srcAlign) || !isHorizontalAlignment(tgtAlign)) return polyline;
    if (!polylineEntersAny(polyline, ctx.obstacles)) return polyline;

    // The original endpoints carry the distributed port attach points (their
    // y-ratio separates edges sharing a face). Reuse them whenever the reroute
    // keeps that face, so a rerouted edge doesn't land on top of a sibling that
    // exits/enters the same face at the face centre.
    const originalExit = polyline[0]!;
    const originalEntry = polyline[polyline.length - 1]!;
    const srcCenterY = srcBounds.y + srcBounds.height / 2;
    const tgtCenterX = tgtBounds.x + tgtBounds.width / 2;
    const srcExitRight = srcAlign === PortAlignment.Right;
    const targetAbove = originalEntry.y < srcCenterY;
    // Try the current exit face first (so it wins length ties); a single-out-edge
    // source may also flip to the opposite face to reach a nearer clear column.
    const exitSides = canFlipExit ? [srcExitRight, !srcExitRight] : [srcExitRight];

    let best: Coordinate[] | undefined;
    let bestLength = Infinity;
    for (const exitRight of exitSides) {
        // Keep the distributed exit point unless we flip to the opposite face;
        // flipping is only allowed for single-out-edge sources, so the face
        // centre is collision-free there.
        const from = exitRight === srcExitRight
            ? originalExit
            : {x: exitRight ? srcBounds.x + srcBounds.width : srcBounds.x, y: srcCenterY};
        for (const x of candidateRiserColumns(from, exitRight, tgtCenterX, ctx.riserColumns)) {
            const candidate = buildReroutedPolyline(from, x, tgtBounds, originalEntry, tgtAlign, targetAbove);
            if (polylineEntersAny(candidate, ctx.obstacles)) continue;
            const length = polylineLength(candidate);
            if (length < bestLength) {
                bestLength = length;
                best = candidate;
            }
        }
    }
    return best ?? polyline;
}

function polylineLength(polyline: readonly Coordinate[]): number {
    let total = 0;
    for (let i = 1; i < polyline.length; i++) {
        total += Math.abs(polyline[i]!.x - polyline[i - 1]!.x) + Math.abs(polyline[i]!.y - polyline[i - 1]!.y);
    }
    return total;
}

function polylineEntersAny(polyline: Coordinate[], obstacles: readonly Bounds[]): boolean {
    for (let i = 1; i < polyline.length; i++) {
        const p1 = polyline[i - 1]!;
        const p2 = polyline[i]!;
        for (const rect of obstacles) {
            if (segmentEntersRect(p1, p2, rect)) return true;
        }
    }
    return false;
}

/**
 * From the diagram's precomputed riser columns (every node's left/right edge
 * offset outward by the gutter margin), keep those on the source's exit side
 * and order them by proximity to the target so the riser enters as close to the
 * target column as it can.
 */
function candidateRiserColumns(
    from: Coordinate,
    exitRight: boolean,
    tgtCenterX: number,
    riserColumns: readonly number[],
): number[] {
    const limit = exitRight ? from.x + RISER_GAP_MARGIN_PX : from.x - RISER_GAP_MARGIN_PX;
    return riserColumns
        .filter(x => (exitRight ? x >= limit : x <= limit))
        .sort((a, b) => Math.abs(a - tgtCenterX) - Math.abs(b - tgtCenterX));
}

/**
 * Build the candidate route for a chosen riser column. The target entry face
 * follows the column: a column left of the target enters its Left face, right
 * of it the Right face, and a column within the target's x-span drops straight
 * into the near horizontal face (Bottom when the target sits above the source).
 *
 * When the entry face matches the target's assigned face, the original (port-
 * distributed) entry point is reused so the route keeps its lane; otherwise it
 * attaches at the new face's centre.
 */
function buildReroutedPolyline(
    from: Coordinate,
    x: number,
    tgtBounds: Bounds,
    originalEntry: Coordinate,
    tgtAlign: PortAlignment | undefined,
    targetAbove: boolean,
): Coordinate[] {
    const tgtLeft = tgtBounds.x;
    const tgtRight = tgtBounds.x + tgtBounds.width;
    if (x > tgtLeft && x < tgtRight) {
        // Column within the target's x-span: drop straight into its near
        // horizontal face (Bottom when the target sits above the source).
        const entryY = targetAbove ? tgtBounds.y + tgtBounds.height : tgtBounds.y;
        return [from, {x, y: from.y}, {x, y: entryY}];
    }
    // Column to one side: enter that horizontal face, reusing the original
    // (port-distributed) attach point when the face is unchanged.
    const onLeft = x <= tgtLeft;
    const keepsFace = onLeft ? tgtAlign === PortAlignment.Left : tgtAlign === PortAlignment.Right;
    const entry = keepsFace
        ? originalEntry
        : {x: onLeft ? tgtLeft : tgtRight, y: tgtBounds.y + tgtBounds.height / 2};
    return [from, {x, y: from.y}, {x, y: entry.y}, entry];
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
    // Bottom — mirror of Top: prefer a clean 3-segment U when source and
    // target are horizontally separated (the canonical LR back-edge case
    // under the gutter-routing rule). The "up" segment lives in the gap
    // between the two columns and enters target's bottom perpendicularly.
    const outerY = Math.max(srcBounds.y + srcBounds.height, tgtBounds.y + tgtBounds.height) + SAME_FACE_DETOUR_PAD;
    const horizontalGap = Math.abs(from.x - to.x) > (srcBounds.width + tgtBounds.width) / 2;
    if (horizontalGap) {
        return [from, {x: from.x, y: outerY}, {x: to.x, y: outerY}, to];
    }
    // Vertically-stacked fallback: 5-segment side detour to clear both bboxes.
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
