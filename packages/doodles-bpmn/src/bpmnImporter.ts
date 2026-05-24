import {nanoid} from "nanoid";
import {
    type BpmnActivity,
    type BpmnDiagram,
    type BpmnEvent,
    type BpmnExtensionAttr,
    type BpmnExtensionChild,
    type BpmnExtensions,
    type BpmnFlow,
    type BpmnFlowPlacement,
    type BpmnGateway,
    type BpmnGroup,
    type BpmnLane,
    type BpmnNode,
    type BpmnNodePlacement,
    type BpmnPool,
    type BpmnProcess,
    type BpmnDataObject,
    type BpmnTextAnnotation,
    type Bounds,
    type Coordinate,
    BpmnElementKind,
    BpmnEventDefinition,
    BpmnFlowKind,
    BpmnGatewayDirection,
    BpmnPoolOrientation,
    BpmnSourceFormat,
    defaultDiagramDisplay,
    ElementType,
    zeroCoordinate,
} from "@benkalegin/doodles-core";
import {BPMN_NS, BPMNDI_NS, DC_NS, DI_NS, OWNED_NAMESPACES} from "./namespaces.js";

/**
 * BPMN 2.0 XML → BpmnDiagram. Supports the Descriptive subset; foreign-namespace
 * content (camunda:, zeebe:, vendor extensions) is captured verbatim on each
 * node's `extensions` field for lossless round-trip.
 *
 * In browser contexts the global DOMParser/XMLSerializer are used by default.
 * In Node, inject both (e.g. from @xmldom/xmldom) via `opts`.
 */

/**
 * Structural shape of a DOMParser. Returns `any` at the type boundary so both
 * the browser-native DOMParser and Node-side polyfills (e.g. @xmldom/xmldom)
 * satisfy the interface — their `Document` types are structurally equivalent
 * but nominally distinct, and TS's strict mode rejects the cross-assignment.
 * Internally we treat the result as a DOM Document.
 */
export interface DomParserLike {
    parseFromString(source: string, mimeType: string): unknown;
}

export interface DomSerializerLike {
    serializeToString(node: unknown): string;
}

export interface ImportBpmnOptions {
    domParser?: DomParserLike;
    xmlSerializer?: DomSerializerLike;
}

const XML_MIME_TYPE = "application/xml";
const ELEMENT_NODE = 1;
const FALLBACK_DIAGRAM_WIDTH = 800;
const FALLBACK_DIAGRAM_HEIGHT = 600;
const PADDING_AROUND_CONTENT = 24;

const ELEMENT_NS_ATTR = "bpmnElement";

interface ParseContext {
    serializer: DomSerializerLike;
    processes: Record<string, BpmnProcess>;
    nodes: Record<string, BpmnNode>;
    flows: Record<string, BpmnFlow>;
    nodePlacements: Record<string, BpmnNodePlacement>;
    flowPlacements: Record<string, BpmnFlowPlacement>;
    diNodeCount: number;
    diFlowCount: number;
}

export function importBpmnDiagram(xml: string, opts: ImportBpmnOptions = {}): BpmnDiagram {
    const parser = opts.domParser ?? defaultDomParser();
    const serializer = opts.xmlSerializer ?? defaultXmlSerializer();
    const doc = parser.parseFromString(xml, XML_MIME_TYPE) as Document;
    const root = doc.documentElement;
    if (!root || root.namespaceURI !== BPMN_NS || root.localName !== "definitions") {
        throw new Error("doodles-bpmn: root element must be <bpmn:definitions> in the BPMN 2.0 model namespace");
    }
    const ctx: ParseContext = {
        serializer,
        processes: {},
        nodes: {},
        flows: {},
        nodePlacements: {},
        flowPlacements: {},
        diNodeCount: 0,
        diFlowCount: 0,
    };
    parseDefinitionsBody(root, ctx);
    const display = computeDisplayBounds(ctx.nodePlacements, ctx.flowPlacements);
    const out: BpmnDiagram = {
        id: root.getAttribute("id") ?? nanoid(),
        type: ElementType.BpmnDiagram,
        kind: "bpmn",
        display,
        processes: ctx.processes,
        nodes: ctx.nodes,
        flows: ctx.flows,
        nodePlacements: ctx.nodePlacements,
        flowPlacements: ctx.flowPlacements,
        hasLayout: ctx.diNodeCount > 0 || ctx.diFlowCount > 0,
        source: buildSource(root, xml),
    };
    const definitionsExt = collectExtensions(root, serializer);
    if (definitionsExt) out.extensions = definitionsExt;
    return out;
}

// ── Default DOM bindings ────────────────────────────────────────────────────

function defaultDomParser(): DomParserLike {
    const ctor = (globalThis as {DOMParser?: new () => DomParserLike}).DOMParser;
    if (!ctor) throw new Error("doodles-bpmn: no DOMParser available; pass opts.domParser (e.g. from @xmldom/xmldom in Node).");
    return new ctor();
}

function defaultXmlSerializer(): DomSerializerLike {
    const ctor = (globalThis as {XMLSerializer?: new () => DomSerializerLike}).XMLSerializer;
    if (!ctor) throw new Error("doodles-bpmn: no XMLSerializer available; pass opts.xmlSerializer (e.g. from @xmldom/xmldom in Node).");
    return new ctor();
}

// ── Definitions body ────────────────────────────────────────────────────────

function parseDefinitionsBody(root: Element, ctx: ParseContext): void {
    const ownedChildren = ownedNsChildren(root);
    for (const el of ownedChildren) {
        if (el.namespaceURI !== BPMN_NS) continue;
        if (el.localName === "collaboration") parseCollaboration(el, ctx);
        else if (el.localName === "process") parseProcess(el, ctx);
    }
    for (const el of ownedChildren) {
        if (el.namespaceURI === BPMNDI_NS && el.localName === "BPMNDiagram") {
            parseBpmnDiagramElement(el, ctx);
        }
    }
}

// ── Collaboration: pools + message flows ────────────────────────────────────

function parseCollaboration(el: Element, ctx: ParseContext): void {
    for (const child of ownedNsChildren(el)) {
        if (child.namespaceURI !== BPMN_NS) continue;
        if (child.localName === "participant") ctx.nodes[requireId(child)] = parseParticipant(child, ctx);
        else if (child.localName === "messageFlow") ctx.flows[requireId(child)] = parseMessageFlow(child, ctx);
    }
}

function parseParticipant(el: Element, ctx: ParseContext): BpmnPool {
    const id = requireId(el);
    const out: BpmnPool = {
        id,
        kind: BpmnElementKind.Pool,
        // BPMNShape.isHorizontal sets the actual orientation; default to horizontal.
        orientation: BpmnPoolOrientation.Horizontal,
    };
    const name = el.getAttribute("name");
    if (name) out.name = name;
    const processRef = el.getAttribute("processRef");
    if (processRef) out.processRef = processRef;
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

function parseMessageFlow(el: Element, ctx: ParseContext): BpmnFlow {
    return parseFlowElement(el, ctx, BpmnFlowKind.Message);
}

// ── Process: flow elements + lanes ──────────────────────────────────────────

function parseProcess(el: Element, ctx: ParseContext): void {
    const processId = requireId(el);
    ctx.processes[processId] = buildProcess(el, ctx);
    const laneSets: Element[] = [];
    for (const child of ownedNsChildren(el)) {
        if (child.namespaceURI !== BPMN_NS) continue;
        if (child.localName === "laneSet") laneSets.push(child);
        else parseProcessChild(child, processId, ctx);
    }
    // Lane sets are parsed after flow nodes so we can stamp parentRef on the
    // contained nodes — they may appear before or after the laneSet in XML.
    for (const laneSet of laneSets) parseLaneSet(laneSet, processId, ctx);
}

function buildProcess(el: Element, ctx: ParseContext): BpmnProcess {
    const out: BpmnProcess = {id: requireId(el)};
    const name = el.getAttribute("name");
    if (name) out.name = name;
    const isExecutable = el.getAttribute("isExecutable");
    if (isExecutable !== null) out.isExecutable = isExecutable === "true";
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

function parseProcessChild(el: Element, processId: string, ctx: ParseContext): void {
    const id = el.getAttribute("id");
    if (!id) return;
    if (el.localName === "sequenceFlow") {
        ctx.flows[id] = parseFlowElement(el, ctx, BpmnFlowKind.Sequence);
        return;
    }
    if (el.localName === "association") {
        ctx.flows[id] = parseFlowElement(el, ctx, BpmnFlowKind.Association);
        return;
    }
    const node = parseFlowNode(el, ctx);
    if (!node) return;
    if (!node.parentRef) node.parentRef = processId;
    ctx.nodes[id] = node;
}

function parseLaneSet(el: Element, processId: string, ctx: ParseContext): void {
    for (const child of ownedNsChildren(el)) {
        if (child.namespaceURI === BPMN_NS && child.localName === "lane") {
            const lane = parseLane(child, processId, ctx);
            ctx.nodes[lane.id] = lane;
            // Stamp each member's parent to the lane (overrides processId fallback).
            for (const memberId of lane.flowNodeRefs) {
                const member = ctx.nodes[memberId];
                if (member) member.parentRef = lane.id;
            }
        }
    }
}

function parseLane(el: Element, processId: string, ctx: ParseContext): BpmnLane {
    const id = requireId(el);
    const flowNodeRefs: string[] = [];
    for (const child of ownedNsChildren(el)) {
        if (child.namespaceURI !== BPMN_NS) continue;
        if (child.localName === "flowNodeRef") {
            const ref = (child.textContent ?? "").trim();
            if (ref) flowNodeRefs.push(ref);
        }
    }
    const out: BpmnLane = {
        id,
        kind: BpmnElementKind.Lane,
        flowNodeRefs,
        parentRef: processId,
    };
    const name = el.getAttribute("name");
    if (name) out.name = name;
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

// ── Flow node dispatch ──────────────────────────────────────────────────────

const ACTIVITY_LOCAL_NAMES: Record<string, BpmnActivity["kind"]> = {
    task: BpmnElementKind.Task,
    userTask: BpmnElementKind.UserTask,
    serviceTask: BpmnElementKind.ServiceTask,
    subProcess: BpmnElementKind.Subprocess,
    callActivity: BpmnElementKind.CallActivity,
};

const EVENT_LOCAL_NAMES: Record<string, BpmnEvent["kind"]> = {
    startEvent: BpmnElementKind.StartEvent,
    endEvent: BpmnElementKind.EndEvent,
    intermediateThrowEvent: BpmnElementKind.IntermediateThrowEvent,
    intermediateCatchEvent: BpmnElementKind.IntermediateCatchEvent,
};

const GATEWAY_LOCAL_NAMES: Record<string, BpmnGateway["kind"]> = {
    exclusiveGateway: BpmnElementKind.ExclusiveGateway,
    parallelGateway: BpmnElementKind.ParallelGateway,
    inclusiveGateway: BpmnElementKind.InclusiveGateway,
    eventBasedGateway: BpmnElementKind.EventBasedGateway,
};

function parseFlowNode(el: Element, ctx: ParseContext): BpmnNode | null {
    const activityKind = ACTIVITY_LOCAL_NAMES[el.localName];
    if (activityKind) return parseActivity(el, ctx, activityKind);
    const eventKind = EVENT_LOCAL_NAMES[el.localName];
    if (eventKind) return parseEvent(el, ctx, eventKind);
    const gatewayKind = GATEWAY_LOCAL_NAMES[el.localName];
    if (gatewayKind) return parseGateway(el, ctx, gatewayKind);
    if (el.localName === "dataObjectReference" || el.localName === "dataObject") return parseDataObject(el, ctx, BpmnElementKind.DataObject);
    if (el.localName === "dataStoreReference") return parseDataObject(el, ctx, BpmnElementKind.DataStore);
    if (el.localName === "textAnnotation") return parseTextAnnotation(el, ctx);
    if (el.localName === "group") return parseGroup(el, ctx);
    return null;
}

function parseActivity(el: Element, ctx: ParseContext, kind: BpmnActivity["kind"]): BpmnActivity {
    const out: BpmnActivity = {id: requireId(el), kind};
    applyBaseAttrs(el, out);
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

function parseEvent(el: Element, ctx: ParseContext, kind: BpmnEvent["kind"]): BpmnEvent {
    const out: BpmnEvent = {id: requireId(el), kind, eventDefinition: detectEventDefinition(el)};
    applyBaseAttrs(el, out);
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

const EVENT_DEFINITION_LOCAL_NAMES: Record<string, BpmnEventDefinition> = {
    messageEventDefinition: BpmnEventDefinition.Message,
    timerEventDefinition: BpmnEventDefinition.Timer,
    terminateEventDefinition: BpmnEventDefinition.Terminate,
};

function detectEventDefinition(el: Element): BpmnEventDefinition {
    for (const child of ownedNsChildren(el)) {
        if (child.namespaceURI !== BPMN_NS) continue;
        const mapped = EVENT_DEFINITION_LOCAL_NAMES[child.localName];
        if (mapped) return mapped;
    }
    return BpmnEventDefinition.None;
}

function parseGateway(el: Element, ctx: ParseContext, kind: BpmnGateway["kind"]): BpmnGateway {
    const out: BpmnGateway = {id: requireId(el), kind, direction: readGatewayDirection(el)};
    applyBaseAttrs(el, out);
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

function readGatewayDirection(el: Element): BpmnGatewayDirection {
    const raw = el.getAttribute("gatewayDirection");
    switch (raw) {
        case "Diverging": return BpmnGatewayDirection.Diverging;
        case "Converging": return BpmnGatewayDirection.Converging;
        case "Mixed": return BpmnGatewayDirection.Mixed;
        default: return BpmnGatewayDirection.Unspecified;
    }
}

function parseDataObject(el: Element, ctx: ParseContext, kind: BpmnDataObject["kind"]): BpmnDataObject {
    const out: BpmnDataObject = {id: requireId(el), kind};
    applyBaseAttrs(el, out);
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

function parseTextAnnotation(el: Element, ctx: ParseContext): BpmnTextAnnotation {
    const text = textContentOfChild(el, "text") ?? el.textContent ?? "";
    const out: BpmnTextAnnotation = {id: requireId(el), kind: BpmnElementKind.TextAnnotation, text: text.trim()};
    applyBaseAttrs(el, out);
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

function parseGroup(el: Element, ctx: ParseContext): BpmnGroup {
    const out: BpmnGroup = {id: requireId(el), kind: BpmnElementKind.Group};
    applyBaseAttrs(el, out);
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

function applyBaseAttrs(el: Element, target: {name?: string}): void {
    const name = el.getAttribute("name");
    if (name) target.name = name;
}

// ── Flows ───────────────────────────────────────────────────────────────────

function parseFlowElement(el: Element, ctx: ParseContext, kind: BpmnFlow["kind"]): BpmnFlow {
    const id = requireId(el);
    const sourceRef = el.getAttribute("sourceRef") ?? "";
    const targetRef = el.getAttribute("targetRef") ?? "";
    const out: BpmnFlow = {id, kind, sourceRef, targetRef};
    const name = el.getAttribute("name");
    if (name) out.name = name;
    const condition = textContentOfChild(el, "conditionExpression");
    if (condition) out.condition = condition.trim();
    const ext = collectExtensions(el, ctx.serializer);
    if (ext) out.extensions = ext;
    return out;
}

// ── BPMNDI (layout) ─────────────────────────────────────────────────────────

function parseBpmnDiagramElement(el: Element, ctx: ParseContext): void {
    for (const plane of ownedNsChildren(el)) {
        if (plane.namespaceURI === BPMNDI_NS && plane.localName === "BPMNPlane") parsePlane(plane, ctx);
    }
}

function parsePlane(plane: Element, ctx: ParseContext): void {
    for (const child of ownedNsChildren(plane)) {
        if (child.namespaceURI !== BPMNDI_NS) continue;
        if (child.localName === "BPMNShape") parseShape(child, ctx);
        else if (child.localName === "BPMNEdge") parseEdge(child, ctx);
    }
}

function parseShape(shape: Element, ctx: ParseContext): void {
    const elementId = shape.getAttribute(ELEMENT_NS_ATTR);
    if (!elementId) return;
    const bounds = readDcBounds(shape);
    if (!bounds) return;
    const placement: BpmnNodePlacement = {bounds};
    const isHorizontal = shape.getAttribute("isHorizontal");
    if (isHorizontal !== null) placement.isHorizontal = isHorizontal === "true";
    ctx.nodePlacements[elementId] = placement;
    ctx.diNodeCount++;
    applyOrientationFromShape(elementId, placement, ctx);
}

function applyOrientationFromShape(elementId: string, placement: BpmnNodePlacement, ctx: ParseContext): void {
    if (placement.isHorizontal === undefined) return;
    const node = ctx.nodes[elementId];
    if (node?.kind === BpmnElementKind.Pool) {
        node.orientation = placement.isHorizontal ? BpmnPoolOrientation.Horizontal : BpmnPoolOrientation.Vertical;
    }
}

function readDcBounds(shape: Element): Bounds | undefined {
    for (const child of childElements(shape)) {
        if (child.namespaceURI === DC_NS && child.localName === "Bounds") return parseBoundsAttrs(child);
    }
    return undefined;
}

function parseBoundsAttrs(el: Element): Bounds {
    return {
        x: parseFloat(el.getAttribute("x") ?? "0"),
        y: parseFloat(el.getAttribute("y") ?? "0"),
        width: parseFloat(el.getAttribute("width") ?? "0"),
        height: parseFloat(el.getAttribute("height") ?? "0"),
    };
}

function parseEdge(edge: Element, ctx: ParseContext): void {
    const elementId = edge.getAttribute(ELEMENT_NS_ATTR);
    if (!elementId) return;
    const waypoints: Coordinate[] = [];
    for (const child of childElements(edge)) {
        if (child.namespaceURI === DI_NS && child.localName === "waypoint") waypoints.push(parseWaypoint(child));
    }
    if (waypoints.length < 2) return;
    const placement: BpmnFlowPlacement = {waypoints};
    const labelBounds = readBpmnLabelBounds(edge);
    if (labelBounds) placement.labelBounds = labelBounds;
    ctx.flowPlacements[elementId] = placement;
    ctx.diFlowCount++;
}

function parseWaypoint(el: Element): Coordinate {
    return {
        x: parseFloat(el.getAttribute("x") ?? "0"),
        y: parseFloat(el.getAttribute("y") ?? "0"),
    };
}

function readBpmnLabelBounds(edge: Element): Bounds | undefined {
    for (const child of childElements(edge)) {
        if (child.namespaceURI === BPMNDI_NS && child.localName === "BPMNLabel") {
            for (const inner of childElements(child)) {
                if (inner.namespaceURI === DC_NS && inner.localName === "Bounds") return parseBoundsAttrs(inner);
            }
        }
    }
    return undefined;
}

// ── Source preservation ────────────────────────────────────────────────────

function buildSource(root: Element, rawXml: string): NonNullable<BpmnDiagram["source"]> {
    const namespaces: Record<string, string> = {};
    for (let i = 0; i < root.attributes.length; i++) {
        const a = root.attributes.item(i);
        if (!a) continue;
        if (a.name === "xmlns") namespaces[""] = a.value;
        else if (a.name.startsWith("xmlns:")) namespaces[a.name.slice("xmlns:".length)] = a.value;
    }
    const out: NonNullable<BpmnDiagram["source"]> = {format: BpmnSourceFormat.BpmnXml, raw: rawXml, namespaces};
    const target = root.getAttribute("targetNamespace");
    if (target) out.targetNamespace = target;
    const id = root.getAttribute("id");
    if (id) out.definitionsId = id;
    return out;
}

// ── Extension passthrough ──────────────────────────────────────────────────

/**
 * Capture foreign-namespace attributes (other than xmlns declarations) and any
 * foreign-namespace child elements — including children of <bpmn:extensionElements>
 * — into an opaque BpmnExtensions struct. Returned undefined when nothing is
 * present, to keep model objects clean.
 */
function collectExtensions(el: Element, serializer: DomSerializerLike): BpmnExtensions | undefined {
    const attrs = collectForeignAttrs(el);
    const children = collectForeignChildren(el, serializer);
    if (attrs.length === 0 && children.length === 0) return undefined;
    const out: BpmnExtensions = {};
    if (attrs.length > 0) out.attrs = attrs;
    if (children.length > 0) out.children = children;
    return out;
}

function collectForeignAttrs(el: Element): BpmnExtensionAttr[] {
    const out: BpmnExtensionAttr[] = [];
    for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes.item(i);
        if (!a) continue;
        if (a.name === "xmlns" || a.name.startsWith("xmlns:")) continue;
        // Unprefixed attributes (namespaceURI null) belong to the element by
        // BPMN convention — only prefixed attrs in a non-owned namespace are
        // genuine foreign extensions.
        if (a.namespaceURI === null) continue;
        if (!OWNED_NAMESPACES.has(a.namespaceURI)) out.push({qname: a.name, value: a.value});
    }
    return out;
}

function collectForeignChildren(el: Element, serializer: DomSerializerLike): BpmnExtensionChild[] {
    const out: BpmnExtensionChild[] = [];
    for (const child of childElements(el)) {
        if (!isOwnedNamespace(child.namespaceURI)) {
            out.push({xml: serializer.serializeToString(child)});
            continue;
        }
        if (child.namespaceURI === BPMN_NS && child.localName === "extensionElements") {
            for (const ext of childElements(child)) {
                if (!isOwnedNamespace(ext.namespaceURI)) out.push({xml: serializer.serializeToString(ext)});
            }
        }
    }
    return out;
}

function isOwnedNamespace(ns: string | null): boolean {
    return ns !== null && OWNED_NAMESPACES.has(ns);
}

// ── DOM helpers ─────────────────────────────────────────────────────────────

function childElements(el: Element): Element[] {
    const out: Element[] = [];
    for (let i = 0; i < el.childNodes.length; i++) {
        const c = el.childNodes.item(i);
        if (c && c.nodeType === ELEMENT_NODE) out.push(c as Element);
    }
    return out;
}

function ownedNsChildren(el: Element): Element[] {
    return childElements(el).filter(c => isOwnedNamespace(c.namespaceURI));
}

function textContentOfChild(el: Element, localName: string): string | undefined {
    for (const child of childElements(el)) {
        if (child.namespaceURI === BPMN_NS && child.localName === localName) return child.textContent ?? "";
    }
    return undefined;
}

function requireId(el: Element): string {
    const id = el.getAttribute("id");
    if (id) return id;
    return `${el.localName}_${nanoid(8)}`;
}

// ── Display bounds ──────────────────────────────────────────────────────────

function computeDisplayBounds(
    nodePlacements: Record<string, BpmnNodePlacement>,
    flowPlacements: Record<string, BpmnFlowPlacement>,
): BpmnDiagram["display"] {
    const placements = Object.values(nodePlacements);
    const waypointSets = Object.values(flowPlacements).map(f => f.waypoints);
    if (placements.length === 0 && waypointSets.length === 0) {
        return {...defaultDiagramDisplay, width: FALLBACK_DIAGRAM_WIDTH, height: FALLBACK_DIAGRAM_HEIGHT, offset: zeroCoordinate};
    }
    let minX = Number.POSITIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    for (const p of placements) {
        const {x, y, width, height} = p.bounds;
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x + width > maxX) maxX = x + width;
        if (y + height > maxY) maxY = y + height;
    }
    for (const waypoints of waypointSets) {
        for (const w of waypoints) {
            if (w.x < minX) minX = w.x;
            if (w.y < minY) minY = w.y;
            if (w.x > maxX) maxX = w.x;
            if (w.y > maxY) maxY = w.y;
        }
    }
    return {
        ...defaultDiagramDisplay,
        width: Math.max(0, maxX - minX) + PADDING_AROUND_CONTENT * 2,
        height: Math.max(0, maxY - minY) + PADDING_AROUND_CONTENT * 2,
        offset: {x: -minX + PADDING_AROUND_CONTENT, y: -minY + PADDING_AROUND_CONTENT},
    };
}
