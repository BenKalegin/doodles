import type {Diagram} from "@benkalegin/doodles-core";
import {ElementType, FlowchartNodeKind, LayoutDirection, PortAlignment} from "@benkalegin/doodles-core";
import type {ClusterDef, LayoutHints, LayoutLink, LayoutNode, OrderHint} from "./autoLayout.js";
import {computeDisplaySize} from "./autoLayout.js";
import {applyFiligreeLayout} from "./filigreeLayout.js";

interface DiagramInternal {
    elements: { [id: string]: any };
    nodes: { [id: string]: { bounds: { x: number; y: number; width: number; height: number } } };
    ports: { [id: string]: { alignment?: PortAlignment; edgePosRatio?: number } };
    display: { width: number; height: number; scale: number; offset: { x: number; y: number } };
}

const STRUCTURE_DIAGRAM_TYPES = new Set([
    ElementType.ClassDiagram,
    ElementType.FlowchartDiagram,
    ElementType.DeploymentDiagram
]);

export function canRelayoutStructure(diagram: Diagram | { type: ElementType }): boolean {
    return STRUCTURE_DIAGRAM_TYPES.has(diagram.type);
}

/**
 * Re-layout a structure-style diagram (class / flowchart / deployment).
 * Callers pass any pre-parsed `LayoutHints` (direction, spacing) — doodles
 * makes no assumption about where they came from (Mermaid frontmatter, user
 * preference, default, …).
 */
export async function relayoutStructure<T extends Diagram>(
    diagram: T,
    hints?: LayoutHints
): Promise<T> {
    const dia = diagram as unknown as Diagram & DiagramInternal;
    if (!dia.elements || !dia.nodes) return diagram;

    const resolvedHints = hints ?? {};

    const clusters: { [id: string]: ClusterDef } = {};
    const nodeParents: { [id: string]: string } = {};
    const clusterParents: { [id: string]: string } = {};
    for (const el of Object.values(dia.elements)) {
        if (el?.type !== ElementType.Cluster) continue;
        clusters[el.id] = {label: el.text ?? el.id};
        for (const memberId of el.memberNodeIds ?? []) {
            const member = dia.elements[memberId];
            if (member?.type === ElementType.Cluster) clusterParents[memberId] = el.id;
            else nodeParents[memberId] = el.id;
        }
    }

    const layoutNodes: { [id: string]: LayoutNode } = {};
    for (const el of Object.values(dia.elements)) {
        if (el?.type !== ElementType.ClassNode) continue;
        const nb = dia.nodes[el.id];
        if (!nb?.bounds) continue;
        layoutNodes[el.id] = {bounds: {...nb.bounds}};
    }
    if (Object.keys(layoutNodes).length === 0) return diagram;

    const edges: LayoutLink[] = [];
    for (const el of Object.values(dia.elements)) {
        if (el?.type !== ElementType.ClassLink) continue;
        const p1 = dia.elements[el.port1];
        const p2 = dia.elements[el.port2];
        if (!p1 || !p2) continue;
        if (!layoutNodes[p1.nodeId] || !layoutNodes[p2.nodeId]) continue;
        edges.push({source: p1.nodeId, target: p2.nodeId});
    }

    const targetsBySource = new Map<string, string[]>();
    for (const edge of edges) {
        const list = targetsBySource.get(edge.source);
        if (list) list.push(edge.target);
        else targetsBySource.set(edge.source, [edge.target]);
    }
    const orderHints: OrderHint[] = [];
    for (const targets of targetsBySource.values()) {
        for (let i = 1; i < targets.length; i++) {
            orderHints.push({before: targets[i - 1]!, after: targets[i]!});
        }
    }

    const clusterBoundsById = await applyFiligreeLayout(
        layoutNodes, edges, resolvedHints, clusters, nodeParents, clusterParents, orderHints
    );

    const newNodes: DiagramInternal["nodes"] = {...dia.nodes};
    for (const [id, ln] of Object.entries(layoutNodes)) {
        newNodes[id] = {...newNodes[id], bounds: {...ln.bounds}};
    }
    for (const [cid, bounds] of Object.entries(clusterBoundsById)) {
        newNodes[cid] = {...newNodes[cid], bounds};
    }

    const excludeFromWrapping = new Set<string>([
        ...Object.keys(clusters),
        ...Object.keys(nodeParents),
    ]);
    wrapLongLayoutsIntoRows(newNodes, resolvedHints, excludeFromWrapping);

    const realignedPorts = adjustPortAlignments(dia, newNodes, resolvedHints);
    const newPorts = distributePortsAlongSides(dia, realignedPorts, newNodes);

    const {width, height} = computeDisplaySize(newNodes);

    return {
        ...diagram,
        nodes: newNodes,
        ports: newPorts,
        display: {
            ...dia.display,
            width,
            height,
            offset: {x: 0, y: 0}
        }
    } as T;
}

interface LinkAssignment {
    port1: string;
    port2: string;
    srcNodeId: string;
    tgtNodeId: string;
    srcAlign: PortAlignment;
    tgtAlign: PortAlignment;
    dx: number;
    dy: number;
}

// Cap on how many columns a single LR / RL row should hold before the layout
// folds into a second (or third) row. Cyclic flowcharts can produce arbitrary
// chain lengths after cycle-breaking; without this they render as one extreme-
// width strip. The default 5 keeps "typical" flowcharts on a single line while
// folding longer chains. Caller can override via `hints.maxColsPerRow`.
const DEFAULT_MAX_COLS_PER_ROW = 5;
// Gap inserted between wrapped rows. Larger than nodeSep so the row break is
// visually unambiguous.
const ROW_GAP_PX = 120;
// Two layer X positions within `LAYER_X_EPSILON_PX` are treated as the same
// column. Filigree centers nodes within a layer, so widths can shift the X by
// a pixel or two even when they're nominally in the same layer.
const LAYER_X_EPSILON_PX = 4;

/**
 * Fold a wide LR / RL layout into multiple rows once it exceeds the column
 * cap. Walks the unique x-coordinates produced by filigree (each is a layer),
 * partitions them into rows, then rewrites every node's (x, y) so it lands in
 * its new (col, row) slot. Edge routing is recomputed at render time so the
 * cross-row edges automatically re-shape.
 *
 * No-op for vertical layouts and for short layouts that fit in one row.
 *
 * `excludeIds` lists clusters and their members. Filigree lays out compound
 * nodes independently from the root flow, so their x positions don't belong
 * in the root's column lattice — including them collapses `colWidth` to the
 * intra-cluster padding gap and stacks every root node on top of each other.
 */
function wrapLongLayoutsIntoRows(
    nodes: DiagramInternal["nodes"],
    hints: LayoutHints,
    excludeIds: ReadonlySet<string>,
): void {
    const horizontal = hints.direction === LayoutDirection.LeftToRight
        || hints.direction === LayoutDirection.RightToLeft;
    if (!horizontal) return;
    const maxCols = hints.maxColsPerRow ?? DEFAULT_MAX_COLS_PER_ROW;
    if (maxCols <= 0) return;

    const entries = Object.entries(nodes).filter(([id, n]) => n?.bounds && !excludeIds.has(id));
    if (entries.length === 0) return;

    const uniqueXs = collapseToColumns(entries.map(([, n]) => n.bounds!.x));
    if (uniqueXs.length <= maxCols) return;

    const xToCol = new Map<number, number>();
    for (let i = 0; i < uniqueXs.length; i++) xToCol.set(uniqueXs[i]!, i);

    const colWidth = uniqueXs.length > 1 ? (uniqueXs[1]! - uniqueXs[0]!) : 0;
    const baseX = uniqueXs[0]!;
    const baseY = Math.min(...entries.map(([, n]) => n.bounds!.y));

    // Pre-compute the max height for each row so cumulative Y respects the
    // tallest node in each row (heights vary — decision nodes, multi-line
    // labels, etc).
    const rowHeights = new Map<number, number>();
    for (const [, n] of entries) {
        const b = n.bounds!;
        const colIndex = nearestColIndex(b.x, uniqueXs);
        const row = Math.floor(colIndex / maxCols);
        rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, b.height));
    }
    const rowOffsets = new Map<number, number>();
    let cumulative = 0;
    const rowCount = Math.ceil(uniqueXs.length / maxCols);
    for (let r = 0; r < rowCount; r++) {
        rowOffsets.set(r, cumulative);
        cumulative += (rowHeights.get(r) ?? 0) + ROW_GAP_PX;
    }

    for (const [, n] of entries) {
        const b = n.bounds!;
        const colIndex = nearestColIndex(b.x, uniqueXs);
        const row = Math.floor(colIndex / maxCols);
        const col = colIndex % maxCols;
        b.x = baseX + col * colWidth;
        b.y = baseY + (rowOffsets.get(row) ?? 0);
    }
}

function collapseToColumns(xs: readonly number[]): number[] {
    const sorted = [...xs].sort((a, b) => a - b);
    const unique: number[] = [];
    for (const x of sorted) {
        if (unique.length === 0 || x - unique[unique.length - 1]! > LAYER_X_EPSILON_PX) {
            unique.push(x);
        }
    }
    return unique;
}

function nearestColIndex(x: number, sortedXs: readonly number[]): number {
    let best = 0;
    let bestDiff = Math.abs(x - sortedXs[0]!);
    for (let i = 1; i < sortedXs.length; i++) {
        const diff = Math.abs(x - sortedXs[i]!);
        if (diff < bestDiff) {
            bestDiff = diff;
            best = i;
        }
    }
    return best;
}

function adjustPortAlignments(
    dia: Diagram & DiagramInternal,
    newNodes: DiagramInternal["nodes"],
    hints: LayoutHints
): DiagramInternal["ports"] {
    const assignments: LinkAssignment[] = [];

    for (const el of Object.values(dia.elements)) {
        if (el?.type !== ElementType.ClassLink) continue;
        const p1 = dia.elements[el.port1];
        const p2 = dia.elements[el.port2];
        if (!p1 || !p2) continue;
        const sb = newNodes[p1.nodeId]?.bounds;
        const tb = newNodes[p2.nodeId]?.bounds;
        if (!sb || !tb) continue;
        const sx = sb.x + sb.width / 2;
        const sy = sb.y + sb.height / 2;
        const tx = tb.x + tb.width / 2;
        const ty = tb.y + tb.height / 2;
        const dx = tx - sx;
        const dy = ty - sy;
        const vertical = hints.direction === LayoutDirection.TopToBottom
            || hints.direction === LayoutDirection.BottomToTop;
        const reversed = hints.direction === LayoutDirection.BottomToTop
            || hints.direction === LayoutDirection.RightToLeft;
        let srcAlign: PortAlignment;
        let tgtAlign: PortAlignment;
        // In directional layouts the natural axis follows the flow, not the
        // larger of |dx|/|dy|. Picking sideways alignment when target is below
        // a source produced edges that re-entered the source bbox. Back-edges
        // land on a cross-axis face so they don't share the forward-edge port
        // and so the U-detour has an obstacle-free face to enter through.
        if (vertical) {
            const forward = reversed ? dy <= 0 : dy >= 0;
            srcAlign = forward
                ? (reversed ? PortAlignment.Top : PortAlignment.Bottom)
                : (reversed ? PortAlignment.Bottom : PortAlignment.Top);
            tgtAlign = forward
                ? (reversed ? PortAlignment.Bottom : PortAlignment.Top)
                : PortAlignment.Left;
        } else {
            const forward = reversed ? dx <= 0 : dx >= 0;
            srcAlign = forward
                ? (reversed ? PortAlignment.Left : PortAlignment.Right)
                : (reversed ? PortAlignment.Right : PortAlignment.Left);
            tgtAlign = forward
                ? (reversed ? PortAlignment.Right : PortAlignment.Left)
                : PortAlignment.Top;
        }
        assignments.push({
            port1: el.port1, port2: el.port2,
            srcNodeId: p1.nodeId, tgtNodeId: p2.nodeId,
            srcAlign, tgtAlign, dx, dy
        });
    }

    applyDecisionNodeConvention(dia, assignments, hints);

    const ports: DiagramInternal["ports"] = {...dia.ports};
    for (const a of assignments) {
        const sp = ports[a.port1];
        const tp = ports[a.port2];
        if (sp) ports[a.port1] = {...sp, alignment: a.srcAlign};
        if (tp) ports[a.port2] = {...tp, alignment: a.tgtAlign};
    }
    return ports;
}

// A row-wrapped LR layout puts some targets directly below their source. Any
// |dy| past this threshold (roughly half of a typical row height) is treated
// as "different row" and the Decision-convention switches the source face to
// the perpendicular axis so the edge exits toward the target row instead of
// looping the long way around the diagram.
const CROSS_ROW_DY_THRESHOLD_PX = 40;

function applyDecisionNodeConvention(
    dia: Diagram & DiagramInternal,
    assignments: LinkAssignment[],
    hints: LayoutHints
): void {
    const vertical = hints.direction === LayoutDirection.TopToBottom
        || hints.direction === LayoutDirection.BottomToTop;
    const inputSide = vertical ? PortAlignment.Top : PortAlignment.Left;
    const mainOutputSide = vertical ? PortAlignment.Bottom : PortAlignment.Right;

    const incomingByNode: { [nodeId: string]: LinkAssignment[] } = {};
    const outgoingByNode: { [nodeId: string]: LinkAssignment[] } = {};
    for (const a of assignments) {
        (outgoingByNode[a.srcNodeId] ??= []).push(a);
        (incomingByNode[a.tgtNodeId] ??= []).push(a);
    }

    for (const el of Object.values(dia.elements)) {
        if (el?.type !== ElementType.ClassNode) continue;
        if (el.flowchartKind !== FlowchartNodeKind.Decision) continue;

        for (const a of incomingByNode[el.id] ?? []) a.tgtAlign = inputSide;
        // Outgoing branches share the main output face — distribution along
        // that face (port ratios) is left to distributePortsAlongSides. The
        // exception is row-wrapped LR layouts: when a target sits in a
        // different row, exiting on the cross-axis (Bottom or Top) gives a
        // direct V-H-V route instead of a giant U-detour around the diagram.
        for (const a of outgoingByNode[el.id] ?? []) {
            a.srcAlign = decisionOutputFace(a, vertical, mainOutputSide);
        }
    }
}

function decisionOutputFace(
    a: LinkAssignment,
    vertical: boolean,
    mainOutputSide: PortAlignment,
): PortAlignment {
    if (vertical) {
        // TB / BT: cross-axis targets (different column at similar y) keep the
        // main output face; the edge router fans them out via port ratios.
        return mainOutputSide;
    }
    // LR / RL: targets in a different row use the cross-axis face that points
    // toward the target row.
    if (Math.abs(a.dy) > CROSS_ROW_DY_THRESHOLD_PX) {
        return a.dy > 0 ? PortAlignment.Bottom : PortAlignment.Top;
    }
    return mainOutputSide;
}

function distributePortsAlongSides(
    diagram: Diagram & DiagramInternal,
    ports: DiagramInternal["ports"],
    nodes: DiagramInternal["nodes"]
): DiagramInternal["ports"] {
    const otherEndpointOf: { [portId: string]: string } = {};
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.ClassLink) continue;
        const p1 = diagram.elements[el.port1];
        const p2 = diagram.elements[el.port2];
        if (p1 && p2) {
            otherEndpointOf[el.port1] = p2.nodeId;
            otherEndpointOf[el.port2] = p1.nodeId;
        }
    }

    const groups: { [key: string]: string[] } = {};
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.ClassPort) continue;
        const port = ports[el.id];
        if (port?.alignment === undefined) continue;
        const key = `${el.nodeId}|${port.alignment}`;
        (groups[key] ??= []).push(el.id);
    }

    const result = {...ports};
    for (const [key, portIds] of Object.entries(groups)) {
        if (portIds.length <= 1) continue;
        const alignment = Number(key.split("|")[1]) as PortAlignment;
        const horizontal = alignment === PortAlignment.Top || alignment === PortAlignment.Bottom;
        portIds.sort((a, b) => {
            const oa = otherEndpointOf[a];
            const ob = otherEndpointOf[b];
            const ba = oa ? nodes[oa]?.bounds : undefined;
            const bb = ob ? nodes[ob]?.bounds : undefined;
            if (!ba || !bb) return 0;
            return horizontal
                ? (ba.x + ba.width / 2) - (bb.x + bb.width / 2)
                : (ba.y + ba.height / 2) - (bb.y + bb.height / 2);
        });
        const n = portIds.length;
        for (let i = 0; i < n; i++) {
            const ratio = ((i + 1) / (n + 1)) * 100;
            result[portIds[i]!] = {...result[portIds[i]!], edgePosRatio: ratio};
        }
    }
    return result;
}
