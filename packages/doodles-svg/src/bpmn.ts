import {
    type BpmnDiagram,
    type BpmnEvent,
    type BpmnFlow,
    type BpmnFlowPlacement,
    type BpmnGateway,
    type BpmnLane,
    type BpmnNode,
    type BpmnNodePlacement,
    type BpmnPool,
    type Bounds,
    type Coordinate,
    BpmnElementKind,
    BpmnEventDefinition,
    BpmnFlowKind,
    BpmnPoolOrientation,
} from "@benkalegin/doodles-core";
import {defaultLightTheme, type ThemeTokens} from "./theme.js";
import {xmlEscape} from "./escape.js";

/**
 * Render a BpmnDiagram to an SVG string. Uses BPMNDI bounds + waypoints
 * directly (consumers should run BPMN auto-layout upstream if the diagram has
 * no DI). Covers the Descriptive subset: tasks/events/gateways/sequence+message
 * flows, pools and lanes, plus the four event definitions (none/message/timer/
 * terminate).
 */

export interface BpmnRenderOptions {
    theme?: ThemeTokens;
    /** Extra padding around the diagram bounding box (added to viewBox). Defaults to 12. */
    padding?: number;
}

const DEFAULT_PADDING = 12;

// Shape sizing fallbacks (used only when a node has no BPMNDI placement).
const FALLBACK_EVENT_RADIUS = 18;
const FALLBACK_TASK_WIDTH = 100;
const FALLBACK_TASK_HEIGHT = 80;
const FALLBACK_GATEWAY_SIZE = 50;
const FALLBACK_POOL_WIDTH = 500;
const FALLBACK_POOL_HEIGHT = 200;

// Stroke weights — encode BPMN semantics (event ring thickness, message-flow dashing, etc.).
const STROKE_EVENT_START = 1.5;
const STROKE_EVENT_INTERMEDIATE_OUTER = 1.5;
const STROKE_EVENT_INTERMEDIATE_INNER = 1.5;
const EVENT_INTERMEDIATE_INNER_GAP = 3;
const STROKE_EVENT_END = 3;
const STROKE_TASK = 1.5;
const STROKE_TASK_CALL_ACTIVITY = 3;
const STROKE_GATEWAY = 1.5;
const STROKE_FLOW_DEFAULT = 1.5;
const STROKE_GLYPH = 1.5;

// Inner glyph sizing (event symbols, gateway markers, task icons).
const EVENT_GLYPH_SCALE = 0.55;
const GATEWAY_GLYPH_SCALE = 0.5;
const TASK_ICON_SIZE = 16;
const TASK_ICON_PADDING = 6;

// Task shape parameters.
const TASK_CORNER_RADIUS = 8;
const TASK_LABEL_INSET = 8;

// Flow rendering.
const FLOW_MESSAGE_DASH = "6 4";
const FLOW_ASSOCIATION_DASH = "2 3";
const FLOW_ARROW_HEAD_LENGTH = 10;
const FLOW_ARROW_HEAD_HALF_WIDTH = 4;
const FLOW_MESSAGE_SOURCE_CIRCLE_RADIUS = 4;
const FLOW_LABEL_DY = -4;

// Pool/lane label band.
const POOL_LABEL_BAND_WIDTH = 24;
const POOL_LABEL_FONT_SIZE_MULTIPLIER = 0.95;

export function renderBpmnSvg(diagram: BpmnDiagram, options: BpmnRenderOptions = {}): string {
    const theme = options.theme ?? defaultLightTheme;
    const padding = options.padding ?? DEFAULT_PADDING;
    const {width, height, offset} = diagram.display;
    const viewBox = `${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`;

    const layers: string[] = [];
    layers.push(renderPools(diagram, theme));
    layers.push(renderLanes(diagram, theme));
    layers.push(renderNodes(diagram, theme));
    layers.push(renderFlows(diagram, theme));

    const background = theme.colors.background !== "transparent"
        ? `<rect x="${-padding}" y="${-padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="${theme.colors.background}" />`
        : "";
    const translate = `<g transform="translate(${offset.x} ${offset.y})">${layers.join("")}</g>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" class="doodles-svg doodles-svg-bpmn" viewBox="${viewBox}" width="${width + padding * 2}" height="${height + padding * 2}">${background}${translate}</svg>`;
}

// ── Pool & lane bands ───────────────────────────────────────────────────────

function renderPools(diagram: BpmnDiagram, theme: ThemeTokens): string {
    return collectNodesByKind(diagram, BpmnElementKind.Pool)
        .map(pool => renderPool(pool as BpmnPool, diagram.nodePlacements[pool.id], theme))
        .join("");
}

function renderLanes(diagram: BpmnDiagram, theme: ThemeTokens): string {
    return collectNodesByKind(diagram, BpmnElementKind.Lane)
        .map(lane => renderLane(lane as BpmnLane, diagram.nodePlacements[lane.id], theme))
        .join("");
}

function renderPool(pool: BpmnPool, placement: BpmnNodePlacement | undefined, theme: ThemeTokens): string {
    const bounds = placement?.bounds ?? {x: 0, y: 0, width: FALLBACK_POOL_WIDTH, height: FALLBACK_POOL_HEIGHT};
    const isHorizontal = pool.orientation === BpmnPoolOrientation.Horizontal;
    return renderContainer(pool.id, "pool", bounds, isHorizontal, pool.name, theme);
}

function renderLane(lane: BpmnLane, placement: BpmnNodePlacement | undefined, theme: ThemeTokens): string {
    if (!placement) return "";
    // Lanes inherit orientation from their parent pool; default to horizontal-pool layout.
    const isHorizontal = placement.isHorizontal ?? true;
    return renderContainer(lane.id, "lane", placement.bounds, isHorizontal, lane.name, theme);
}

function renderContainer(id: string, role: "pool" | "lane", bounds: Bounds, isHorizontal: boolean, label: string | undefined, theme: ThemeTokens): string {
    const rect = `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${theme.colors.compoundFill}" stroke="${theme.colors.compoundStroke}" stroke-width="${STROKE_TASK}" />`;
    const band = renderLabelBand(bounds, isHorizontal, theme);
    const labelSvg = label ? renderContainerLabel(bounds, isHorizontal, label, theme) : "";
    return `<g data-doodles-bpmn-${role}="${xmlEscape(id)}">${rect}${band}${labelSvg}</g>`;
}

function renderLabelBand(bounds: Bounds, isHorizontal: boolean, theme: ThemeTokens): string {
    if (isHorizontal) {
        return `<line x1="${bounds.x + POOL_LABEL_BAND_WIDTH}" y1="${bounds.y}" x2="${bounds.x + POOL_LABEL_BAND_WIDTH}" y2="${bounds.y + bounds.height}" stroke="${theme.colors.compoundStroke}" stroke-width="${STROKE_TASK}" />`;
    }
    return `<line x1="${bounds.x}" y1="${bounds.y + POOL_LABEL_BAND_WIDTH}" x2="${bounds.x + bounds.width}" y2="${bounds.y + POOL_LABEL_BAND_WIDTH}" stroke="${theme.colors.compoundStroke}" stroke-width="${STROKE_TASK}" />`;
}

function renderContainerLabel(bounds: Bounds, isHorizontal: boolean, label: string, theme: ThemeTokens): string {
    const fontSize = theme.font.size * POOL_LABEL_FONT_SIZE_MULTIPLIER;
    if (isHorizontal) {
        const cx = bounds.x + POOL_LABEL_BAND_WIDTH / 2;
        const cy = bounds.y + bounds.height / 2;
        return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${cx} ${cy})" font-family="${xmlEscape(theme.font.family)}" font-size="${fontSize}" fill="${theme.colors.compoundLabel}">${xmlEscape(label)}</text>`;
    }
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + POOL_LABEL_BAND_WIDTH / 2;
    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-family="${xmlEscape(theme.font.family)}" font-size="${fontSize}" fill="${theme.colors.compoundLabel}">${xmlEscape(label)}</text>`;
}

// ── Node dispatch ───────────────────────────────────────────────────────────

function renderNodes(diagram: BpmnDiagram, theme: ThemeTokens): string {
    const parts: string[] = [];
    for (const node of Object.values(diagram.nodes)) {
        if (node.kind === BpmnElementKind.Pool || node.kind === BpmnElementKind.Lane) continue;
        const placement = diagram.nodePlacements[node.id];
        parts.push(renderNode(node, placement, theme));
    }
    return parts.join("");
}

function renderNode(node: BpmnNode, placement: BpmnNodePlacement | undefined, theme: ThemeTokens): string {
    const bounds = placement?.bounds ?? defaultBoundsFor(node);
    if (isEventKind(node.kind)) return renderEvent(node as BpmnEvent, bounds, theme);
    if (isActivityKind(node.kind)) return renderActivity(node, bounds, theme);
    if (isGatewayKind(node.kind)) return renderGateway(node as BpmnGateway, bounds, theme);
    if (node.kind === BpmnElementKind.TextAnnotation) return renderTextAnnotationShape(node.id, bounds, "text" in node ? node.text : "", theme);
    return renderGenericNode(node.id, bounds, "name" in node && node.name ? node.name : "", theme);
}

function defaultBoundsFor(node: BpmnNode): Bounds {
    if (isEventKind(node.kind)) return {x: 0, y: 0, width: FALLBACK_EVENT_RADIUS * 2, height: FALLBACK_EVENT_RADIUS * 2};
    if (isGatewayKind(node.kind)) return {x: 0, y: 0, width: FALLBACK_GATEWAY_SIZE, height: FALLBACK_GATEWAY_SIZE};
    return {x: 0, y: 0, width: FALLBACK_TASK_WIDTH, height: FALLBACK_TASK_HEIGHT};
}

// ── Events ──────────────────────────────────────────────────────────────────

function renderEvent(event: BpmnEvent, bounds: Bounds, theme: ThemeTokens): string {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const r = Math.min(bounds.width, bounds.height) / 2;
    const rings = renderEventRings(event.kind, cx, cy, r, theme);
    const glyph = renderEventGlyph(event, cx, cy, r, theme);
    const label = event.name ? renderCenteredLabelBelow(event.name, cx, cy + r, theme) : "";
    return `<g data-doodles-bpmn-event="${xmlEscape(event.id)}">${rings}${glyph}${label}</g>`;
}

function renderEventRings(kind: BpmnEvent["kind"], cx: number, cy: number, r: number, theme: ThemeTokens): string {
    if (kind === BpmnElementKind.StartEvent) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${theme.colors.nodeFill}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_EVENT_START}" />`;
    }
    if (kind === BpmnElementKind.EndEvent) {
        return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${theme.colors.nodeFill}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_EVENT_END}" />`;
    }
    // Intermediate (catch or throw): concentric double ring.
    const inner = r - EVENT_INTERMEDIATE_INNER_GAP;
    return [
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${theme.colors.nodeFill}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_EVENT_INTERMEDIATE_OUTER}" />`,
        `<circle cx="${cx}" cy="${cy}" r="${inner}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_EVENT_INTERMEDIATE_INNER}" />`,
    ].join("");
}

function renderEventGlyph(event: BpmnEvent, cx: number, cy: number, r: number, theme: ThemeTokens): string {
    const g = r * EVENT_GLYPH_SCALE;
    switch (event.eventDefinition) {
        case BpmnEventDefinition.Message: return envelopeGlyph(cx, cy, g, theme);
        case BpmnEventDefinition.Timer: return clockGlyph(cx, cy, g, theme);
        case BpmnEventDefinition.Terminate: return `<circle cx="${cx}" cy="${cy}" r="${g}" fill="${theme.colors.nodeStroke}" />`;
        default: return "";
    }
}

function envelopeGlyph(cx: number, cy: number, half: number, theme: ThemeTokens): string {
    const x = cx - half;
    const y = cy - half * 0.7;
    const w = half * 2;
    const h = half * 1.4;
    const flap = `M${x} ${y} L${cx} ${y + h * 0.55} L${x + w} ${y}`;
    return [
        `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
        `<path d="${flap}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
    ].join("");
}

function clockGlyph(cx: number, cy: number, r: number, theme: ThemeTokens): string {
    const hourHandX = cx;
    const hourHandY = cy - r * 0.55;
    const minHandX = cx + r * 0.55;
    const minHandY = cy;
    return [
        `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
        `<line x1="${cx}" y1="${cy}" x2="${hourHandX}" y2="${hourHandY}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
        `<line x1="${cx}" y1="${cy}" x2="${minHandX}" y2="${minHandY}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
    ].join("");
}

// ── Activities ──────────────────────────────────────────────────────────────

function renderActivity(node: BpmnNode, bounds: Bounds, theme: ThemeTokens): string {
    const strokeWidth = node.kind === BpmnElementKind.CallActivity ? STROKE_TASK_CALL_ACTIVITY : STROKE_TASK;
    const rect = `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" rx="${TASK_CORNER_RADIUS}" ry="${TASK_CORNER_RADIUS}" fill="${theme.colors.nodeFill}" stroke="${theme.colors.nodeStroke}" stroke-width="${strokeWidth}" />`;
    const icon = renderActivityIcon(node.kind, bounds, theme);
    const subprocessMark = node.kind === BpmnElementKind.Subprocess ? renderSubprocessMarker(bounds, theme) : "";
    const label = "name" in node && node.name ? renderCenteredLabelInside(node.name, bounds, theme) : "";
    return `<g data-doodles-bpmn-activity="${xmlEscape(node.id)}">${rect}${icon}${subprocessMark}${label}</g>`;
}

function renderActivityIcon(kind: BpmnNode["kind"], bounds: Bounds, theme: ThemeTokens): string {
    const ix = bounds.x + TASK_ICON_PADDING;
    const iy = bounds.y + TASK_ICON_PADDING;
    const s = TASK_ICON_SIZE;
    if (kind === BpmnElementKind.UserTask) return userIcon(ix, iy, s, theme);
    if (kind === BpmnElementKind.ServiceTask) return serviceIcon(ix, iy, s, theme);
    return "";
}

function userIcon(x: number, y: number, s: number, theme: ThemeTokens): string {
    // Head + shoulders.
    const headR = s * 0.22;
    const cx = x + s / 2;
    const headCy = y + headR + 1;
    const shoulderTop = y + s * 0.55;
    const shoulderBottom = y + s;
    const shoulderLeft = x + s * 0.15;
    const shoulderRight = x + s * 0.85;
    return [
        `<circle cx="${cx}" cy="${headCy}" r="${headR}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
        `<path d="M${shoulderLeft} ${shoulderBottom} Q${shoulderLeft} ${shoulderTop} ${cx} ${shoulderTop} Q${shoulderRight} ${shoulderTop} ${shoulderRight} ${shoulderBottom}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
    ].join("");
}

function serviceIcon(x: number, y: number, s: number, theme: ThemeTokens): string {
    // Two stacked rectangles suggesting gears — a deliberately simple glyph; full BPMN gear is intricate.
    const w = s * 0.7;
    const h = s * 0.35;
    return [
        `<rect x="${x}" y="${y + s * 0.1}" width="${w}" height="${h}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
        `<rect x="${x + s * 0.15}" y="${y + s * 0.55}" width="${w}" height="${h}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
    ].join("");
}

function renderSubprocessMarker(bounds: Bounds, theme: ThemeTokens): string {
    const cx = bounds.x + bounds.width / 2;
    const by = bounds.y + bounds.height - TASK_ICON_PADDING;
    const size = TASK_ICON_SIZE / 2;
    return [
        `<rect x="${cx - size}" y="${by - size * 2}" width="${size * 2}" height="${size * 2}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
        `<line x1="${cx - size * 0.6}" y1="${by - size}" x2="${cx + size * 0.6}" y2="${by - size}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
        `<line x1="${cx}" y1="${by - size * 1.6}" x2="${cx}" y2="${by - size * 0.4}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH}" />`,
    ].join("");
}

// ── Gateways ────────────────────────────────────────────────────────────────

function renderGateway(gateway: BpmnGateway, bounds: Bounds, theme: ThemeTokens): string {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    const half = Math.min(bounds.width, bounds.height) / 2;
    const diamond = `M${cx} ${cy - half} L${cx + half} ${cy} L${cx} ${cy + half} L${cx - half} ${cy} Z`;
    const shape = `<path d="${diamond}" fill="${theme.colors.nodeFill}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GATEWAY}" />`;
    const glyph = renderGatewayGlyph(gateway.kind, cx, cy, half, theme);
    const label = gateway.name ? renderCenteredLabelBelow(gateway.name, cx, cy + half, theme) : "";
    return `<g data-doodles-bpmn-gateway="${xmlEscape(gateway.id)}">${shape}${glyph}${label}</g>`;
}

function renderGatewayGlyph(kind: BpmnGateway["kind"], cx: number, cy: number, half: number, theme: ThemeTokens): string {
    const g = half * GATEWAY_GLYPH_SCALE;
    switch (kind) {
        case BpmnElementKind.ExclusiveGateway:
            return [
                `<line x1="${cx - g * 0.7}" y1="${cy - g * 0.7}" x2="${cx + g * 0.7}" y2="${cy + g * 0.7}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH * 1.5}" />`,
                `<line x1="${cx - g * 0.7}" y1="${cy + g * 0.7}" x2="${cx + g * 0.7}" y2="${cy - g * 0.7}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH * 1.5}" />`,
            ].join("");
        case BpmnElementKind.ParallelGateway:
            return [
                `<line x1="${cx - g}" y1="${cy}" x2="${cx + g}" y2="${cy}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH * 1.5}" />`,
                `<line x1="${cx}" y1="${cy - g}" x2="${cx}" y2="${cy + g}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH * 1.5}" />`,
            ].join("");
        case BpmnElementKind.InclusiveGateway:
            return `<circle cx="${cx}" cy="${cy}" r="${g}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH * 1.5}" />`;
        case BpmnElementKind.EventBasedGateway:
            return eventBasedPentagon(cx, cy, g, theme);
    }
}

function eventBasedPentagon(cx: number, cy: number, r: number, theme: ThemeTokens): string {
    const pts: string[] = [];
    for (let i = 0; i < 5; i++) {
        const a = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
        pts.push(`${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`);
    }
    return `<polygon points="${pts.join(" ")}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_GLYPH * 1.5}" />`;
}

// ── Generic + artifact fallback ────────────────────────────────────────────

function renderGenericNode(id: string, bounds: Bounds, name: string, theme: ThemeTokens): string {
    const rect = `<rect x="${bounds.x}" y="${bounds.y}" width="${bounds.width}" height="${bounds.height}" fill="${theme.colors.nodeFill}" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_TASK}" stroke-dasharray="${FLOW_ASSOCIATION_DASH}" />`;
    const label = name ? renderCenteredLabelInside(name, bounds, theme) : "";
    return `<g data-doodles-bpmn-generic="${xmlEscape(id)}">${rect}${label}</g>`;
}

function renderTextAnnotationShape(id: string, bounds: Bounds, text: string, theme: ThemeTokens): string {
    const bracket = `M${bounds.x + 8} ${bounds.y} L${bounds.x} ${bounds.y} L${bounds.x} ${bounds.y + bounds.height} L${bounds.x + 8} ${bounds.y + bounds.height}`;
    const path = `<path d="${bracket}" fill="none" stroke="${theme.colors.nodeStroke}" stroke-width="${STROKE_TASK}" />`;
    const label = text
        ? `<text x="${bounds.x + 12}" y="${bounds.y + bounds.height / 2}" text-anchor="start" dominant-baseline="middle" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" fill="${theme.colors.nodeText}">${xmlEscape(text)}</text>`
        : "";
    return `<g data-doodles-bpmn-annotation="${xmlEscape(id)}">${path}${label}</g>`;
}

// ── Flows ──────────────────────────────────────────────────────────────────

function renderFlows(diagram: BpmnDiagram, theme: ThemeTokens): string {
    const parts: string[] = [];
    for (const flow of Object.values(diagram.flows)) {
        const placement = diagram.flowPlacements[flow.id];
        if (!placement || placement.waypoints.length < 2) continue;
        parts.push(renderFlow(flow, placement, theme));
    }
    return parts.join("");
}

function renderFlow(flow: BpmnFlow, placement: BpmnFlowPlacement, theme: ThemeTokens): string {
    const path = polylinePath(placement.waypoints);
    const dash = dashForFlow(flow.kind);
    const dashAttr = dash ? ` stroke-dasharray="${dash}"` : "";
    const head = arrowHead(placement.waypoints, flow.kind, theme);
    const sourceMark = flow.kind === BpmnFlowKind.Message ? messageSourceCircle(placement.waypoints[0]!, theme) : "";
    const line = `<path d="${path}" fill="none" stroke="${theme.colors.edgeStroke}" stroke-width="${STROKE_FLOW_DEFAULT}"${dashAttr} />`;
    const label = flow.name ? flowLabel(flow.name, placement, theme) : "";
    return `<g data-doodles-bpmn-flow="${xmlEscape(flow.id)}">${line}${head}${sourceMark}${label}</g>`;
}

function dashForFlow(kind: BpmnFlowKind): string | undefined {
    if (kind === BpmnFlowKind.Message) return FLOW_MESSAGE_DASH;
    if (kind === BpmnFlowKind.Association) return FLOW_ASSOCIATION_DASH;
    return undefined;
}

function polylinePath(waypoints: Coordinate[]): string {
    return waypoints.map((p, i) => `${i === 0 ? "M" : "L"}${p.x} ${p.y}`).join(" ");
}

function arrowHead(waypoints: Coordinate[], kind: BpmnFlowKind, theme: ThemeTokens): string {
    const n = waypoints.length;
    if (n < 2) return "";
    const tip = waypoints[n - 1]!;
    const prev = waypoints[n - 2]!;
    const dx = tip.x - prev.x;
    const dy = tip.y - prev.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) return "";
    const ux = dx / len;
    const uy = dy / len;
    const baseX = tip.x - ux * FLOW_ARROW_HEAD_LENGTH;
    const baseY = tip.y - uy * FLOW_ARROW_HEAD_LENGTH;
    const leftX = baseX + uy * FLOW_ARROW_HEAD_HALF_WIDTH;
    const leftY = baseY - ux * FLOW_ARROW_HEAD_HALF_WIDTH;
    const rightX = baseX - uy * FLOW_ARROW_HEAD_HALF_WIDTH;
    const rightY = baseY + ux * FLOW_ARROW_HEAD_HALF_WIDTH;
    const isOpen = kind !== BpmnFlowKind.Sequence;
    const fill = isOpen ? "none" : theme.colors.edgeStroke;
    return `<polygon points="${tip.x},${tip.y} ${leftX},${leftY} ${rightX},${rightY}" fill="${fill}" stroke="${theme.colors.edgeStroke}" stroke-width="${STROKE_FLOW_DEFAULT}" />`;
}

function messageSourceCircle(start: Coordinate, theme: ThemeTokens): string {
    return `<circle cx="${start.x}" cy="${start.y}" r="${FLOW_MESSAGE_SOURCE_CIRCLE_RADIUS}" fill="${theme.colors.background === "transparent" ? "white" : theme.colors.background}" stroke="${theme.colors.edgeStroke}" stroke-width="${STROKE_FLOW_DEFAULT}" />`;
}

function flowLabel(name: string, placement: BpmnFlowPlacement, theme: ThemeTokens): string {
    const mid = midpointOf(placement.waypoints);
    return `<text x="${mid.x}" y="${mid.y + FLOW_LABEL_DY}" text-anchor="middle" dominant-baseline="auto" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" fill="${theme.colors.edgeText}">${xmlEscape(name)}</text>`;
}

function midpointOf(waypoints: Coordinate[]): Coordinate {
    if (waypoints.length === 0) return {x: 0, y: 0};
    if (waypoints.length === 1) return waypoints[0]!;
    const mid = Math.floor(waypoints.length / 2);
    const a = waypoints[mid - 1]!;
    const b = waypoints[mid]!;
    return {x: (a.x + b.x) / 2, y: (a.y + b.y) / 2};
}

// ── Labels ─────────────────────────────────────────────────────────────────

function renderCenteredLabelInside(text: string, bounds: Bounds, theme: ThemeTokens): string {
    const cx = bounds.x + bounds.width / 2;
    const cy = bounds.y + bounds.height / 2;
    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="middle" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" fill="${theme.colors.nodeText}">${xmlEscape(text)}</text>`;
}

function renderCenteredLabelBelow(text: string, cx: number, belowY: number, theme: ThemeTokens): string {
    return `<text x="${cx}" y="${belowY + TASK_LABEL_INSET + theme.font.size}" text-anchor="middle" dominant-baseline="middle" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" fill="${theme.colors.nodeText}">${xmlEscape(text)}</text>`;
}

// ── Kind predicates ────────────────────────────────────────────────────────

function isEventKind(kind: BpmnNode["kind"]): boolean {
    return kind === BpmnElementKind.StartEvent
        || kind === BpmnElementKind.EndEvent
        || kind === BpmnElementKind.IntermediateThrowEvent
        || kind === BpmnElementKind.IntermediateCatchEvent;
}

function isActivityKind(kind: BpmnNode["kind"]): boolean {
    return kind === BpmnElementKind.Task
        || kind === BpmnElementKind.UserTask
        || kind === BpmnElementKind.ServiceTask
        || kind === BpmnElementKind.Subprocess
        || kind === BpmnElementKind.CallActivity;
}

function isGatewayKind(kind: BpmnNode["kind"]): boolean {
    return kind === BpmnElementKind.ExclusiveGateway
        || kind === BpmnElementKind.ParallelGateway
        || kind === BpmnElementKind.InclusiveGateway
        || kind === BpmnElementKind.EventBasedGateway;
}

function collectNodesByKind(diagram: BpmnDiagram, kind: BpmnElementKind): BpmnNode[] {
    return Object.values(diagram.nodes).filter(n => n.kind === kind);
}
