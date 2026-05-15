import {ElementType, FlowchartNodeKind, PortAlignment, type Bounds} from "@benkalegin/doodles-core";
import {defaultLightTheme, type ThemeTokens} from "./theme.js";
import {xmlEscape} from "./escape.js";
import {parseRichText, richTextSvg} from "./text.js";

export {type ThemeTokens, defaultLightTheme, defaultDarkTheme} from "./theme.js";

/**
 * Shape of a laid-out Doodle the SVG renderer consumes. Matches what the
 * Mermaid importer emits (loose elements map + per-id bounds and ports).
 */
export interface RenderableDoodle {
    display: { width: number; height: number };
    nodes: { [id: string]: { bounds: Bounds } };
    ports?: { [id: string]: { alignment?: PortAlignment; edgePosRatio?: number } };
    elements: { [id: string]: any };
}

export interface RenderOptions {
    theme?: ThemeTokens;
    /** Extra padding around the diagram bounding box (added to viewBox). Defaults to 24. */
    padding?: number;
}

/**
 * Render a laid-out Doodle to an SVG string. Currently supports flowchart-
 * shaped kinds (Process, Decision, Terminator, InputOutput, MindMapTopic,
 * C4 variants). Class compartments, sequence, gantt, etc. are deferred.
 */
export function renderSvg(diagram: RenderableDoodle, options: RenderOptions = {}): string {
    const theme = options.theme ?? defaultLightTheme;
    const padding = options.padding ?? 24;

    const width = diagram.display.width;
    const height = diagram.display.height;
    const viewBox = `${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`;

    const layers: string[] = [];

    // Clusters first (rendered behind nodes).
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.Cluster) continue;
        const bounds = diagram.nodes[el.id]?.bounds;
        if (!bounds) continue;
        layers.push(renderCluster(bounds, String(el.text ?? ""), theme));
    }

    // Nodes.
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.ClassNode) continue;
        const bounds = diagram.nodes[el.id]?.bounds;
        if (!bounds) continue;
        layers.push(renderNode(el, bounds, theme));
    }

    // Edges last (on top of nodes).
    const arrowMarker = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${theme.colors.edgeStroke}" /></marker></defs>`;
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.ClassLink) continue;
        const segment = computeEdgeSegment(el, diagram);
        if (!segment) continue;
        layers.push(renderEdge(segment, String(el.text ?? ""), theme));
    }

    const bg = theme.colors.background !== "transparent"
        ? `<rect x="${-padding}" y="${-padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="${theme.colors.background}" />`
        : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width + padding * 2}" height="${height + padding * 2}">${bg}${arrowMarker}${layers.join("")}</svg>`;
}

// ── Cluster ──────────────────────────────────────────────────────────────────

const CLUSTER_LABEL_HEIGHT = 22;
const CLUSTER_RX = 6;

// Subtle fill opacities for neutral (currentColor) fills. The exact values
// match the original transparent-overlay look (~0x33 alpha for headers, ~0x10
// for bodies on top of any host background).
const NEUTRAL_NODE_FILL_OPACITY = 0.06;
const NEUTRAL_CLUSTER_FILL_OPACITY = 0.04;
const NEUTRAL_CLUSTER_HEADER_OPACITY = 0.08;

// Convert a paint value into SVG attrs. A `transparent` fill becomes a faint
// `currentColor` overlay so neutral nodes/clusters get a visible backdrop on
// any host background. Concrete colors pass through unchanged.
function fillAttrs(rawFill: string, neutralOpacity: number): string {
    if (rawFill === "transparent") {
        return `fill="currentColor" fill-opacity="${neutralOpacity}"`;
    }
    return `fill="${rawFill}"`;
}

// Path for a rect with rounded top corners and square bottom — used for the
// cluster header strip so it sits flush against the parent's rounded outline.
function topRoundedRectPath(x: number, y: number, w: number, h: number, rx: number): string {
    return `M${x + rx},${y} L${x + w - rx},${y} Q${x + w},${y} ${x + w},${y + rx} L${x + w},${y + h} L${x},${y + h} L${x},${y + rx} Q${x},${y} ${x + rx},${y} Z`;
}

function renderCluster(b: Bounds, label: string, theme: ThemeTokens): string {
    const bodyFill = fillAttrs(theme.colors.compoundFill, NEUTRAL_CLUSTER_FILL_OPACITY);
    const rect = `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${CLUSTER_RX}" ${bodyFill} stroke="${theme.colors.compoundStroke}" />`;
    // Header strip — only emitted for neutral clusters; an explicit compoundFill
    // already provides its own backdrop and adding more would muddy it.
    const header = theme.colors.compoundFill === "transparent" && label
        ? `<path d="${topRoundedRectPath(b.x, b.y, b.width, CLUSTER_LABEL_HEIGHT, CLUSTER_RX)}" fill="currentColor" fill-opacity="${NEUTRAL_CLUSTER_HEADER_OPACITY}" />`
        : "";
    const labelText = label
        ? `<text x="${b.x + b.width / 2}" y="${b.y + CLUSTER_LABEL_HEIGHT / 2 + 4}" text-anchor="middle" dominant-baseline="central" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" font-weight="bold" fill="${theme.colors.compoundLabel}">${xmlEscape(label)}</text>`
        : "";
    return rect + header + labelText;
}

// ── Node ─────────────────────────────────────────────────────────────────────

function renderNode(el: any, b: Bounds, theme: ThemeTokens): string {
    const kind: FlowchartNodeKind = el.flowchartKind ?? FlowchartNodeKind.Process;
    const fill = el.colorSchema?.fillColor ?? theme.colors.nodeFill;
    const stroke = el.colorSchema?.strokeColor ?? theme.colors.nodeStroke;
    const textColor = el.colorSchema?.textColor ?? theme.colors.nodeText;

    const shape = nodeShape(kind, b, fill, stroke);
    const text = renderNodeText(el, b, theme, textColor);
    return shape + text;
}

function nodeShape(kind: FlowchartNodeKind, b: Bounds, fill: string, stroke: string): string {
    const paint = fillAttrs(fill, NEUTRAL_NODE_FILL_OPACITY);
    if (kind === FlowchartNodeKind.Decision) {
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const points = `${cx},${b.y} ${b.x + b.width},${cy} ${cx},${b.y + b.height} ${b.x},${cy}`;
        return `<polygon points="${points}" ${paint} stroke="${stroke}" />`;
    }
    if (kind === FlowchartNodeKind.InputOutput) {
        const skew = Math.min(b.width * 0.18, 22);
        const points = `${b.x + skew},${b.y} ${b.x + b.width},${b.y} ${b.x + b.width - skew},${b.y + b.height} ${b.x},${b.y + b.height}`;
        return `<polygon points="${points}" ${paint} stroke="${stroke}" />`;
    }
    const isTerminator = kind === FlowchartNodeKind.Terminator;
    const isC4 = kind === FlowchartNodeKind.C4Person
        || kind === FlowchartNodeKind.C4System
        || kind === FlowchartNodeKind.C4Container
        || kind === FlowchartNodeKind.C4Component;
    const isMindMap = kind === FlowchartNodeKind.MindMapTopic;
    const cornerRadius = isMindMap
        ? Math.min(b.height * 0.4, b.width * 0.25)
        : isTerminator ? 26 : (isC4 ? 10 : 4);
    const dashAttr = isC4 ? ` stroke-dasharray="6 3"` : "";
    return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${cornerRadius}" ${paint} stroke="${stroke}"${dashAttr} />`;
}

function renderNodeText(el: any, b: Bounds, theme: ThemeTokens, color: string): string {
    const raw = String(el.text ?? "");
    if (!raw) return "";
    const lines = parseRichText(raw);
    return richTextSvg(
        lines,
        b.x + b.width / 2,
        b.y + b.height / 2,
        theme.font.family,
        theme.font.size,
        theme.font.lineHeight,
        color
    );
}

// ── Edge ─────────────────────────────────────────────────────────────────────

interface EdgeSegment {
    from: { x: number; y: number };
    to: { x: number; y: number };
}

function computeEdgeSegment(link: any, d: RenderableDoodle): EdgeSegment | undefined {
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
    const from = portPosition(fromBounds, p1Pos);
    const to = portPosition(toBounds, p2Pos);
    return {from, to};
}

function portPosition(bounds: Bounds, port: { alignment?: PortAlignment; edgePosRatio?: number } | undefined): { x: number; y: number } {
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

function renderEdge(segment: EdgeSegment, label: string, theme: ThemeTokens): string {
    // Simple orthogonal: down-then-right (or left-then-down) midpoint Z route.
    const {from, to} = segment;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    let pathD: string;
    if (Math.abs(dx) < 1 || Math.abs(dy) < 1) {
        pathD = `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
    } else if (Math.abs(dy) > Math.abs(dx)) {
        const midY = from.y + dy / 2;
        pathD = `M ${from.x} ${from.y} L ${from.x} ${midY} L ${to.x} ${midY} L ${to.x} ${to.y}`;
    } else {
        const midX = from.x + dx / 2;
        pathD = `M ${from.x} ${from.y} L ${midX} ${from.y} L ${midX} ${to.y} L ${to.x} ${to.y}`;
    }
    const path = `<path d="${pathD}" fill="none" stroke="${theme.colors.edgeStroke}" stroke-width="1.5" marker-end="url(#arrow)" />`;
    if (!label) return path;

    const midX = (from.x + to.x) / 2;
    const midY = (from.y + to.y) / 2;
    const labelLines = parseRichText(label);
    const labelSvg = richTextSvg(
        labelLines,
        midX,
        midY,
        theme.font.family,
        theme.font.size,
        theme.font.lineHeight,
        theme.colors.edgeText
    );
    return path + labelSvg;
}
