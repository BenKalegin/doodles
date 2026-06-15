import {type Bounds, center, type Coordinate, type EdgeRoute, ElementType, insetBounds, PortAlignment, segmentEntersRect} from "@benkalegin/doodles-core";

// Default tolerance for centroid/centered comparisons in pixels. Picks up
// rounding (sub-pixel layout coords) without masking real drift.
const DEFAULT_CENTERED_TOLERANCE_PX = 4;
// Inset applied when testing "does a segment cross a node interior" — keeps
// segments that graze a node's perimeter from registering as an intersection
// (port attach points live exactly on the perimeter by design).
const NODE_INTERIOR_INSET_PX = 0.5;
// Tolerance for "is this segment axis-aligned" checks in the DSL.
const COLLINEAR_TOLERANCE_PX_DSL = 0.5;

/**
 * Two input shapes are accepted:
 *  - The flat shape that doodles-mermaid's importer returns:
 *      `{ nodes, ports?, elements, … }`
 *  - The wrapped shape that consumers like clouddiagram's importDiagramAs produce:
 *      `{ diagram: { nodes, ports? }, elements }`
 *
 * Both forms expose the same information; the wrapper just splits it.
 */
export type LaidOutDiagram = LaidOutDiagramFlat | LaidOutDiagramWrapped;

export interface LaidOutDiagramFlat {
    nodes: { [id: string]: { bounds: Bounds } };
    ports?: { [id: string]: { alignment?: PortAlignment } };
    elements: { [id: string]: any };
}

export interface LaidOutDiagramWrapped {
    diagram: {
        nodes: { [id: string]: { bounds: Bounds } };
        ports?: { [id: string]: { alignment?: PortAlignment } };
    };
    elements: { [id: string]: any };
}

const centerX = (b: Bounds): number => center(b).x;
const centerY = (b: Bounds): number => center(b).y;

function boundsContain(outer: Bounds, inner: Bounds, pad = 4): boolean {
    return inner.x >= outer.x - pad
        && inner.y >= outer.y - pad
        && inner.x + inner.width <= outer.x + outer.width + pad
        && inner.y + inner.height <= outer.y + outer.height + pad;
}

function nodeKey(text: string): string {
    return text.replace(/<[^>]+>/g, "").split("\n")[0]!.trim().toLowerCase();
}

function fullKey(text: string): string {
    return text.replace(/<[^>]+>/g, "").trim().toLowerCase();
}

function buildIndex(elements: { [id: string]: any }, type: ElementType): Map<string, any> {
    const idx = new Map<string, any>();
    for (const el of Object.values(elements)) {
        if (el?.type !== type) continue;
        const key = nodeKey(String(el.text ?? ""));
        if (!key) continue;
        if (idx.has(key)) {
            idx.set(fullKey(String(el.text)), el);
        } else {
            idx.set(key, el);
        }
    }
    return idx;
}

function lookup(idx: Map<string, any>, text: string, what: string): any {
    const el = idx.get(nodeKey(text)) ?? idx.get(fullKey(text));
    if (!el) throw new Error(`${what} "${text}" not found in layout`);
    return el;
}

function segmentsIntersect(a1: Coordinate, a2: Coordinate, b1: Coordinate, b2: Coordinate): boolean {
    const cross = (p: Coordinate, q: Coordinate, r: Coordinate): number =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = cross(b1, b2, a1);
    const d2 = cross(b1, b2, a2);
    const d3 = cross(a1, a2, b1);
    const d4 = cross(a1, a2, b2);
    return d1 * d2 < 0 && d3 * d4 < 0;
}

function polylinesCross(a: readonly Coordinate[], b: readonly Coordinate[]): boolean {
    for (let i = 1; i < a.length; i++) {
        for (let j = 1; j < b.length; j++) {
            if (segmentsIntersect(a[i - 1]!, a[i]!, b[j - 1]!, b[j]!)) return true;
        }
    }
    return false;
}

/**
 * Liang–Barsky segment vs. axis-aligned rectangle clip. Returns true when the
 * segment crosses the rectangle's interior with non-zero length. Endpoints
 * lying exactly on a rectangle edge are not considered an intersection — the
 * caller insets the rect slightly so port attach points (which sit on a node's
 * perimeter by construction) don't trigger a false positive.
 */

function rectsOverlap(a: Bounds, b: Bounds): boolean {
    return a.x < b.x + b.width
        && b.x < a.x + a.width
        && a.y < b.y + b.height
        && b.y < a.y + a.height;
}

export interface NodeAssert {
    rightOf(...others: string[]): NodeAssert;
    leftOf(...others: string[]): NodeAssert;
    above(...others: string[]): NodeAssert;
    below(...others: string[]): NodeAssert;
    sameRowAs(...others: string[]): NodeAssert;
    sameColAs(...others: string[]): NodeAssert;
    centeredHorizontallyWith(other: string, tol?: number): NodeAssert;
    centeredVerticallyWith(other: string, tol?: number): NodeAssert;
    /** Self's centerX equals the mean centerX of the named children, within `tol` px. Distinguishes "centered over a group" from pair-wise alignment. */
    centeredOver(children: string[], tol?: number): NodeAssert;
    widthRelativeTo(other: string, range: { min: number; max: number }): NodeAssert;
    insideCluster(text: string): NodeAssert;
    /** Every outgoing edge from this node attaches on the given side (PortAlignment). */
    outgoingFromSide(side: PortAlignment): NodeAssert;
    /** Every incoming edge to this node attaches on the given side. */
    incomingFromSide(side: PortAlignment): NodeAssert;
}

export interface NodesAssert {
    orderedLeftToRight(): NodesAssert;
    orderedTopToBottom(): NodesAssert;
    sameRow(tol?: number): NodesAssert;
    sameColumn(tol?: number): NodesAssert;
    /** No two of the named nodes' bboxes overlap. Catches the visually-stacked
     *  case that {@link orderedLeftToRight} misses when centers are close but
     *  widths still cause the boxes to cover each other. */
    noOverlap(): NodesAssert;
}

export interface EdgeQuery {
    fromText: string;
    toText: string;
}

export interface EdgeAssert {
    hasLabel(label: string | undefined): EdgeAssert;
    /** This edge's routed polyline does not enter the interior of any of the
     *  named non-endpoint nodes. Requires routes supplied to `layoutFor`. */
    doesNotCross(...nodeTexts: string[]): EdgeAssert;
    /** y of the source-side port attach point of the routed polyline. Use to
     *  assert port ordering, e.g., ports on the same face should be sorted
     *  by target y to avoid same-source crossings. */
    sourcePortY(): number;
    /** Asserts the routed polyline has no more than `maxPoints` vertices.
     *  A simple intra-cluster L should be 3–4 points; a U-detour is 5+. */
    polylineLengthAtMost(maxPoints: number): EdgeAssert;
    /** Asserts the routed polyline approaches the target *perpendicular* to
     *  the named side — i.e. the final segment is at right angles to that
     *  side rather than running along it. Catches back-edge detours that
     *  enter the target by sliding along its top/bottom border. */
    entersTargetPerpendicularTo(side: PortAlignment): EdgeAssert;
    /** Asserts the source port alignment (which face of the source the edge
     *  exits through). Stronger than `entersTargetPerpendicularTo` for
     *  back-edge rules — perpendicular doesn't differentiate Top from Bottom. */
    hasSourceAlignment(side: PortAlignment): EdgeAssert;
    /** Asserts the target port alignment (which face of the target the edge
     *  enters through). */
    hasTargetAlignment(side: PortAlignment): EdgeAssert;
}

export interface EdgesAssert {
    noCrossings(opts?: { max?: number }): EdgesAssert;
    count(n: number): EdgesAssert;
    /** No routed edge segment crosses the interior of a non-endpoint node. Requires routes supplied to `layoutFor`. */
    noNodeIntersection(): EdgesAssert;
    /** No two edge labels overlap (AABB check). Requires routes supplied to `layoutFor`. */
    noLabelOverlap(): EdgesAssert;
    /** Two edges that share a source node MUST NOT have intersecting routed
     *  polylines. Catches port-ordering bugs in fan-outs (when the source
     *  side has multiple ports going to differently-positioned targets,
     *  the sort key determines whether the routes cross right at the source).
     *  Requires routes supplied to `layoutFor`. */
    noSameSourceCrossings(): EdgesAssert;
}

export interface ClusterAssert {
    contains(...nodeTexts: string[]): ClusterAssert;
}

export interface NodePorts {
    incoming: PortAlignment[];
    outgoing: PortAlignment[];
}

export interface LayoutFacade {
    node(text: string): NodeAssert;
    nodes(...texts: string[]): NodesAssert;
    edge(q: EdgeQuery): EdgeAssert;
    edges(): EdgesAssert;
    cluster(text: string): ClusterAssert;
    bounds(text: string): Bounds;
    portsOf(text: string): NodePorts;
    distinctRowCount(tol?: number): number;
}

export interface LayoutForOptions {
    /**
     * Routed edges (polyline + label box) — required for `noNodeIntersection`
     * and `noLabelOverlap`. Supplied by the consumer because routing is owned
     * by the renderer, not the layout step.
     */
    routes?: EdgeRoute[];
}

export function layoutFor(result: LaidOutDiagram, options: LayoutForOptions = {}): LayoutFacade {
    const diagram = ("diagram" in result && result.diagram !== undefined)
        ? result.diagram
        : (result as LaidOutDiagramFlat);
    const elements = result.elements;
    const nodeIdx = buildIndex(elements, ElementType.ClassNode);
    const clusterIdx = buildIndex(elements, ElementType.Cluster);

    const findNode = (text: string) => lookup(nodeIdx, text, "Node");
    const findCluster = (text: string) => lookup(clusterIdx, text, "Cluster");

    const boundsOf = (el: any): Bounds => {
        const nb = diagram.nodes[el.id];
        if (!nb?.bounds) throw new Error(`No bounds for "${el.text}"`);
        return nb.bounds;
    };

    const allElements = Object.values(elements);
    const nodes = allElements.filter((e: any) => e?.type === ElementType.ClassNode);
    const links = allElements.filter((e: any) => e?.type === ElementType.ClassLink);

    const endpointsOf = (link: any): [any, any] | undefined => {
        const p1 = elements[link.port1];
        const p2 = elements[link.port2];
        if (!p1 || !p2) return undefined;
        const n1 = elements[p1.nodeId];
        const n2 = elements[p2.nodeId];
        if (!n1 || !n2) return undefined;
        return [n1, n2];
    };

    const findEdge = (q: EdgeQuery): any => {
        const from = nodeKey(q.fromText);
        const to = nodeKey(q.toText);
        for (const link of links) {
            const ep = endpointsOf(link);
            if (!ep) continue;
            const [a, b] = ep;
            if (nodeKey(String(a.text ?? "")) === from && nodeKey(String(b.text ?? "")) === to) {
                return link;
            }
        }
        throw new Error(`Edge "${q.fromText}" → "${q.toText}" not found`);
    };

    function nodeAssert(text: string): NodeAssert {
        const self = findNode(text);
        const sb = boundsOf(self);

        const api: NodeAssert = {
            rightOf(...others) {
                for (const o of others) {
                    const ob = boundsOf(findNode(o));
                    if (centerX(sb) <= centerX(ob)) {
                        throw new Error(
                            `Expected "${text}" right of "${o}" ` +
                            `(centerX ${centerX(sb).toFixed(1)} vs ${centerX(ob).toFixed(1)})`
                        );
                    }
                }
                return api;
            },
            leftOf(...others) {
                for (const o of others) {
                    const ob = boundsOf(findNode(o));
                    if (centerX(sb) >= centerX(ob)) {
                        throw new Error(`Expected "${text}" left of "${o}"`);
                    }
                }
                return api;
            },
            above(...others) {
                for (const o of others) {
                    const ob = boundsOf(findNode(o));
                    if (centerY(sb) >= centerY(ob)) {
                        throw new Error(`Expected "${text}" above "${o}"`);
                    }
                }
                return api;
            },
            below(...others) {
                for (const o of others) {
                    const ob = boundsOf(findNode(o));
                    if (centerY(sb) <= centerY(ob)) {
                        throw new Error(`Expected "${text}" below "${o}"`);
                    }
                }
                return api;
            },
            sameRowAs(...others) {
                for (const o of others) {
                    const ob = boundsOf(findNode(o));
                    const tol = Math.max(sb.height, ob.height) / 2;
                    const delta = Math.abs(centerY(sb) - centerY(ob));
                    if (delta > tol) {
                        throw new Error(
                            `Expected "${text}" in same row as "${o}" (Δy=${delta.toFixed(1)}, tol=${tol.toFixed(1)})`
                        );
                    }
                }
                return api;
            },
            sameColAs(...others) {
                for (const o of others) {
                    const ob = boundsOf(findNode(o));
                    const tol = Math.max(sb.width, ob.width) / 2;
                    const delta = Math.abs(centerX(sb) - centerX(ob));
                    if (delta > tol) {
                        throw new Error(`Expected "${text}" in same column as "${o}"`);
                    }
                }
                return api;
            },
            centeredHorizontallyWith(other, tol = DEFAULT_CENTERED_TOLERANCE_PX) {
                const ob = boundsOf(findNode(other));
                if (Math.abs(centerX(sb) - centerX(ob)) > tol) {
                    throw new Error(`Expected "${text}" centered with "${other}" within ${tol}px`);
                }
                return api;
            },
            centeredVerticallyWith(other, tol = DEFAULT_CENTERED_TOLERANCE_PX) {
                const ob = boundsOf(findNode(other));
                if (Math.abs(centerY(sb) - centerY(ob)) > tol) {
                    throw new Error(`Expected "${text}" vertically centered with "${other}" within ${tol}px`);
                }
                return api;
            },
            centeredOver(children, tol = DEFAULT_CENTERED_TOLERANCE_PX) {
                if (children.length === 0) throw new Error("centeredOver([]) needs at least one child");
                const childrenCenters = children.map(t => centerX(boundsOf(findNode(t))));
                const mean = childrenCenters.reduce((a, b) => a + b, 0) / childrenCenters.length;
                const delta = Math.abs(centerX(sb) - mean);
                if (delta > tol) {
                    throw new Error(
                        `Expected "${text}" centered over [${children.join(", ")}] ` +
                        `(centerX=${centerX(sb).toFixed(1)}, group mean=${mean.toFixed(1)}, Δ=${delta.toFixed(1)}, tol=${tol})`
                    );
                }
                return api;
            },
            widthRelativeTo(other, range) {
                const ob = boundsOf(findNode(other));
                const ratio = sb.width / ob.width;
                if (ratio < range.min || ratio > range.max) {
                    throw new Error(
                        `Expected width("${text}")/width("${other}") in [${range.min}, ${range.max}], got ${ratio.toFixed(2)}`
                    );
                }
                return api;
            },
            insideCluster(clusterText) {
                if (!boundsContain(boundsOf(findCluster(clusterText)), sb)) {
                    throw new Error(`Expected "${text}" inside cluster "${clusterText}"`);
                }
                return api;
            },
            outgoingFromSide(side) {
                assertEdgesFromSide(self, side, "outgoing", text);
                return api;
            },
            incomingFromSide(side) {
                assertEdgesFromSide(self, side, "incoming", text);
                return api;
            }
        };
        return api;
    }

    function assertEdgesFromSide(
        self: any,
        side: PortAlignment,
        direction: "incoming" | "outgoing",
        text: string,
    ): void {
        const ports = diagram.ports ?? {};
        const offending: PortAlignment[] = [];
        for (const link of links) {
            const ep = endpointsOf(link);
            if (!ep) continue;
            const [a, b] = ep;
            const matches = direction === "outgoing" ? a.id === self.id : b.id === self.id;
            if (!matches) continue;
            const portId = direction === "outgoing" ? link.port1 : link.port2;
            const align = ports[portId]?.alignment;
            if (align !== undefined && align !== side) offending.push(align);
        }
        if (offending.length > 0) {
            throw new Error(
                `Expected all ${direction} edges of "${text}" to use ${PortAlignment[side]} side, ` +
                `found ${offending.length} on [${offending.map(a => PortAlignment[a]).join(", ")}]`
            );
        }
    }

    function nodesAssert(...texts: string[]): NodesAssert {
        if (texts.length < 2) throw new Error("nodes(...) needs at least two ids");
        const items = texts.map(t => ({text: t, b: boundsOf(findNode(t))}));

        const api: NodesAssert = {
            orderedLeftToRight() {
                for (let i = 1; i < items.length; i++) {
                    const cur = items[i]!;
                    const prev = items[i - 1]!;
                    if (centerX(cur.b) <= centerX(prev.b)) {
                        throw new Error(
                            `Expected "${cur.text}" right of "${prev.text}" ` +
                            `(centerX ${centerX(cur.b).toFixed(1)} vs ${centerX(prev.b).toFixed(1)})`
                        );
                    }
                }
                return api;
            },
            orderedTopToBottom() {
                for (let i = 1; i < items.length; i++) {
                    const cur = items[i]!;
                    const prev = items[i - 1]!;
                    if (centerY(cur.b) <= centerY(prev.b)) {
                        throw new Error(`Expected "${cur.text}" below "${prev.text}"`);
                    }
                }
                return api;
            },
            sameRow(tol) {
                const ref = items[0]!;
                for (let i = 1; i < items.length; i++) {
                    const cur = items[i]!;
                    const t = tol ?? Math.max(ref.b.height, cur.b.height) / 2;
                    if (Math.abs(centerY(cur.b) - centerY(ref.b)) > t) {
                        throw new Error(`Expected "${cur.text}" in same row as "${ref.text}"`);
                    }
                }
                return api;
            },
            sameColumn(tol) {
                const ref = items[0]!;
                for (let i = 1; i < items.length; i++) {
                    const cur = items[i]!;
                    const t = tol ?? Math.max(ref.b.width, cur.b.width) / 2;
                    if (Math.abs(centerX(cur.b) - centerX(ref.b)) > t) {
                        throw new Error(`Expected "${cur.text}" in same column as "${ref.text}"`);
                    }
                }
                return api;
            },
            noOverlap() {
                const offenders: string[] = [];
                for (let i = 0; i < items.length; i++) {
                    for (let j = i + 1; j < items.length; j++) {
                        const a = items[i]!, b = items[j]!;
                        if (rectsOverlap(a.b, b.b)) {
                            offenders.push(
                                `"${a.text}" (${a.b.x.toFixed(0)},${a.b.y.toFixed(0)} ${a.b.width.toFixed(0)}×${a.b.height.toFixed(0)}) ` +
                                `vs "${b.text}" (${b.b.x.toFixed(0)},${b.b.y.toFixed(0)} ${b.b.width.toFixed(0)}×${b.b.height.toFixed(0)})`
                            );
                        }
                    }
                }
                if (offenders.length > 0) {
                    throw new Error(`Expected no overlap among nodes, found:\n  ${offenders.join("\n  ")}`);
                }
                return api;
            }
        };
        return api;
    }

    function edgeAssert(q: EdgeQuery): EdgeAssert {
        const link = findEdge(q);
        const api: EdgeAssert = {
            hasLabel(label) {
                const actual = link.text;
                if (actual !== label) {
                    throw new Error(
                        `Expected edge "${q.fromText}" → "${q.toText}" label ${JSON.stringify(label)}, got ${JSON.stringify(actual)}`
                    );
                }
                return api;
            },
            sourcePortY() {
                const routes = options.routes;
                if (!routes) throw new Error("sourcePortY() requires routes supplied to layoutFor()");
                const route = routes.find(r => r.edgeId === link.id);
                if (!route || route.polyline.length === 0) {
                    throw new Error(`No route found for edge "${q.fromText}" → "${q.toText}"`);
                }
                return route.polyline[0]!.y;
            },
            entersTargetPerpendicularTo(side) {
                const routes = options.routes;
                if (!routes) throw new Error("entersTargetPerpendicularTo() requires routes supplied to layoutFor()");
                const route = routes.find(r => r.edgeId === link.id);
                if (!route || route.polyline.length < 2) {
                    throw new Error(`No route found for edge "${q.fromText}" → "${q.toText}"`);
                }
                const tail = route.polyline[route.polyline.length - 1]!;
                const beforeTail = route.polyline[route.polyline.length - 2]!;
                const isHorizontalApproach = Math.abs(tail.y - beforeTail.y) < COLLINEAR_TOLERANCE_PX_DSL;
                const isVerticalApproach = Math.abs(tail.x - beforeTail.x) < COLLINEAR_TOLERANCE_PX_DSL;
                const sidePerpendicularToHorizontal = side === PortAlignment.Top || side === PortAlignment.Bottom;
                const expectedHorizontal = sidePerpendicularToHorizontal === false; // approach Left/Right side perpendicular = horizontal
                if (expectedHorizontal && !isHorizontalApproach) {
                    throw new Error(
                        `Edge "${q.fromText}" → "${q.toText}" doesn't approach ${PortAlignment[side]} side perpendicularly — last segment is vertical (slides along side instead of entering)`
                    );
                }
                if (!expectedHorizontal && !isVerticalApproach) {
                    throw new Error(
                        `Edge "${q.fromText}" → "${q.toText}" doesn't approach ${PortAlignment[side]} side perpendicularly — last segment is horizontal (slides along side instead of entering)`
                    );
                }
                return api;
            },
            polylineLengthAtMost(maxPoints) {
                const routes = options.routes;
                if (!routes) throw new Error("polylineLengthAtMost() requires routes supplied to layoutFor()");
                const route = routes.find(r => r.edgeId === link.id);
                if (!route) throw new Error(`No route found for edge "${q.fromText}" → "${q.toText}"`);
                if (route.polyline.length > maxPoints) {
                    const polyStr = route.polyline.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(" → ");
                    throw new Error(
                        `Edge "${q.fromText}" → "${q.toText}" polyline has ${route.polyline.length} points, max ${maxPoints}\n  polyline: ${polyStr}`
                    );
                }
                return api;
            },
            doesNotCross(...nodeTexts) {
                const routes = options.routes;
                if (!routes) throw new Error("doesNotCross() requires routes supplied to layoutFor()");
                const route = routes.find(r => r.edgeId === link.id);
                if (!route) throw new Error(`No route found for edge "${q.fromText}" → "${q.toText}"`);
                const offenders: string[] = [];
                for (const text of nodeTexts) {
                    const target = findNode(text);
                    const interior = insetBounds(boundsOf(target), NODE_INTERIOR_INSET_PX);
                    if (interior.width <= 0 || interior.height <= 0) continue;
                    for (let i = 1; i < route.polyline.length; i++) {
                        const p1 = route.polyline[i - 1]!;
                        const p2 = route.polyline[i]!;
                        if (segmentEntersRect(p1, p2, interior)) {
                            offenders.push(`"${text}" (polyline segment ${i})`);
                            break;
                        }
                    }
                }
                if (offenders.length > 0) {
                    const polyStr = route.polyline.map(p => `(${p.x.toFixed(0)},${p.y.toFixed(0)})`).join(" → ");
                    throw new Error(
                        `Edge "${q.fromText}" → "${q.toText}" crosses non-endpoint nodes: ${offenders.join(", ")}\n  polyline: ${polyStr}`
                    );
                }
                return api;
            },
            hasSourceAlignment(side) {
                const actual = (diagram.ports ?? {})[link.port1]?.alignment;
                if (actual !== side) {
                    throw new Error(
                        `Edge "${q.fromText}" → "${q.toText}" source-port alignment is ` +
                        `${actual === undefined ? "unset" : PortAlignment[actual]}, expected ${PortAlignment[side]}`
                    );
                }
                return api;
            },
            hasTargetAlignment(side) {
                const actual = (diagram.ports ?? {})[link.port2]?.alignment;
                if (actual !== side) {
                    throw new Error(
                        `Edge "${q.fromText}" → "${q.toText}" target-port alignment is ` +
                        `${actual === undefined ? "unset" : PortAlignment[actual]}, expected ${PortAlignment[side]}`
                    );
                }
                return api;
            }
        };
        return api;
    }

    function edgesAssert(): EdgesAssert {
        const api: EdgesAssert = {
            noCrossings(opts) {
                const max = opts?.max ?? 0;
                const segments = links.map(l => {
                    const ep = endpointsOf(l);
                    if (!ep) return null;
                    const [a, b] = ep;
                    return {
                        from: {x: centerX(boundsOf(a)), y: centerY(boundsOf(a))},
                        to: {x: centerX(boundsOf(b)), y: centerY(boundsOf(b))},
                        a: a.id,
                        b: b.id
                    };
                }).filter((s): s is NonNullable<typeof s> => s !== null);

                let crossings = 0;
                for (let i = 0; i < segments.length; i++) {
                    for (let j = i + 1; j < segments.length; j++) {
                        const s1 = segments[i]!, s2 = segments[j]!;
                        if (s1.a === s2.a || s1.a === s2.b || s1.b === s2.a || s1.b === s2.b) continue;
                        if (segmentsIntersect(s1.from, s1.to, s2.from, s2.to)) crossings++;
                    }
                }
                if (crossings > max) {
                    throw new Error(`Expected ≤${max} edge crossings, got ${crossings}`);
                }
                return api;
            },
            count(n) {
                if (links.length !== n) {
                    throw new Error(`Expected ${n} edges, got ${links.length}`);
                }
                return api;
            },
            noNodeIntersection() {
                const routes = options.routes;
                if (!routes) throw new Error("noNodeIntersection() requires routes supplied to layoutFor()");
                const offenders: string[] = [];
                // Don't skip source/target — the inset keeps perimeter attach points
                // out of "interior" but flags polylines that re-enter their own
                // endpoint node's bbox (e.g., port on wrong side routing back across).
                for (const route of routes) {
                    for (let i = 1; i < route.polyline.length; i++) {
                        const p1 = route.polyline[i - 1]!;
                        const p2 = route.polyline[i]!;
                        for (const n of nodes) {
                            const interior = insetBounds(boundsOf(n), NODE_INTERIOR_INSET_PX);
                            if (interior.width <= 0 || interior.height <= 0) continue;
                            if (segmentEntersRect(p1, p2, interior)) {
                                offenders.push(
                                    `edge "${route.label || route.edgeId}" crosses node "${String(n.text ?? n.id)}" ` +
                                    `(segment ${i} of polyline)`
                                );
                            }
                        }
                    }
                }
                if (offenders.length > 0) {
                    throw new Error(`Edge-node intersections:\n  ${offenders.join("\n  ")}`);
                }
                return api;
            },
            noSameSourceCrossings() {
                const routes = options.routes;
                if (!routes) throw new Error("noSameSourceCrossings() requires routes supplied to layoutFor()");
                const offenders: string[] = [];
                for (let i = 0; i < routes.length; i++) {
                    for (let j = i + 1; j < routes.length; j++) {
                        const ra = routes[i]!;
                        const rb = routes[j]!;
                        if (ra.sourceNodeId !== rb.sourceNodeId) continue;
                        if (polylinesCross(ra.polyline, rb.polyline)) {
                            offenders.push(`"${ra.label || ra.edgeId}" × "${rb.label || rb.edgeId}"`);
                        }
                    }
                }
                if (offenders.length > 0) {
                    throw new Error(`Same-source crossings:\n  ${offenders.join("\n  ")}`);
                }
                return api;
            },
            noLabelOverlap() {
                const routes = options.routes;
                if (!routes) throw new Error("noLabelOverlap() requires routes supplied to layoutFor()");
                const labeled = routes.filter((r): r is EdgeRoute & {labelBox: Bounds} => r.labelBox !== undefined);
                const overlaps: string[] = [];
                for (let i = 0; i < labeled.length; i++) {
                    for (let j = i + 1; j < labeled.length; j++) {
                        const a = labeled[i]!, b = labeled[j]!;
                        if (rectsOverlap(a.labelBox, b.labelBox)) {
                            overlaps.push(`"${a.label}" overlaps "${b.label}"`);
                        }
                    }
                }
                if (overlaps.length > 0) {
                    throw new Error(`Label overlaps:\n  ${overlaps.join("\n  ")}`);
                }
                return api;
            }
        };
        return api;
    }

    function clusterAssert(text: string): ClusterAssert {
        const cb = boundsOf(findCluster(text));
        const api: ClusterAssert = {
            contains(...nodeTexts) {
                for (const t of nodeTexts) {
                    if (!boundsContain(cb, boundsOf(findNode(t)))) {
                        throw new Error(`Expected "${t}" inside cluster "${text}"`);
                    }
                }
                return api;
            }
        };
        return api;
    }

    return {
        node: nodeAssert,
        nodes: nodesAssert,
        edge: edgeAssert,
        edges: edgesAssert,
        cluster: clusterAssert,
        bounds: (text) => boundsOf(findNode(text)),
        portsOf: (text) => {
            const node = findNode(text);
            const incoming: PortAlignment[] = [];
            const outgoing: PortAlignment[] = [];
            const ports = diagram.ports ?? {};
            for (const link of links) {
                const ep = endpointsOf(link);
                if (!ep) continue;
                const [a, b] = ep;
                if (a.id === node.id) {
                    const align = ports[link.port1]?.alignment;
                    if (align !== undefined) outgoing.push(align);
                }
                if (b.id === node.id) {
                    const align = ports[link.port2]?.alignment;
                    if (align !== undefined) incoming.push(align);
                }
            }
            return {incoming, outgoing};
        },
        distinctRowCount: (tol = 16) => {
            const cys = nodes.map(n => centerY(boundsOf(n))).sort((a, b) => a - b);
            let rows = 0;
            let last = -Infinity;
            for (const y of cys) {
                if (y - last > tol) {
                    rows++;
                    last = y;
                }
            }
            return rows;
        }
    };
}
