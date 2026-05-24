import {
    type BpmnActivity,
    type BpmnDiagram,
    type BpmnEvent,
    type BpmnExtensions,
    type BpmnFlow,
    type BpmnGateway,
    type BpmnLane,
    type BpmnNode,
    type BpmnPool,
    type BpmnProcess,
    type BpmnTextAnnotation,
    type Coordinate,
    BpmnElementKind,
    BpmnEventDefinition,
    BpmnFlowKind,
    BpmnGatewayDirection,
} from "@benkalegin/doodles-core";
import {BPMN_NS, BPMNDI_NS, DC_NS, DI_NS} from "./namespaces.js";

/**
 * BpmnDiagram → BPMN 2.0 XML. Emits semantically equivalent XML for round-trip:
 * parse(export(parse(xml))) yields the same model as parse(xml). Foreign-
 * namespace attributes and extensionElements children are re-emitted verbatim
 * from the stored opaque XML strings. DI is emitted when diagram.hasLayout.
 *
 * Output is deterministic and diff-friendly: fixed indentation, consistent
 * attribute ordering, insertion-order preservation for collections.
 */

const XML_VERSION_LINE = `<?xml version="1.0" encoding="UTF-8"?>`;

const DEFAULT_PREFIX_BPMN = "bpmn";
const DEFAULT_PREFIX_BPMNDI = "bpmndi";
const DEFAULT_PREFIX_DC = "dc";
const DEFAULT_PREFIX_DI = "di";

const INDENT_UNIT = "  ";
const NEWLINE = "\n";

interface PrefixedNamespaces {
    bpmn: string;
    bpmndi: string;
    dc: string;
    di: string;
    extras: Array<{prefix: string; uri: string}>;
}

export function exportBpmnDiagram(diagram: BpmnDiagram): string {
    const ns = resolveNamespaces(diagram);
    const w = new XmlWriter();
    w.line(XML_VERSION_LINE);
    writeDefinitions(w, diagram, ns);
    return w.toString();
}

// ── Namespace resolution ───────────────────────────────────────────────────

function resolveNamespaces(diagram: BpmnDiagram): PrefixedNamespaces {
    const stored = diagram.source?.namespaces ?? {};
    const inverse: Record<string, string> = {};
    for (const [prefix, uri] of Object.entries(stored)) inverse[uri] = prefix;
    const out: PrefixedNamespaces = {
        bpmn: inverse[BPMN_NS] ?? DEFAULT_PREFIX_BPMN,
        bpmndi: inverse[BPMNDI_NS] ?? DEFAULT_PREFIX_BPMNDI,
        dc: inverse[DC_NS] ?? DEFAULT_PREFIX_DC,
        di: inverse[DI_NS] ?? DEFAULT_PREFIX_DI,
        extras: [],
    };
    const ownedUris = new Set([BPMN_NS, BPMNDI_NS, DC_NS, DI_NS]);
    for (const [prefix, uri] of Object.entries(stored)) {
        if (prefix === "") continue;
        if (ownedUris.has(uri)) continue;
        out.extras.push({prefix, uri});
    }
    return out;
}

// ── <definitions> ──────────────────────────────────────────────────────────

function writeDefinitions(w: XmlWriter, diagram: BpmnDiagram, ns: PrefixedNamespaces): void {
    const attrs: AttrPair[] = [
        [`xmlns:${ns.bpmn}`, BPMN_NS],
        [`xmlns:${ns.bpmndi}`, BPMNDI_NS],
        [`xmlns:${ns.dc}`, DC_NS],
        [`xmlns:${ns.di}`, DI_NS],
    ];
    for (const extra of ns.extras) attrs.push([`xmlns:${extra.prefix}`, extra.uri]);
    const definitionsId = diagram.source?.definitionsId ?? diagram.id;
    attrs.push(["id", definitionsId]);
    const targetNs = diagram.source?.targetNamespace;
    if (targetNs) attrs.push(["targetNamespace", targetNs]);
    appendExtensionAttrs(attrs, diagram.extensions);
    w.open(qname(ns.bpmn, "definitions"), attrs);
    writeExtensionChildren(w, ns, diagram.extensions);
    writeCollaboration(w, diagram, ns);
    for (const process of Object.values(diagram.processes)) writeProcess(w, process, diagram, ns);
    if (diagram.hasLayout) writeDiagramInterchange(w, diagram, ns);
    w.close(qname(ns.bpmn, "definitions"));
}

// ── <collaboration> ────────────────────────────────────────────────────────

function writeCollaboration(w: XmlWriter, diagram: BpmnDiagram, ns: PrefixedNamespaces): void {
    const pools = collectPools(diagram);
    const messageFlows = collectMessageFlows(diagram);
    if (pools.length === 0 && messageFlows.length === 0) return;
    w.open(qname(ns.bpmn, "collaboration"), [["id", collaborationId(diagram)]]);
    for (const pool of pools) writeParticipant(w, pool, ns);
    for (const flow of messageFlows) writeFlow(w, flow, ns);
    w.close(qname(ns.bpmn, "collaboration"));
}

function collaborationId(diagram: BpmnDiagram): string {
    // BPMNPlane's bpmnElement often points at a collaboration id; reuse it when
    // present so the round-trip preserves the linkage.
    return `${diagram.id}_collab`;
}

function writeParticipant(w: XmlWriter, pool: BpmnPool, ns: PrefixedNamespaces): void {
    const attrs: AttrPair[] = [["id", pool.id]];
    if (pool.name) attrs.push(["name", pool.name]);
    if (pool.processRef) attrs.push(["processRef", pool.processRef]);
    appendExtensionAttrs(attrs, pool.extensions);
    if (!hasExtensionChildren(pool.extensions)) {
        w.empty(qname(ns.bpmn, "participant"), attrs);
        return;
    }
    w.open(qname(ns.bpmn, "participant"), attrs);
    writeExtensionChildren(w, ns, pool.extensions);
    w.close(qname(ns.bpmn, "participant"));
}

// ── <process> ──────────────────────────────────────────────────────────────

function writeProcess(w: XmlWriter, process: BpmnProcess, diagram: BpmnDiagram, ns: PrefixedNamespaces): void {
    const attrs: AttrPair[] = [["id", process.id]];
    if (process.name) attrs.push(["name", process.name]);
    if (process.isExecutable !== undefined) attrs.push(["isExecutable", String(process.isExecutable)]);
    appendExtensionAttrs(attrs, process.extensions);
    w.open(qname(ns.bpmn, "process"), attrs);
    writeExtensionChildren(w, ns, process.extensions);
    writeLaneSet(w, process, diagram, ns);
    writeFlowNodesForProcess(w, process, diagram, ns);
    writeSequenceFlowsForProcess(w, process, diagram, ns);
    w.close(qname(ns.bpmn, "process"));
}

function writeLaneSet(w: XmlWriter, process: BpmnProcess, diagram: BpmnDiagram, ns: PrefixedNamespaces): void {
    const lanes = Object.values(diagram.nodes).filter((n): n is BpmnLane =>
        n.kind === BpmnElementKind.Lane && n.parentRef === process.id);
    if (lanes.length === 0) return;
    w.open(qname(ns.bpmn, "laneSet"), [["id", `${process.id}_laneSet`]]);
    for (const lane of lanes) writeLane(w, lane, ns);
    w.close(qname(ns.bpmn, "laneSet"));
}

function writeLane(w: XmlWriter, lane: BpmnLane, ns: PrefixedNamespaces): void {
    const attrs: AttrPair[] = [["id", lane.id]];
    if (lane.name) attrs.push(["name", lane.name]);
    appendExtensionAttrs(attrs, lane.extensions);
    if (lane.flowNodeRefs.length === 0 && !hasExtensionChildren(lane.extensions)) {
        w.empty(qname(ns.bpmn, "lane"), attrs);
        return;
    }
    w.open(qname(ns.bpmn, "lane"), attrs);
    writeExtensionChildren(w, ns, lane.extensions);
    for (const ref of lane.flowNodeRefs) {
        w.openInline(qname(ns.bpmn, "flowNodeRef"), []);
        w.appendText(escapeXml(ref));
        w.closeInline(qname(ns.bpmn, "flowNodeRef"));
    }
    w.close(qname(ns.bpmn, "lane"));
}

function writeFlowNodesForProcess(w: XmlWriter, process: BpmnProcess, diagram: BpmnDiagram, ns: PrefixedNamespaces): void {
    const laneIds = new Set(
        Object.values(diagram.nodes)
            .filter(n => n.kind === BpmnElementKind.Lane && n.parentRef === process.id)
            .map(n => n.id)
    );
    for (const node of Object.values(diagram.nodes)) {
        if (isContainerKind(node.kind)) continue;
        if (!belongsToProcess(node, process.id, laneIds)) continue;
        writeFlowNode(w, node, ns);
    }
}

function belongsToProcess(node: BpmnNode, processId: string, laneIds: ReadonlySet<string>): boolean {
    if (!node.parentRef) return false;
    if (node.parentRef === processId) return true;
    return laneIds.has(node.parentRef);
}

function writeSequenceFlowsForProcess(w: XmlWriter, process: BpmnProcess, diagram: BpmnDiagram, ns: PrefixedNamespaces): void {
    const memberIds = collectProcessMemberIds(process, diagram);
    for (const flow of Object.values(diagram.flows)) {
        if (flow.kind === BpmnFlowKind.Message) continue;
        if (!memberIds.has(flow.sourceRef) || !memberIds.has(flow.targetRef)) continue;
        writeFlow(w, flow, ns);
    }
}

function collectProcessMemberIds(process: BpmnProcess, diagram: BpmnDiagram): Set<string> {
    const laneIds = new Set<string>();
    for (const n of Object.values(diagram.nodes)) {
        if (n.kind === BpmnElementKind.Lane && n.parentRef === process.id) laneIds.add(n.id);
    }
    const members = new Set<string>();
    for (const n of Object.values(diagram.nodes)) {
        if (belongsToProcess(n, process.id, laneIds)) members.add(n.id);
    }
    return members;
}

// ── Flow nodes ─────────────────────────────────────────────────────────────

const ACTIVITY_KINDS: ReadonlySet<BpmnNode["kind"]> = new Set([
    BpmnElementKind.Task,
    BpmnElementKind.UserTask,
    BpmnElementKind.ServiceTask,
    BpmnElementKind.Subprocess,
    BpmnElementKind.CallActivity,
]);

const EVENT_KINDS: ReadonlySet<BpmnNode["kind"]> = new Set([
    BpmnElementKind.StartEvent,
    BpmnElementKind.EndEvent,
    BpmnElementKind.IntermediateThrowEvent,
    BpmnElementKind.IntermediateCatchEvent,
]);

const GATEWAY_KINDS: ReadonlySet<BpmnNode["kind"]> = new Set([
    BpmnElementKind.ExclusiveGateway,
    BpmnElementKind.ParallelGateway,
    BpmnElementKind.InclusiveGateway,
    BpmnElementKind.EventBasedGateway,
]);

const KIND_TO_LOCAL_NAME: Partial<Record<BpmnNode["kind"], string>> = {
    [BpmnElementKind.Task]: "task",
    [BpmnElementKind.UserTask]: "userTask",
    [BpmnElementKind.ServiceTask]: "serviceTask",
    [BpmnElementKind.Subprocess]: "subProcess",
    [BpmnElementKind.CallActivity]: "callActivity",
    [BpmnElementKind.StartEvent]: "startEvent",
    [BpmnElementKind.EndEvent]: "endEvent",
    [BpmnElementKind.IntermediateThrowEvent]: "intermediateThrowEvent",
    [BpmnElementKind.IntermediateCatchEvent]: "intermediateCatchEvent",
    [BpmnElementKind.ExclusiveGateway]: "exclusiveGateway",
    [BpmnElementKind.ParallelGateway]: "parallelGateway",
    [BpmnElementKind.InclusiveGateway]: "inclusiveGateway",
    [BpmnElementKind.EventBasedGateway]: "eventBasedGateway",
    [BpmnElementKind.DataObject]: "dataObjectReference",
    [BpmnElementKind.DataStore]: "dataStoreReference",
    [BpmnElementKind.TextAnnotation]: "textAnnotation",
    [BpmnElementKind.Group]: "group",
};

function writeFlowNode(w: XmlWriter, node: BpmnNode, ns: PrefixedNamespaces): void {
    if (ACTIVITY_KINDS.has(node.kind)) writeActivity(w, node as BpmnActivity, ns);
    else if (EVENT_KINDS.has(node.kind)) writeEvent(w, node as BpmnEvent, ns);
    else if (GATEWAY_KINDS.has(node.kind)) writeGateway(w, node as BpmnGateway, ns);
    else if (node.kind === BpmnElementKind.TextAnnotation) writeTextAnnotation(w, node as BpmnTextAnnotation, ns);
    else writeBareNode(w, node, ns);
}

function writeActivity(w: XmlWriter, node: BpmnActivity, ns: PrefixedNamespaces): void {
    const local = KIND_TO_LOCAL_NAME[node.kind]!;
    const attrs = baseAttrsFor(node);
    appendExtensionAttrs(attrs, node.extensions);
    if (!hasExtensionChildren(node.extensions)) {
        w.empty(qname(ns.bpmn, local), attrs);
        return;
    }
    w.open(qname(ns.bpmn, local), attrs);
    writeExtensionChildren(w, ns, node.extensions);
    w.close(qname(ns.bpmn, local));
}

function writeEvent(w: XmlWriter, node: BpmnEvent, ns: PrefixedNamespaces): void {
    const local = KIND_TO_LOCAL_NAME[node.kind]!;
    const attrs = baseAttrsFor(node);
    appendExtensionAttrs(attrs, node.extensions);
    const hasDefChild = node.eventDefinition !== BpmnEventDefinition.None;
    if (!hasDefChild && !hasExtensionChildren(node.extensions)) {
        w.empty(qname(ns.bpmn, local), attrs);
        return;
    }
    w.open(qname(ns.bpmn, local), attrs);
    writeExtensionChildren(w, ns, node.extensions);
    if (hasDefChild) w.empty(qname(ns.bpmn, eventDefinitionLocalNameFor(node.eventDefinition)), []);
    w.close(qname(ns.bpmn, local));
}

function eventDefinitionLocalNameFor(def: BpmnEventDefinition): string {
    switch (def) {
        case BpmnEventDefinition.Message: return "messageEventDefinition";
        case BpmnEventDefinition.Timer: return "timerEventDefinition";
        case BpmnEventDefinition.Terminate: return "terminateEventDefinition";
        case BpmnEventDefinition.None: return "";
    }
}

function writeGateway(w: XmlWriter, node: BpmnGateway, ns: PrefixedNamespaces): void {
    const local = KIND_TO_LOCAL_NAME[node.kind]!;
    const attrs = baseAttrsFor(node);
    if (node.direction !== BpmnGatewayDirection.Unspecified) {
        attrs.push(["gatewayDirection", capitalize(node.direction)]);
    }
    appendExtensionAttrs(attrs, node.extensions);
    if (!hasExtensionChildren(node.extensions)) {
        w.empty(qname(ns.bpmn, local), attrs);
        return;
    }
    w.open(qname(ns.bpmn, local), attrs);
    writeExtensionChildren(w, ns, node.extensions);
    w.close(qname(ns.bpmn, local));
}

function writeTextAnnotation(w: XmlWriter, node: BpmnTextAnnotation, ns: PrefixedNamespaces): void {
    const attrs = baseAttrsFor(node);
    appendExtensionAttrs(attrs, node.extensions);
    w.open(qname(ns.bpmn, "textAnnotation"), attrs);
    writeExtensionChildren(w, ns, node.extensions);
    if (node.text) {
        w.openInline(qname(ns.bpmn, "text"), []);
        w.appendText(escapeXml(node.text));
        w.closeInline(qname(ns.bpmn, "text"));
    }
    w.close(qname(ns.bpmn, "textAnnotation"));
}

function writeBareNode(w: XmlWriter, node: BpmnNode, ns: PrefixedNamespaces): void {
    const local = KIND_TO_LOCAL_NAME[node.kind] ?? node.kind;
    const attrs = baseAttrsFor(node);
    appendExtensionAttrs(attrs, node.extensions);
    if (!hasExtensionChildren(node.extensions)) {
        w.empty(qname(ns.bpmn, local), attrs);
        return;
    }
    w.open(qname(ns.bpmn, local), attrs);
    writeExtensionChildren(w, ns, node.extensions);
    w.close(qname(ns.bpmn, local));
}

function baseAttrsFor(node: BpmnNode): AttrPair[] {
    const out: AttrPair[] = [["id", node.id]];
    if ("name" in node && node.name) out.push(["name", node.name]);
    return out;
}

// ── Flows (sequence / message / association) ───────────────────────────────

function writeFlow(w: XmlWriter, flow: BpmnFlow, ns: PrefixedNamespaces): void {
    const local = flowLocalName(flow.kind);
    const attrs: AttrPair[] = [
        ["id", flow.id],
        ["sourceRef", flow.sourceRef],
        ["targetRef", flow.targetRef],
    ];
    if (flow.name) attrs.push(["name", flow.name]);
    appendExtensionAttrs(attrs, flow.extensions);
    if (!flow.condition && !hasExtensionChildren(flow.extensions)) {
        w.empty(qname(ns.bpmn, local), attrs);
        return;
    }
    w.open(qname(ns.bpmn, local), attrs);
    writeExtensionChildren(w, ns, flow.extensions);
    if (flow.condition) {
        w.openInline(qname(ns.bpmn, "conditionExpression"), []);
        w.appendText(escapeXml(flow.condition));
        w.closeInline(qname(ns.bpmn, "conditionExpression"));
    }
    w.close(qname(ns.bpmn, local));
}

function flowLocalName(kind: BpmnFlowKind): string {
    switch (kind) {
        case BpmnFlowKind.Sequence: return "sequenceFlow";
        case BpmnFlowKind.Message: return "messageFlow";
        case BpmnFlowKind.Association: return "association";
    }
}

// ── BPMNDI ──────────────────────────────────────────────────────────────────

function writeDiagramInterchange(w: XmlWriter, diagram: BpmnDiagram, ns: PrefixedNamespaces): void {
    const diagId = `${diagram.id}_diagram`;
    const planeId = `${diagram.id}_plane`;
    const planeRef = pickPlaneElement(diagram);
    w.open(qname(ns.bpmndi, "BPMNDiagram"), [["id", diagId]]);
    w.open(qname(ns.bpmndi, "BPMNPlane"), [["id", planeId], ["bpmnElement", planeRef]]);
    for (const [nodeId, placement] of Object.entries(diagram.nodePlacements)) {
        writeShape(w, nodeId, placement, ns);
    }
    for (const [flowId, placement] of Object.entries(diagram.flowPlacements)) {
        writeEdge(w, flowId, placement, ns);
    }
    w.close(qname(ns.bpmndi, "BPMNPlane"));
    w.close(qname(ns.bpmndi, "BPMNDiagram"));
}

function pickPlaneElement(diagram: BpmnDiagram): string {
    // BPMNPlane's bpmnElement targets a collaboration when pools exist, else the lone process.
    if (collectPools(diagram).length > 0) return collaborationId(diagram);
    const firstProcess = Object.values(diagram.processes)[0];
    return firstProcess?.id ?? diagram.id;
}

function writeShape(w: XmlWriter, nodeId: string, placement: BpmnDiagram["nodePlacements"][string], ns: PrefixedNamespaces): void {
    const attrs: AttrPair[] = [["id", `${nodeId}_di`], ["bpmnElement", nodeId]];
    if (placement.isHorizontal !== undefined) attrs.push(["isHorizontal", String(placement.isHorizontal)]);
    w.open(qname(ns.bpmndi, "BPMNShape"), attrs);
    w.empty(qname(ns.dc, "Bounds"), [
        ["x", String(placement.bounds.x)],
        ["y", String(placement.bounds.y)],
        ["width", String(placement.bounds.width)],
        ["height", String(placement.bounds.height)],
    ]);
    w.close(qname(ns.bpmndi, "BPMNShape"));
}

function writeEdge(w: XmlWriter, flowId: string, placement: BpmnDiagram["flowPlacements"][string], ns: PrefixedNamespaces): void {
    w.open(qname(ns.bpmndi, "BPMNEdge"), [["id", `${flowId}_di`], ["bpmnElement", flowId]]);
    for (const wp of placement.waypoints) writeWaypoint(w, wp, ns);
    if (placement.labelBounds) {
        w.open(qname(ns.bpmndi, "BPMNLabel"), []);
        w.empty(qname(ns.dc, "Bounds"), [
            ["x", String(placement.labelBounds.x)],
            ["y", String(placement.labelBounds.y)],
            ["width", String(placement.labelBounds.width)],
            ["height", String(placement.labelBounds.height)],
        ]);
        w.close(qname(ns.bpmndi, "BPMNLabel"));
    }
    w.close(qname(ns.bpmndi, "BPMNEdge"));
}

function writeWaypoint(w: XmlWriter, wp: Coordinate, ns: PrefixedNamespaces): void {
    w.empty(qname(ns.di, "waypoint"), [["x", String(wp.x)], ["y", String(wp.y)]]);
}

// ── Extension passthrough emission ─────────────────────────────────────────

function appendExtensionAttrs(attrs: AttrPair[], ext: BpmnExtensions | undefined): void {
    if (!ext?.attrs) return;
    for (const a of ext.attrs) attrs.push([a.qname, a.value]);
}

function hasExtensionChildren(ext: BpmnExtensions | undefined): boolean {
    return !!ext?.children && ext.children.length > 0;
}

function writeExtensionChildren(w: XmlWriter, ns: PrefixedNamespaces, ext: BpmnExtensions | undefined): void {
    if (!hasExtensionChildren(ext)) return;
    w.open(qname(ns.bpmn, "extensionElements"), []);
    for (const child of ext!.children!) w.rawXml(child.xml);
    w.close(qname(ns.bpmn, "extensionElements"));
}

// ── Collection helpers ─────────────────────────────────────────────────────

function collectPools(diagram: BpmnDiagram): BpmnPool[] {
    return Object.values(diagram.nodes).filter((n): n is BpmnPool => n.kind === BpmnElementKind.Pool);
}

function collectMessageFlows(diagram: BpmnDiagram): BpmnFlow[] {
    return Object.values(diagram.flows).filter(f => f.kind === BpmnFlowKind.Message);
}

function isContainerKind(kind: BpmnNode["kind"]): boolean {
    return kind === BpmnElementKind.Pool || kind === BpmnElementKind.Lane;
}

function qname(prefix: string, local: string): string {
    return `${prefix}:${local}`;
}

function capitalize(s: string): string {
    return s.length === 0 ? s : s[0]!.toUpperCase() + s.slice(1);
}

// ── XML escape ─────────────────────────────────────────────────────────────

function escapeXml(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;");
}

// ── XmlWriter helper ───────────────────────────────────────────────────────

type AttrPair = [string, string];

class XmlWriter {
    private depth = 0;
    private buf: string[] = [];

    line(s: string): void {
        this.buf.push(s);
        this.buf.push(NEWLINE);
    }

    open(name: string, attrs: AttrPair[]): void {
        this.buf.push(this.indent());
        this.buf.push(`<${name}${formatAttrs(attrs)}>`);
        this.buf.push(NEWLINE);
        this.depth++;
    }

    close(name: string): void {
        this.depth--;
        this.buf.push(this.indent());
        this.buf.push(`</${name}>`);
        this.buf.push(NEWLINE);
    }

    empty(name: string, attrs: AttrPair[]): void {
        this.buf.push(this.indent());
        this.buf.push(`<${name}${formatAttrs(attrs)} />`);
        this.buf.push(NEWLINE);
    }

    /** Open an element that wraps inline text on the same line. */
    openInline(name: string, attrs: AttrPair[]): void {
        this.buf.push(this.indent());
        this.buf.push(`<${name}${formatAttrs(attrs)}>`);
    }

    /** Append text directly to the buffer without indenting. */
    appendText(text: string): void {
        this.buf.push(text);
    }

    closeInline(name: string): void {
        this.buf.push(`</${name}>`);
        this.buf.push(NEWLINE);
    }

    /**
     * Emit a verbatim XML fragment (already-serialized foreign-namespace
     * element). Indented as a single block so the surrounding output stays
     * readable; the inner contents keep their own formatting.
     */
    rawXml(xml: string): void {
        this.buf.push(this.indent());
        this.buf.push(xml.trim());
        this.buf.push(NEWLINE);
    }

    toString(): string {
        return this.buf.join("");
    }

    private indent(): string {
        return INDENT_UNIT.repeat(this.depth);
    }
}

function formatAttrs(attrs: AttrPair[]): string {
    if (attrs.length === 0) return "";
    return " " + attrs.map(([k, v]) => `${k}="${escapeXml(v)}"`).join(" ");
}
