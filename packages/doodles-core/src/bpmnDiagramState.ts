import type {Bounds, Coordinate} from "./bounds.js";
import type {Diagram} from "./diagram.js";
import type {Id} from "./element.js";

/**
 * Render-ready shape of a BPMN 2.0 diagram. Importers (doodles-bpmn) normalize
 * BPMN XML + BPMNDI into this; doodles-svg's BPMN renderer consumes it.
 *
 * Scope: the BPMN Descriptive subset — Activities (Task/User/Service/Subprocess/
 * CallActivity), Events (Start/End/Intermediate × none/message/timer/terminate),
 * Gateways (Exclusive/Parallel/Inclusive/EventBased), Flows (Sequence/Message/
 * Association), Containers (Pool/Lane), Artifacts (DataObject/DataStore/
 * TextAnnotation/Group). Compensation/escalation/signals, multi-instance markers,
 * and ad-hoc subprocesses are deferred.
 *
 * Foreign-namespace content (camunda:, zeebe:, vendor extensions) is preserved
 * verbatim on each node's `extensions` field so round-trip back to BPMN XML is
 * lossless across other tools.
 */

// ── Element kinds ───────────────────────────────────────────────────────────

export const BpmnElementKind = {
    // Activities
    Task: "task",
    UserTask: "userTask",
    ServiceTask: "serviceTask",
    Subprocess: "subprocess",
    CallActivity: "callActivity",
    // Events
    StartEvent: "startEvent",
    EndEvent: "endEvent",
    IntermediateThrowEvent: "intermediateThrowEvent",
    IntermediateCatchEvent: "intermediateCatchEvent",
    // Gateways
    ExclusiveGateway: "exclusiveGateway",
    ParallelGateway: "parallelGateway",
    InclusiveGateway: "inclusiveGateway",
    EventBasedGateway: "eventBasedGateway",
    // Containers
    Pool: "pool",
    Lane: "lane",
    // Artifacts
    DataObject: "dataObject",
    DataStore: "dataStore",
    TextAnnotation: "textAnnotation",
    Group: "group",
} as const;
export type BpmnElementKind = (typeof BpmnElementKind)[keyof typeof BpmnElementKind];

export const BpmnEventDefinition = {
    None: "none",
    Message: "message",
    Timer: "timer",
    Terminate: "terminate",
} as const;
export type BpmnEventDefinition = (typeof BpmnEventDefinition)[keyof typeof BpmnEventDefinition];

export const BpmnGatewayDirection = {
    Unspecified: "unspecified",
    Diverging: "diverging",
    Converging: "converging",
    Mixed: "mixed",
} as const;
export type BpmnGatewayDirection = (typeof BpmnGatewayDirection)[keyof typeof BpmnGatewayDirection];

export const BpmnFlowKind = {
    Sequence: "sequence",
    Message: "message",
    Association: "association",
} as const;
export type BpmnFlowKind = (typeof BpmnFlowKind)[keyof typeof BpmnFlowKind];

export const BpmnPoolOrientation = {
    Horizontal: "horizontal",
    Vertical: "vertical",
} as const;
export type BpmnPoolOrientation = (typeof BpmnPoolOrientation)[keyof typeof BpmnPoolOrientation];

export const BpmnSourceFormat = {
    BpmnXml: "bpmn-xml",
} as const;
export type BpmnSourceFormat = (typeof BpmnSourceFormat)[keyof typeof BpmnSourceFormat];

// ── Extension passthrough ───────────────────────────────────────────────────

/**
 * Foreign-namespace attribute captured for round-trip. `qname` is the qualified
 * name as it appeared in the source (e.g. "camunda:assignee"), preserving the
 * prefix so re-emission matches the input namespace declarations.
 */
export interface BpmnExtensionAttr {
    qname: string;
    value: string;
}

/**
 * Foreign-namespace child element captured as serialized XML for verbatim
 * re-emission. Storing as a string (rather than a DOM node) keeps the model
 * structured-clone-safe across worker / IPC boundaries.
 */
export interface BpmnExtensionChild {
    xml: string;
}

export interface BpmnExtensions {
    attrs?: BpmnExtensionAttr[];
    children?: BpmnExtensionChild[];
}

// ── Nodes ───────────────────────────────────────────────────────────────────

interface BpmnNodeBase {
    id: Id;
    name?: string;
    /** Containing pool/lane id, or undefined for top-level (e.g. pools, message flows). */
    parentRef?: Id;
    extensions?: BpmnExtensions;
}

type BpmnActivityKind =
    | typeof BpmnElementKind.Task
    | typeof BpmnElementKind.UserTask
    | typeof BpmnElementKind.ServiceTask
    | typeof BpmnElementKind.Subprocess
    | typeof BpmnElementKind.CallActivity;

export interface BpmnActivity extends BpmnNodeBase {
    kind: BpmnActivityKind;
}

type BpmnEventNodeKind =
    | typeof BpmnElementKind.StartEvent
    | typeof BpmnElementKind.EndEvent
    | typeof BpmnElementKind.IntermediateThrowEvent
    | typeof BpmnElementKind.IntermediateCatchEvent;

export interface BpmnEvent extends BpmnNodeBase {
    kind: BpmnEventNodeKind;
    eventDefinition: BpmnEventDefinition;
}

type BpmnGatewayKind =
    | typeof BpmnElementKind.ExclusiveGateway
    | typeof BpmnElementKind.ParallelGateway
    | typeof BpmnElementKind.InclusiveGateway
    | typeof BpmnElementKind.EventBasedGateway;

export interface BpmnGateway extends BpmnNodeBase {
    kind: BpmnGatewayKind;
    direction: BpmnGatewayDirection;
}

export interface BpmnPool extends BpmnNodeBase {
    kind: typeof BpmnElementKind.Pool;
    orientation: BpmnPoolOrientation;
    /** Process id this pool participates in. Empty for "black box" participants. */
    processRef?: Id;
}

export interface BpmnLane extends BpmnNodeBase {
    kind: typeof BpmnElementKind.Lane;
    /** Ids of flow nodes that belong to this lane (the lane is the parent on those nodes). */
    flowNodeRefs: Id[];
}

export interface BpmnDataObject extends BpmnNodeBase {
    kind: typeof BpmnElementKind.DataObject | typeof BpmnElementKind.DataStore;
}

export interface BpmnTextAnnotation extends BpmnNodeBase {
    kind: typeof BpmnElementKind.TextAnnotation;
    text: string;
}

export interface BpmnGroup extends BpmnNodeBase {
    kind: typeof BpmnElementKind.Group;
}

export type BpmnNode =
    | BpmnActivity
    | BpmnEvent
    | BpmnGateway
    | BpmnPool
    | BpmnLane
    | BpmnDataObject
    | BpmnTextAnnotation
    | BpmnGroup;

// ── Process ─────────────────────────────────────────────────────────────────

/**
 * BPMN <bpmn:process> metadata. Flow nodes carry the process id via parentRef
 * (directly or through their lane); BpmnProcess just stores the attributes
 * that hang off the process element itself. Required for the writer to emit
 * &lt;bpmn:process&gt; with the right id/name/executable flag.
 */
export interface BpmnProcess {
    id: Id;
    name?: string;
    isExecutable?: boolean;
    extensions?: BpmnExtensions;
}

// ── Flows ───────────────────────────────────────────────────────────────────

export interface BpmnFlow {
    id: Id;
    kind: BpmnFlowKind;
    name?: string;
    sourceRef: Id;
    targetRef: Id;
    /** Sequence-flow condition expression (BPMN <conditionExpression>). */
    condition?: string;
    extensions?: BpmnExtensions;
}

// ── Diagram Interchange (layout) ────────────────────────────────────────────

export interface BpmnNodePlacement {
    bounds: Bounds;
    /** BPMNShape.isHorizontal on pool/lane shapes. */
    isHorizontal?: boolean;
}

export interface BpmnFlowPlacement {
    waypoints: Coordinate[];
    labelBounds?: Bounds;
}

// ── Source preservation ────────────────────────────────────────────────────

export interface BpmnSource {
    format: BpmnSourceFormat;
    /** Original XML — kept for round-trip / debugging. */
    raw?: string;
    /** Namespace declarations on the root <definitions> (prefix → uri). */
    namespaces?: Record<string, string>;
    targetNamespace?: string;
    definitionsId?: string;
}

// ── Top-level diagram ──────────────────────────────────────────────────────

export interface BpmnDiagram extends Diagram {
    kind: "bpmn";
    /** Processes keyed by id. Flow nodes reference these via parentRef (directly or via a Lane). */
    processes: Record<Id, BpmnProcess>;
    /** All BPMN nodes (activities/events/gateways/containers/artifacts) keyed by id. */
    nodes: Record<Id, BpmnNode>;
    /** All flows (sequence/message/association) keyed by id. */
    flows: Record<Id, BpmnFlow>;
    /** DI: per-node placement. Empty when XML had no BPMNDI. */
    nodePlacements: Record<Id, BpmnNodePlacement>;
    /** DI: per-flow placement (waypoints). Empty when XML had no BPMNDI. */
    flowPlacements: Record<Id, BpmnFlowPlacement>;
    /** True when the source XML included BPMNDI for at least one element. */
    hasLayout: boolean;
    /** Diagram-level extensions (foreign-namespace attrs/children on <definitions>). */
    extensions?: BpmnExtensions;
    source?: BpmnSource;
}
