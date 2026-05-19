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
    alignChainsToForkRow(newNodes, edges, resolvedHints, nodeParents);

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

    // Per-column min-y and total layer span. Branched flowcharts put multiple
    // nodes in the same ELK layer (= same x); preserving their relative y
    // offsets keeps the branches visually distinct after wrapping. The row's
    // height is the tallest *layer*, not the tallest single node.
    const colMinY = new Map<number, number>();
    const colMaxBottom = new Map<number, number>();
    for (const [, n] of entries) {
        const b = n.bounds!;
        const colIndex = nearestColIndex(b.x, uniqueXs);
        const prevMin = colMinY.get(colIndex);
        colMinY.set(colIndex, prevMin === undefined ? b.y : Math.min(prevMin, b.y));
        const prevMax = colMaxBottom.get(colIndex);
        colMaxBottom.set(colIndex, prevMax === undefined ? b.y + b.height : Math.max(prevMax, b.y + b.height));
    }
    const rowHeights = new Map<number, number>();
    for (const [colIndex, minY] of colMinY) {
        const span = (colMaxBottom.get(colIndex) ?? minY) - minY;
        const row = Math.floor(colIndex / maxCols);
        rowHeights.set(row, Math.max(rowHeights.get(row) ?? 0, span));
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
        const offsetInLayer = b.y - (colMinY.get(colIndex) ?? b.y);
        b.x = baseX + col * colWidth;
        b.y = baseY + (rowOffsets.get(row) ?? 0) + offsetInLayer;
    }
}

/**
 * Pin linear chains hanging off forks to a shared y, so each chain reads as
 * one row. Filigree's layered algorithm centers each layer's nodes around the
 * edge-bend midline, which leaves single-occupant downstream layers free to
 * "recenter" — a chain `Cheshire → Caterpillar → Gryphon` ends up staircased
 * because each unconstrained node drifts back toward the trunk midline.
 *
 * Rule (see docs/layout-rules/linear-tail-after-fork.md):
 *   At every fork F (outdeg ≥ 2), the **first-declared** child stays on F's
 *   row (`first-child.y := F.y`), and that pinning propagates forward through
 *   the linear continuation. Non-first children start their own row at their
 *   own current y, and the chain from each one stays pinned to that y.
 *
 * "Linear continuation" = a forward walk through nodes that are both single-in
 * and single-out (terminals allowed at the tail). Stops at any merge or fork.
 *
 * Source-order matters: it's how the human author signaled "this branch is
 * the trunk continuation." `relayoutStructure` builds `edges` by iterating
 * `dia.elements` in insertion order, so `outEdges[forkId][0]` is the
 * first-declared child without any extra work.
 */
function alignChainsToForkRow(
    nodes: DiagramInternal["nodes"],
    edges: readonly LayoutLink[],
    hints: LayoutHints,
    nodeParents: { [id: string]: string },
): void {
    // Rule applies to horizontal flow only. In TB/BT layouts, "first-declared
    // child stays on fork's row" would collapse decision diamonds' below-target
    // semantics — both branches are supposed to go down from the decision, not
    // one stays on the row.
    const horizontal = hints.direction === LayoutDirection.LeftToRight
        || hints.direction === LayoutDirection.RightToLeft;
    if (!horizontal) return;

    // Cluster-internal nodes have their y constrained by the cluster's bbox.
    // Pinning across that boundary would move a member outside its cluster
    // without growing the cluster, breaking subgraph containment.
    const isClusterInternal = (id: string): boolean => nodeParents[id] !== undefined;

    const outEdges = new Map<string, string[]>();
    const inDeg = new Map<string, number>();
    for (const edge of edges) {
        const list = outEdges.get(edge.source);
        if (list) list.push(edge.target);
        else outEdges.set(edge.source, [edge.target]);
        inDeg.set(edge.target, (inDeg.get(edge.target) ?? 0) + 1);
    }
    for (const [forkId, children] of outEdges) {
        if (children.length < 2) continue;
        if (isClusterInternal(forkId)) continue;
        const forkY = nodes[forkId]?.bounds?.y;
        if (forkY === undefined) continue;
        pinChainToY(children[0]!, forkY, nodes, outEdges, inDeg, isClusterInternal);
        for (let i = 1; i < children.length; i++) {
            const child = children[i]!;
            if (isClusterInternal(child)) continue;
            const childY = nodes[child]?.bounds?.y;
            if (childY === undefined) continue;
            pinChainToY(child, childY, nodes, outEdges, inDeg, isClusterInternal);
        }
    }
}

function pinChainToY(
    start: string,
    targetY: number,
    nodes: DiagramInternal["nodes"],
    outEdges: Map<string, string[]>,
    inDeg: Map<string, number>,
    isClusterInternal: (id: string) => boolean,
): void {
    const visited = new Set<string>();
    let cur: string | undefined = start;
    while (cur && !visited.has(cur)) {
        visited.add(cur);
        if (isClusterInternal(cur)) break;
        const bounds = nodes[cur]?.bounds;
        if (!bounds) break;
        bounds.y = targetY;
        const out = outEdges.get(cur);
        if (!out || out.length !== 1) break;
        const next = out[0]!;
        if ((inDeg.get(next) ?? 0) !== 1) break;
        cur = next;
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
            // Back-edges in a TB/BT layout enter the target on Left so the
            // U-detour has a clear cross-axis face — Left is universally free
            // since the layered algorithm fills the principal axis (top↔bottom).
            tgtAlign = forward
                ? (reversed ? PortAlignment.Bottom : PortAlignment.Top)
                : PortAlignment.Left;
        } else {
            const forward = reversed ? dx <= 0 : dx >= 0;
            // Forward edges keep the natural in-flow face (Right→Left for LR,
            // Left→Right for RL). Back-edges exit on Top (away from the
            // principal axis so the route clears every node in source's row).
            // The target-face choice depends on whether source and target are
            // in the same row:
            //   - same-row → Top: 3-segment U over the row that enters target
            //     perpendicular to its top through the row gap.
            //   - cross-row → Left: cross-axis detour that enters perpendicular
            //     to target's left side. Different from same-row so multiple
            //     back-edges to one target don't all collapse onto the same
            //     "down at tgtOuter.left" channel and visually overlap.
            const sameRow = Math.abs(dy) <= CROSS_ROW_DY_THRESHOLD_PX;
            srcAlign = forward
                ? (reversed ? PortAlignment.Left : PortAlignment.Right)
                : PortAlignment.Top;
            tgtAlign = forward
                ? (reversed ? PortAlignment.Right : PortAlignment.Left)
                : (sameRow ? PortAlignment.Top : PortAlignment.Left);
        }
        assignments.push({
            port1: el.port1, port2: el.port2,
            srcNodeId: p1.nodeId, tgtNodeId: p2.nodeId,
            srcAlign, tgtAlign, dx, dy
        });
    }

    applyDecisionNodeConvention(dia, assignments, hints);
    applyCrossClusterExitFace(dia, newNodes, assignments, hints);

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

/**
 * Route cross-cluster outgoing edges via the perpendicular face when the source
 * also has intra-cluster forward successors blocking the main face.
 *
 * Without this, a node with both an in-cluster chain successor (e.g.,
 * `FastAPI app → RequestIdMiddleware`) and cross-cluster fan-out (e.g.,
 * `FastAPI app → R1..R9` in another cluster) exits all edges through the same
 * face, and the cross-cluster polylines re-enter the in-cluster siblings on the
 * way to their actual target. Switching the cross-cluster edges to the
 * perpendicular face gives them a clear path around the source's cluster.
 *
 * The preferred perpendicular face is chosen by target direction, but if a
 * cluster sibling shadows that face (would be crossed by an exit-then-traverse
 * polyline) we switch to the opposite perpendicular face. If both perpendicular
 * faces are shadowed, leave the assignment alone — better to render an ugly
 * forward-direction edge than to draw a useless detour through siblings.
 */
function applyCrossClusterExitFace(
    dia: Diagram & DiagramInternal,
    newNodes: DiagramInternal["nodes"],
    assignments: LinkAssignment[],
    hints: LayoutHints,
): void {
    const vertical = hints.direction === LayoutDirection.TopToBottom
        || hints.direction === LayoutDirection.BottomToTop;
    const reversed = hints.direction === LayoutDirection.BottomToTop
        || hints.direction === LayoutDirection.RightToLeft;
    const mainOutputSide = vertical
        ? (reversed ? PortAlignment.Top : PortAlignment.Bottom)
        : (reversed ? PortAlignment.Left : PortAlignment.Right);

    const nodeParents: { [id: string]: string } = {};
    const clusterMembers: { [clusterId: string]: string[] } = {};
    for (const el of Object.values(dia.elements)) {
        if (el?.type !== ElementType.Cluster) continue;
        for (const memberId of el.memberNodeIds ?? []) {
            const member = dia.elements[memberId];
            if (member?.type === ElementType.Cluster) continue;
            nodeParents[memberId] = el.id;
            (clusterMembers[el.id] ??= []).push(memberId);
        }
    }

    const outgoingByNode: { [id: string]: LinkAssignment[] } = {};
    for (const a of assignments) {
        (outgoingByNode[a.srcNodeId] ??= []).push(a);
    }

    for (const [srcId, outgoing] of Object.entries(outgoingByNode)) {
        const srcCluster = nodeParents[srcId];
        if (!srcCluster) continue;
        const hasIntraClusterOnMainFace = outgoing.some(a =>
            nodeParents[a.tgtNodeId] === srcCluster && a.srcAlign === mainOutputSide
        );
        if (!hasIntraClusterOnMainFace) continue;

        const srcBounds = newNodes[srcId]?.bounds;
        if (!srcBounds) continue;
        const siblings = (clusterMembers[srcCluster] ?? [])
            .filter(id => id !== srcId)
            .map(id => newNodes[id]?.bounds)
            .filter((b): b is NonNullable<typeof b> => b !== undefined);
        const blockedFaces = computeBlockedFaces(srcBounds, siblings);

        for (const a of outgoing) {
            if (nodeParents[a.tgtNodeId] === srcCluster) continue;
            if (a.srcAlign !== mainOutputSide) continue;
            const preferred = perpendicularExitFace(a, vertical);
            const opposite = oppositeFace(preferred);
            if (!blockedFaces.has(preferred)) {
                a.srcAlign = preferred;
            } else if (!blockedFaces.has(opposite)) {
                a.srcAlign = opposite;
            }
            // else: both perpendicular faces blocked — keep main face.
        }
    }
}

function perpendicularExitFace(a: LinkAssignment, vertical: boolean): PortAlignment {
    if (vertical) {
        return a.dx >= 0 ? PortAlignment.Right : PortAlignment.Left;
    }
    return a.dy >= 0 ? PortAlignment.Bottom : PortAlignment.Top;
}

function oppositeFace(face: PortAlignment): PortAlignment {
    switch (face) {
        case PortAlignment.Top: return PortAlignment.Bottom;
        case PortAlignment.Bottom: return PortAlignment.Top;
        case PortAlignment.Left: return PortAlignment.Right;
        case PortAlignment.Right: return PortAlignment.Left;
    }
}

/**
 * A face is "blocked" by a sibling when the sibling sits in the strip the
 * exit segment would traverse leaving the source through that face. For
 * Bottom: a sibling whose y-range starts below source.bottom and whose
 * x-range overlaps source.x-range. The other three faces are mirrored.
 */
function computeBlockedFaces(
    src: { x: number; y: number; width: number; height: number },
    siblings: readonly { x: number; y: number; width: number; height: number }[],
): Set<PortAlignment> {
    const blocked = new Set<PortAlignment>();
    const srcLeft = src.x;
    const srcRight = src.x + src.width;
    const srcTop = src.y;
    const srcBottom = src.y + src.height;
    const xOverlaps = (b: typeof src): boolean =>
        b.x < srcRight && b.x + b.width > srcLeft;
    const yOverlaps = (b: typeof src): boolean =>
        b.y < srcBottom && b.y + b.height > srcTop;
    for (const b of siblings) {
        if (xOverlaps(b) && b.y >= srcBottom) blocked.add(PortAlignment.Bottom);
        if (xOverlaps(b) && b.y + b.height <= srcTop) blocked.add(PortAlignment.Top);
        if (yOverlaps(b) && b.x >= srcRight) blocked.add(PortAlignment.Right);
        if (yOverlaps(b) && b.x + b.width <= srcLeft) blocked.add(PortAlignment.Left);
    }
    return blocked;
}

// Pad mirrors `SAME_FACE_DETOUR_PAD` in doodles-svg' routing — it's the same
// container-clearance offset used by the router when picking the elbow pivot
// past a cluster's outer edge. Kept in sync so the port sort assigns ports in
// the same order the router will actually place their pivots.
const CONTAINER_CLEARANCE_PAD_PX = 20;

interface PortSortInfo {
    portId: string;
    /** sign(dy) for vertical faces, sign(dx) for horizontal — groups edges by
     *  which side of the source they go to (up vs down, or left vs right). */
    directionGroup: number;
    /** Estimated x of the route's vertical pivot (Right/Left face). Closer to
     *  source = smaller. Used only for vertical faces; horizontal faces sort
     *  by angle instead since the elbow-pivot heuristic doesn't differentiate
     *  cross-cluster fan-outs to a same-x target column. */
    pivotDistance: number;
    /** atan2(dy, dx) — used as the sort key for horizontal faces. Each face
     *  traversal corresponds to a monotonic sweep of atan2 values. */
    angle: number;
    /** Target's center coord along the face axis — final tiebreaker inside a
     *  (directionGroup, pivotDistance) bucket on vertical faces. */
    targetPerpCoord: number;
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

    const nodeParents: { [id: string]: string } = {};
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.Cluster) continue;
        for (const memberId of el.memberNodeIds ?? []) {
            const member = diagram.elements[memberId];
            if (member?.type !== ElementType.Cluster) nodeParents[memberId] = el.id;
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
        const [sourceId, alignmentStr] = key.split("|");
        const alignment = Number(alignmentStr!) as PortAlignment;
        const srcBounds = nodes[sourceId!]?.bounds;
        if (!srcBounds) continue;
        const sortInfos = portIds.map(pid => buildPortSortInfo(
            pid, alignment, sourceId!, srcBounds, otherEndpointOf, nodes, nodeParents
        ));
        sortInfos.sort(compareForFace(alignment));
        const n = sortInfos.length;
        for (let i = 0; i < n; i++) {
            const ratio = ((i + 1) / (n + 1)) * 100;
            const pid = sortInfos[i]!.portId;
            result[pid] = {...result[pid], edgePosRatio: ratio};
        }
    }
    return result;
}

function buildPortSortInfo(
    portId: string,
    alignment: PortAlignment,
    sourceId: string,
    srcBounds: { x: number; y: number; width: number; height: number },
    otherEndpointOf: { [portId: string]: string },
    nodes: DiagramInternal["nodes"],
    nodeParents: { [id: string]: string },
): PortSortInfo {
    const tgtId = otherEndpointOf[portId];
    const tgtBounds = tgtId ? nodes[tgtId]?.bounds : undefined;
    if (!tgtId || !tgtBounds) {
        return {portId, directionGroup: 0, pivotDistance: 0, angle: 0, targetPerpCoord: 0};
    }
    const srcCenterX = srcBounds.x + srcBounds.width / 2;
    const srcCenterY = srcBounds.y + srcBounds.height / 2;
    const tgtCenterX = tgtBounds.x + tgtBounds.width / 2;
    const tgtCenterY = tgtBounds.y + tgtBounds.height / 2;
    const sameContainer = nodeParents[sourceId] !== undefined
        && nodeParents[sourceId] === nodeParents[tgtId];
    const srcContainerBounds = nodeParents[sourceId] !== undefined
        ? nodes[nodeParents[sourceId]!]?.bounds
        : undefined;
    const vertical = alignment === PortAlignment.Right || alignment === PortAlignment.Left;
    const directionGroup = vertical
        ? Math.sign(tgtCenterY - srcCenterY)
        : Math.sign(tgtCenterX - srcCenterX);
    const pivotDistance = vertical
        ? estimatePivotX(alignment, sameContainer, srcBounds, tgtBounds, srcContainerBounds)
        : 0;
    const angle = Math.atan2(tgtCenterY - srcCenterY, tgtCenterX - srcCenterX);
    const targetPerpCoord = vertical ? tgtCenterY : tgtCenterX;
    return {portId, directionGroup, pivotDistance, angle, targetPerpCoord};
}

function estimatePivotX(
    alignment: PortAlignment,
    sameContainer: boolean,
    srcBounds: { x: number; y: number; width: number; height: number },
    tgtBounds: { x: number; y: number; width: number; height: number },
    srcContainerBounds: { x: number; y: number; width: number; height: number } | undefined,
): number {
    if (sameContainer || !srcContainerBounds) {
        return ((srcBounds.x + srcBounds.width / 2) + (tgtBounds.x + tgtBounds.width / 2)) / 2;
    }
    return alignment === PortAlignment.Right
        ? srcContainerBounds.x + srcContainerBounds.width + CONTAINER_CLEARANCE_PAD_PX
        : srcContainerBounds.x - CONTAINER_CLEARANCE_PAD_PX;
}



/**
 * Compare-fn for port ordering on a given face.
 *
 * Vertical faces (Right/Left): primary = directionGroup (UP edges first for
 * top-to-bottom traversal), secondary = pivotDistance ASC (close-target edges
 * at the outer ports of each direction group so their short verticals don't
 * sit inside another edge's long horizontal extend), tertiary = target.y ASC.
 *
 * Horizontal faces (Top/Bottom): sort by atan2 of (target − source). Going
 * left-to-right on a Bottom face is counterclockwise around the source —
 * atan2 *decreases* in that direction — so Bottom sorts DESC. Top is the
 * mirror (clockwise) and sorts ASC. This handles the FA → R1..R9 case where
 * a target column has identical x: the angle differs by target.y and gives
 * a deterministic crossing-free order without the declaration-order fallback.
 */
function compareForFace(alignment: PortAlignment): (a: PortSortInfo, b: PortSortInfo) => number {
    if (alignment === PortAlignment.Right || alignment === PortAlignment.Left) {
        // Top of face is small port_y. UP-going edges go above DOWN-going.
        // For Left we reverse the pivot direction so closer-to-source means
        // smaller |container.left - midX|.
        const pivotSign = alignment === PortAlignment.Right ? 1 : -1;
        return (a, b) => {
            if (a.directionGroup !== b.directionGroup) return a.directionGroup - b.directionGroup;
            const pivotDiff = pivotSign * (a.pivotDistance - b.pivotDistance);
            if (pivotDiff !== 0) return pivotDiff;
            return a.targetPerpCoord - b.targetPerpCoord;
        };
    }
    // Horizontal face. Bottom DESC, Top ASC.
    const sign = alignment === PortAlignment.Bottom ? -1 : 1;
    return (a, b) => sign * (a.angle - b.angle);
}
