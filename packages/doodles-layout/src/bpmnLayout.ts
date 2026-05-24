import {
    type BpmnDiagram,
    type BpmnFlow,
    type BpmnFlowPlacement,
    type BpmnLane,
    type BpmnNode,
    type BpmnNodePlacement,
    type BpmnPool,
    type Bounds,
    type Coordinate,
    BpmnElementKind,
    BpmnFlowKind,
    BpmnPoolOrientation,
    defaultDiagramDisplay,
} from "@benkalegin/doodles-core";

/**
 * BPMN auto-layout for diagrams that lack BPMNDI (e.g. LLM-emitted XML). Lays
 * out nodes left-to-right within each lane via layered DAG ordering, stacks
 * lanes vertically inside their pool, places pools below each other, and
 * routes sequence/message flows with orthogonal elbow connectors.
 *
 * Scope (Phase 1): no-pool flat processes + horizontal pools with N lanes.
 * Vertical pools, nested subprocesses, and crossing-minimization are deferred.
 *
 * Pure function: returns a new BpmnDiagram with nodePlacements + flowPlacements
 * populated and hasLayout=true. If the input already has layout, returned
 * unchanged.
 */

// ── Shape sizes (must match doodles-svg/src/bpmn.ts visual sizes) ───────────

const EVENT_DIAMETER = 36;
const TASK_WIDTH = 100;
const TASK_HEIGHT = 80;
const GATEWAY_SIZE = 50;
const ARTIFACT_WIDTH = 100;
const ARTIFACT_HEIGHT = 60;

// ── Spacing constants ──────────────────────────────────────────────────────

const HORIZONTAL_NODE_GAP = 50;
const VERTICAL_NODE_GAP = 30;
const LANE_LABEL_BAND = 24;
const LANE_VERTICAL_PADDING = 20;
const LANE_HORIZONTAL_PADDING = 20;
const POOL_LABEL_BAND = 24;
const POOL_VERTICAL_GAP = 40;
const TOP_LEVEL_TOP_OFFSET = 40;
const TOP_LEVEL_LEFT_OFFSET = 40;
const DEFAULT_LANE_HEIGHT = 120;
const FLOW_ELBOW_MARGIN = 12;

interface NodeSize {
    width: number;
    height: number;
}

interface LayoutContext {
    diagram: BpmnDiagram;
    nodePlacements: Record<string, BpmnNodePlacement>;
    flowPlacements: Record<string, BpmnFlowPlacement>;
}

/**
 * Compute BPMNDI-equivalent placement for a diagram that arrived without it.
 * Returns the diagram unchanged when hasLayout is already true — callers can
 * pipe every diagram through this function without checking first.
 */
export function applyBpmnLayout(diagram: BpmnDiagram): BpmnDiagram {
    if (diagram.hasLayout) return diagram;
    const ctx: LayoutContext = {diagram, nodePlacements: {}, flowPlacements: {}};
    const cursor = layoutPools(ctx, TOP_LEVEL_TOP_OFFSET);
    layoutOrphanProcess(ctx, cursor);
    routeAllFlows(ctx);
    const display = computeDisplay(ctx);
    return {
        ...diagram,
        nodePlacements: ctx.nodePlacements,
        flowPlacements: ctx.flowPlacements,
        hasLayout: true,
        display,
    };
}

// ── Pool/lane layout ───────────────────────────────────────────────────────

function layoutPools(ctx: LayoutContext, startY: number): number {
    let cursorY = startY;
    for (const pool of collectPools(ctx.diagram)) {
        cursorY = layoutPool(ctx, pool, cursorY);
        cursorY += POOL_VERTICAL_GAP;
    }
    return cursorY;
}

function layoutPool(ctx: LayoutContext, pool: BpmnPool, top: number): number {
    const lanes = collectLanesOfPool(ctx.diagram, pool);
    if (lanes.length === 0) return layoutPoolWithoutLanes(ctx, pool, top);
    return layoutPoolWithLanes(ctx, pool, lanes, top);
}

function layoutPoolWithLanes(ctx: LayoutContext, pool: BpmnPool, lanes: BpmnLane[], top: number): number {
    const memberNodes = lanes.map(lane => filterFlowNodes(lane.flowNodeRefs.map(id => ctx.diagram.nodes[id])));
    const laneRowHeights = lanes.map((_, i) => Math.max(DEFAULT_LANE_HEIGHT, layeredContentHeight(ctx.diagram, memberNodes[i] ?? [])));
    const laneContentWidth = Math.max(...lanes.map((_, i) => layeredContentWidth(ctx.diagram, memberNodes[i] ?? [])), 1);
    const poolLeft = TOP_LEVEL_LEFT_OFFSET;
    const lanesLeft = poolLeft + POOL_LABEL_BAND;
    const laneWidth = laneContentWidth + LANE_HORIZONTAL_PADDING * 2 + LANE_LABEL_BAND;
    let cursorY = top;
    for (let i = 0; i < lanes.length; i++) {
        const lane = lanes[i]!;
        const rowHeight = laneRowHeights[i]!;
        placeLane(ctx, lane, lanesLeft, cursorY, laneWidth, rowHeight);
        placeLaneMembers(ctx, memberNodes[i] ?? [], lanesLeft + LANE_LABEL_BAND + LANE_HORIZONTAL_PADDING, cursorY, rowHeight);
        cursorY += rowHeight;
    }
    const poolBounds: Bounds = {x: poolLeft, y: top, width: POOL_LABEL_BAND + laneWidth, height: cursorY - top};
    ctx.nodePlacements[pool.id] = {bounds: poolBounds, isHorizontal: pool.orientation === BpmnPoolOrientation.Horizontal};
    return cursorY;
}

function placeLane(ctx: LayoutContext, lane: BpmnLane, x: number, y: number, width: number, height: number): void {
    ctx.nodePlacements[lane.id] = {bounds: {x, y, width, height}, isHorizontal: true};
}

/**
 * Layered placement: nodes are grouped by longest-path depth from sources, so
 * a gateway's alternate branches end up in the same column as the primary
 * branch (one above, one below) rather than after it. Without this, a "no"
 * sequence flow that skips the primary chain would route straight through the
 * intervening nodes. With layered placement, same-layer siblings stack
 * vertically and the flow can route around them.
 */
function placeLaneMembers(ctx: LayoutContext, members: BpmnNode[], originX: number, laneTop: number, laneHeight: number): void {
    if (members.length === 0) return;
    const scope = new Set(members.map(m => m.id));
    const byLayer = groupByLayer(ctx.diagram, members, scope);
    const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b);
    const layerLeftX = computeLayerXOffsets(byLayer, sortedLayers, originX);
    const centerY = laneTop + laneHeight / 2;
    for (const L of sortedLayers) {
        const group = byLayer.get(L)!;
        const layerWidth = maxNodeWidth(group);
        const layerCenterX = (layerLeftX.get(L) ?? originX) + layerWidth / 2;
        placeLayerGroup(ctx, group, layerCenterX, centerY);
    }
}

function placeLayerGroup(ctx: LayoutContext, group: BpmnNode[], layerCenterX: number, centerY: number): void {
    if (group.length === 1) {
        const node = group[0]!;
        const size = sizeOf(node);
        ctx.nodePlacements[node.id] = {
            bounds: {x: layerCenterX - size.width / 2, y: centerY - size.height / 2, width: size.width, height: size.height},
        };
        return;
    }
    const totalHeight = group.reduce((sum, n) => sum + sizeOf(n).height, 0)
        + VERTICAL_NODE_GAP * (group.length - 1);
    let yCursor = centerY - totalHeight / 2;
    for (const node of group) {
        const size = sizeOf(node);
        ctx.nodePlacements[node.id] = {
            bounds: {x: layerCenterX - size.width / 2, y: yCursor, width: size.width, height: size.height},
        };
        yCursor += size.height + VERTICAL_NODE_GAP;
    }
}

function computeLayerXOffsets(byLayer: Map<number, BpmnNode[]>, sortedLayers: number[], originX: number): Map<number, number> {
    const out = new Map<number, number>();
    let cursorX = originX;
    for (const L of sortedLayers) {
        out.set(L, cursorX);
        cursorX += maxNodeWidth(byLayer.get(L)!) + HORIZONTAL_NODE_GAP;
    }
    return out;
}

function maxNodeWidth(group: BpmnNode[]): number {
    let max = 0;
    for (const n of group) {
        const w = sizeOf(n).width;
        if (w > max) max = w;
    }
    return max;
}

/**
 * Group nodes by longest-path depth from any source (node with in-degree 0
 * within the scope). Ensures forward edges always step at least one layer to
 * the right.
 */
function groupByLayer(diagram: BpmnDiagram, members: BpmnNode[], scope: Set<string>): Map<number, BpmnNode[]> {
    const layer = computeLayerDepths(diagram, scope);
    const out = new Map<number, BpmnNode[]>();
    for (const m of members) {
        const L = layer.get(m.id) ?? 0;
        if (!out.has(L)) out.set(L, []);
        out.get(L)!.push(m);
    }
    return out;
}

function computeLayerDepths(diagram: BpmnDiagram, scope: Set<string>): Map<string, number> {
    const adjacency = new Map<string, string[]>();
    const inDegree = new Map<string, number>();
    for (const id of scope) {
        adjacency.set(id, []);
        inDegree.set(id, 0);
    }
    for (const flow of Object.values(diagram.flows)) {
        if (flow.kind !== BpmnFlowKind.Sequence) continue;
        if (!scope.has(flow.sourceRef) || !scope.has(flow.targetRef)) continue;
        adjacency.get(flow.sourceRef)!.push(flow.targetRef);
        inDegree.set(flow.targetRef, (inDegree.get(flow.targetRef) ?? 0) + 1);
    }
    const layer = new Map<string, number>();
    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
        if (deg === 0) {
            layer.set(id, 0);
            queue.push(id);
        }
    }
    const remaining = new Map(inDegree);
    while (queue.length > 0) {
        const id = queue.shift()!;
        const myLayer = layer.get(id) ?? 0;
        for (const next of adjacency.get(id) ?? []) {
            const nextLayer = Math.max(layer.get(next) ?? 0, myLayer + 1);
            layer.set(next, nextLayer);
            const leftover = (remaining.get(next) ?? 1) - 1;
            remaining.set(next, leftover);
            if (leftover === 0) queue.push(next);
        }
    }
    // Cycle members or disconnected nodes get the trailing layer.
    let maxLayer = -1;
    for (const v of layer.values()) if (v > maxLayer) maxLayer = v;
    for (const id of scope) if (!layer.has(id)) layer.set(id, maxLayer + 1);
    return layer;
}

function layoutPoolWithoutLanes(ctx: LayoutContext, pool: BpmnPool, top: number): number {
    const members = filterFlowNodes(Object.values(ctx.diagram.nodes).filter(n => n.parentRef === pool.processRef));
    const rowHeight = Math.max(DEFAULT_LANE_HEIGHT, layeredContentHeight(ctx.diagram, members));
    const poolLeft = TOP_LEVEL_LEFT_OFFSET;
    const innerLeft = poolLeft + POOL_LABEL_BAND + LANE_HORIZONTAL_PADDING;
    const innerWidth = Math.max(layeredContentWidth(ctx.diagram, members), 1);
    placeLaneMembers(ctx, members, innerLeft, top, rowHeight);
    ctx.nodePlacements[pool.id] = {
        bounds: {x: poolLeft, y: top, width: POOL_LABEL_BAND + LANE_HORIZONTAL_PADDING * 2 + innerWidth, height: rowHeight},
        isHorizontal: pool.orientation === BpmnPoolOrientation.Horizontal,
    };
    return top + rowHeight;
}

// ── Process without any pool ────────────────────────────────────────────────

function layoutOrphanProcess(ctx: LayoutContext, top: number): void {
    const placed = new Set(Object.keys(ctx.nodePlacements));
    const orphans = filterFlowNodes(Object.values(ctx.diagram.nodes).filter(n => !placed.has(n.id) && !isContainer(n)));
    if (orphans.length === 0) return;
    const left = TOP_LEVEL_LEFT_OFFSET;
    const rowHeight = Math.max(DEFAULT_LANE_HEIGHT, layeredContentHeight(ctx.diagram, orphans));
    placeLaneMembers(ctx, orphans, left, top, rowHeight);
}

// ── Flow routing ───────────────────────────────────────────────────────────

function routeAllFlows(ctx: LayoutContext): void {
    for (const flow of Object.values(ctx.diagram.flows)) {
        const route = routeFlow(ctx, flow);
        if (route) ctx.flowPlacements[flow.id] = {waypoints: route};
    }
}

function routeFlow(ctx: LayoutContext, flow: BpmnFlow): Coordinate[] | undefined {
    const source = ctx.nodePlacements[flow.sourceRef];
    const target = ctx.nodePlacements[flow.targetRef];
    if (!source || !target) return undefined;
    const sourceAnchor = anchorOf(source.bounds, target.bounds);
    const targetAnchor = anchorOf(target.bounds, source.bounds);
    return orthogonalRoute(sourceAnchor, targetAnchor, flow.kind);
}

function anchorOf(self: Bounds, other: Bounds): Coordinate {
    const cx = self.x + self.width / 2;
    const cy = self.y + self.height / 2;
    const ox = other.x + other.width / 2;
    const oy = other.y + other.height / 2;
    const dx = ox - cx;
    const dy = oy - cy;
    if (Math.abs(dx) >= Math.abs(dy)) {
        // Anchor on left/right edge.
        const xEdge = dx >= 0 ? self.x + self.width : self.x;
        return {x: xEdge, y: cy};
    }
    const yEdge = dy >= 0 ? self.y + self.height : self.y;
    return {x: cx, y: yEdge};
}

function orthogonalRoute(from: Coordinate, to: Coordinate, kind: BpmnFlowKind): Coordinate[] {
    if (from.x === to.x || from.y === to.y) return [from, to];
    // 3-segment elbow: out along the dominant axis, then turn, then in.
    if (kind === BpmnFlowKind.Message) return buildElbowVertical(from, to);
    return buildElbowHorizontal(from, to);
}

function buildElbowHorizontal(from: Coordinate, to: Coordinate): Coordinate[] {
    const midX = (from.x + to.x) / 2;
    const corner1: Coordinate = {x: clampAwayFrom(midX, from.x, FLOW_ELBOW_MARGIN), y: from.y};
    const corner2: Coordinate = {x: corner1.x, y: to.y};
    return [from, corner1, corner2, to];
}

function buildElbowVertical(from: Coordinate, to: Coordinate): Coordinate[] {
    const midY = (from.y + to.y) / 2;
    const corner1: Coordinate = {x: from.x, y: clampAwayFrom(midY, from.y, FLOW_ELBOW_MARGIN)};
    const corner2: Coordinate = {x: to.x, y: corner1.y};
    return [from, corner1, corner2, to];
}

function clampAwayFrom(target: number, anchor: number, margin: number): number {
    if (target === anchor) return anchor + margin;
    return target;
}

// ── Node sizing & filtering ────────────────────────────────────────────────

function sizeOf(node: BpmnNode): NodeSize {
    if (isEvent(node)) return {width: EVENT_DIAMETER, height: EVENT_DIAMETER};
    if (isGateway(node)) return {width: GATEWAY_SIZE, height: GATEWAY_SIZE};
    if (isActivity(node)) return {width: TASK_WIDTH, height: TASK_HEIGHT};
    return {width: ARTIFACT_WIDTH, height: ARTIFACT_HEIGHT};
}

function isEvent(node: BpmnNode): boolean {
    return node.kind === BpmnElementKind.StartEvent
        || node.kind === BpmnElementKind.EndEvent
        || node.kind === BpmnElementKind.IntermediateThrowEvent
        || node.kind === BpmnElementKind.IntermediateCatchEvent;
}

function isGateway(node: BpmnNode): boolean {
    return node.kind === BpmnElementKind.ExclusiveGateway
        || node.kind === BpmnElementKind.ParallelGateway
        || node.kind === BpmnElementKind.InclusiveGateway
        || node.kind === BpmnElementKind.EventBasedGateway;
}

function isActivity(node: BpmnNode): boolean {
    return node.kind === BpmnElementKind.Task
        || node.kind === BpmnElementKind.UserTask
        || node.kind === BpmnElementKind.ServiceTask
        || node.kind === BpmnElementKind.Subprocess
        || node.kind === BpmnElementKind.CallActivity;
}

function isContainer(node: BpmnNode): boolean {
    return node.kind === BpmnElementKind.Pool || node.kind === BpmnElementKind.Lane;
}

function filterFlowNodes(maybeNodes: Array<BpmnNode | undefined>): BpmnNode[] {
    const out: BpmnNode[] = [];
    for (const n of maybeNodes) {
        if (!n) continue;
        if (isContainer(n)) continue;
        out.push(n);
    }
    return out;
}

/**
 * Width and height of a lane's content under the layered layout. Width sums
 * the max-width-per-layer; height is the tallest vertically-stacked group
 * across all layers.
 */
function layeredContentWidth(diagram: BpmnDiagram, members: BpmnNode[]): number {
    if (members.length === 0) return 0;
    const scope = new Set(members.map(m => m.id));
    const byLayer = groupByLayer(diagram, members, scope);
    const sortedLayers = [...byLayer.keys()].sort((a, b) => a - b);
    let total = 0;
    for (const L of sortedLayers) total += maxNodeWidth(byLayer.get(L)!);
    total += HORIZONTAL_NODE_GAP * Math.max(0, sortedLayers.length - 1);
    return total;
}

function layeredContentHeight(diagram: BpmnDiagram, members: BpmnNode[]): number {
    if (members.length === 0) return 0;
    const scope = new Set(members.map(m => m.id));
    const byLayer = groupByLayer(diagram, members, scope);
    let maxStack = 0;
    for (const group of byLayer.values()) {
        const stack = group.reduce((sum, n) => sum + sizeOf(n).height, 0)
            + VERTICAL_NODE_GAP * Math.max(0, group.length - 1);
        if (stack > maxStack) maxStack = stack;
    }
    return maxStack + LANE_VERTICAL_PADDING * 2;
}

// ── Collection helpers ─────────────────────────────────────────────────────

function collectPools(diagram: BpmnDiagram): BpmnPool[] {
    return Object.values(diagram.nodes).filter((n): n is BpmnPool => n.kind === BpmnElementKind.Pool);
}

function collectLanesOfPool(diagram: BpmnDiagram, pool: BpmnPool): BpmnLane[] {
    return Object.values(diagram.nodes).filter((n): n is BpmnLane => n.kind === BpmnElementKind.Lane && n.parentRef === pool.processRef);
}

// ── Display computation ────────────────────────────────────────────────────

function computeDisplay(ctx: LayoutContext): BpmnDiagram["display"] {
    const placements = Object.values(ctx.nodePlacements);
    if (placements.length === 0) {
        return {...defaultDiagramDisplay, width: 0, height: 0, offset: {x: 0, y: 0}};
    }
    let maxX = 0;
    let maxY = 0;
    for (const p of placements) {
        if (p.bounds.x + p.bounds.width > maxX) maxX = p.bounds.x + p.bounds.width;
        if (p.bounds.y + p.bounds.height > maxY) maxY = p.bounds.y + p.bounds.height;
    }
    for (const f of Object.values(ctx.flowPlacements)) {
        for (const w of f.waypoints) {
            if (w.x > maxX) maxX = w.x;
            if (w.y > maxY) maxY = w.y;
        }
    }
    return {
        ...defaultDiagramDisplay,
        width: maxX + TOP_LEVEL_LEFT_OFFSET,
        height: maxY + TOP_LEVEL_TOP_OFFSET,
        offset: {x: 0, y: 0},
    };
}
