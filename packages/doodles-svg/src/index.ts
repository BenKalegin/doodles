import {ElementType, FlowchartNodeKind, PortAlignment, type Bounds, type Coordinate} from "@benkalegin/doodles-core";
import {defaultLightTheme, type ThemeTokens} from "./theme.js";
import {xmlEscape} from "./escape.js";
import {parseRichText, richTextSvg} from "./text.js";
import {routeEdges, type EdgeRoute} from "./routing.js";

export {type ThemeTokens, defaultLightTheme, defaultDarkTheme} from "./theme.js";
export {type EdgeRoute, routeEdges} from "./routing.js";
export {type SequenceRenderOptions, renderSequenceSvg} from "./sequence.js";
export {type ChartRenderOptions, renderChartSvg} from "./chart.js";
export {type BpmnRenderOptions, renderBpmnSvg} from "./bpmn.js";

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
    for (const route of routeEdges(diagram, theme)) {
        layers.push(renderEdge(route, theme));
    }

    const bg = theme.colors.background !== "transparent"
        ? `<rect x="${-padding}" y="${-padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="${theme.colors.background}" />`
        : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" class="doodles-svg doodles-svg-structure" viewBox="${viewBox}" width="${width + padding * 2}" height="${height + padding * 2}">${bg}${arrowMarker}${layers.join("")}</svg>`;
}

// ── Cluster ──────────────────────────────────────────────────────────────────

const CLUSTER_LABEL_HEIGHT = 28;
const CLUSTER_RX = 6;

// Subtle fill opacities for neutral (currentColor) fills. The exact values
// match the original transparent-overlay look (~0x33 alpha for headers, ~0x10
// for bodies on top of any host background).
const NEUTRAL_NODE_FILL_OPACITY = 0.06;
const NEUTRAL_CLUSTER_FILL_OPACITY = 0.04;
const NEUTRAL_CLUSTER_HEADER_OPACITY = 0.08;
// Explicit (Mermaid `style ... fill:#xxx`) colors render as tinted halos
// rather than solid blocks so dark fills stay legible on dark canvases and
// light fills stay legible on light ones. Pick somewhere between "I can tell
// the color" (~0.15) and "it's a solid block" (1.0).
const EXPLICIT_NODE_FILL_OPACITY = 0.22;

// Eight-character hex (#rrggbbaa) and rgba()/hsla() already encode their own
// alpha — applying our explicit-opacity on top would double-multiply and make
// the color virtually invisible.
const HEX_WITH_ALPHA = /^#[0-9a-f]{8}$/i;
const COLOR_WITH_ALPHA = /^(rgba|hsla)\s*\(/i;

function hasBuiltInAlpha(color: string): boolean {
    return HEX_WITH_ALPHA.test(color) || COLOR_WITH_ALPHA.test(color);
}

// Convert a paint value into SVG attrs. A `transparent` fill becomes a faint
// `currentColor` overlay so neutral nodes/clusters get a visible backdrop on
// any host background. Explicit colors render at reduced opacity so they
// behave as tints rather than solid blocks — unless the color already carries
// its own alpha channel, in which case the author already chose the strength.
function fillAttrs(rawFill: string, neutralOpacity: number, explicitOpacity = 1): string {
    if (rawFill === "transparent") {
        return `fill="currentColor" fill-opacity="${neutralOpacity}"`;
    }
    if (explicitOpacity >= 1 || hasBuiltInAlpha(rawFill)) return `fill="${rawFill}"`;
    return `fill="${rawFill}" fill-opacity="${explicitOpacity}"`;
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
        ? `<text x="${b.x + b.width / 2}" y="${b.y + CLUSTER_LABEL_HEIGHT / 2}" text-anchor="middle" dominant-baseline="central" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" font-weight="bold" fill="${theme.colors.compoundLabel}">${xmlEscape(label)}</text>`
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
    const body = shape + text;

    // Expose the source-format node id (e.g. the Mermaid node name) so hosts can
    // wire source-level interactions like `click A "url"` to the rendered node.
    const sourceId = el.sourceId;
    if (typeof sourceId !== "string" || sourceId.length === 0) return body;
    return `<g data-node-id="${xmlEscape(sourceId)}">${body}</g>`;
}

// Node outline thickness — matches edge stroke so the diagram reads as a
// single visual weight. SVG default of 1 looked too thin on neutral
// (currentColor) strokes against dark hosts.
const NODE_STROKE_WIDTH = 1.5;

function nodeShape(kind: FlowchartNodeKind, b: Bounds, fill: string, stroke: string): string {
    const paint = fillAttrs(fill, NEUTRAL_NODE_FILL_OPACITY, EXPLICIT_NODE_FILL_OPACITY);
    const sw = `stroke-width="${NODE_STROKE_WIDTH}"`;
    if (kind === FlowchartNodeKind.Decision) {
        const cx = b.x + b.width / 2;
        const cy = b.y + b.height / 2;
        const points = `${cx},${b.y} ${b.x + b.width},${cy} ${cx},${b.y + b.height} ${b.x},${cy}`;
        return `<polygon points="${points}" ${paint} stroke="${stroke}" ${sw} />`;
    }
    if (kind === FlowchartNodeKind.InputOutput) {
        const skew = Math.min(b.width * 0.18, 22);
        const points = `${b.x + skew},${b.y} ${b.x + b.width},${b.y} ${b.x + b.width - skew},${b.y + b.height} ${b.x},${b.y + b.height}`;
        return `<polygon points="${points}" ${paint} stroke="${stroke}" ${sw} />`;
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
    return `<rect x="${b.x}" y="${b.y}" width="${b.width}" height="${b.height}" rx="${cornerRadius}" ${paint} stroke="${stroke}" ${sw}${dashAttr} />`;
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

// Width of the stroke halo behind edge labels. Wide enough to mask a 1.5px
// edge line + arrow shaft when the host supplies a canvas color via the
// `--doodles-label-halo` CSS variable.
const LABEL_HALO_STROKE_WIDTH = 4;

function renderEdge(route: EdgeRoute, theme: ThemeTokens): string {
    const pathD = polylineToPathD(route.polyline);
    const path = `<path d="${pathD}" fill="none" stroke="${theme.colors.edgeStroke}" stroke-width="1.5" marker-end="url(#arrow)" />`;
    if (!route.label || !route.labelBox) return path;

    const cx = route.labelBox.x + route.labelBox.width / 2;
    const cy = route.labelBox.y + route.labelBox.height / 2;
    const labelLines = parseRichText(route.label);
    const labelSvg = richTextSvg(
        labelLines,
        cx,
        cy,
        theme.font.family,
        theme.font.size,
        theme.font.lineHeight,
        theme.colors.edgeText,
        {haloStrokeWidth: LABEL_HALO_STROKE_WIDTH}
    );
    return path + labelSvg;
}

export function polylineToPathD(points: readonly Coordinate[]): string {
    if (points.length === 0) return "";
    const head = points[0]!;
    const rest = points.slice(1).map(p => `L ${p.x} ${p.y}`).join(" ");
    return rest ? `M ${head.x} ${head.y} ${rest}` : `M ${head.x} ${head.y}`;
}
