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
    const {sourceNodeId, targetNodeId, from, to, srcAlign, tgtAlign} = endpoints;

    const polyline = orthogonalRoute(from, to, srcAlign, tgtAlign);
    const label = String(link.text ?? "");
    const base: EdgeRoute = {edgeId: String(link.id), sourceNodeId, targetNodeId, polyline, label};
    if (!label) return base;
    return {...base, labelBox: measureLabelBox(label, midpoint(from, to), theme)};
}

interface ResolvedEndpoints {
    sourceNodeId: string;
    targetNodeId: string;
    from: Coordinate;
    to: Coordinate;
    srcAlign: PortAlignment | undefined;
    tgtAlign: PortAlignment | undefined;
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

/**
 * Orthogonal route between two ports. The first segment leaves the source
 * perpendicular to its face; the last segment enters the target perpendicular
 * to its face. The bend(s) in between satisfy both constraints:
 *
 *   - Both ends on the same axis (V↔V or H↔H) → 3 segments, midpoint pivot
 *     (the long horizontal/vertical lives in the channel between rows/cols).
 *   - Cross axis (V↔H) → 2 segments, single elbow.
 *
 * Falling back to dx/dy magnitude when alignment is unknown keeps behavior
 * sensible for diagrams whose ports aren't aligned yet.
 */
function orthogonalRoute(
    from: Coordinate,
    to: Coordinate,
    srcAlign: PortAlignment | undefined,
    tgtAlign: PortAlignment | undefined,
): Coordinate[] {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.abs(dx) < COLLINEAR_TOLERANCE_PX || Math.abs(dy) < COLLINEAR_TOLERANCE_PX) {
        return [from, to];
    }
    const srcVertical = isVerticalAlignment(srcAlign);
    const tgtVertical = isVerticalAlignment(tgtAlign);
    const srcHorizontal = isHorizontalAlignment(srcAlign);
    const tgtHorizontal = isHorizontalAlignment(tgtAlign);

    if (srcVertical && tgtVertical) {
        const midY = from.y + dy / 2;
        return [from, {x: from.x, y: midY}, {x: to.x, y: midY}, to];
    }
    if (srcHorizontal && tgtHorizontal) {
        const midX = from.x + dx / 2;
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

function isVerticalAlignment(a: PortAlignment | undefined): boolean {
    return a === PortAlignment.Top || a === PortAlignment.Bottom;
}

function isHorizontalAlignment(a: PortAlignment | undefined): boolean {
    return a === PortAlignment.Left || a === PortAlignment.Right;
}

function midpoint(a: Coordinate, b: Coordinate): Coordinate {
    return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
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
