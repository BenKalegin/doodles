/**
 * DiagramKind + KindConstraints registry — the metadata both consumers
 * (clouddiagram editor for UI rules, doodles-layout/doodles-svg for engine
 * choice) read to behave correctly per diagram kind.
 *
 * 0.1.0 ships with a single registered kind ('flowchart'). Subsequent
 * minor releases add entries as other kinds migrate over from clouddiagram.
 */

import {PortAlignment} from "./port.js";

export type DiagramKind =
    | "flowchart"
    | "class"
    | "sequence"
    | "gantt"
    | "er"
    | "pie"
    | "state"
    | "mindmap"
    | "deployment"
    | "chart"
    | "bpmn";

export interface PortRules {
    /** Which sides of a node may host ports. */
    sides: PortAlignment[];
    /** Optional cap on ports per side. */
    maxPerSide?: number;
    /** Whether the per-port edgePosRatio is user-editable. */
    edgePosRatioEditable: boolean;
}

export interface KindConstraints {
    /** Engine that lays this kind out. */
    layoutAlgorithm: "filigree-layered" | "sequence" | "gantt-timeline" | "er" | "pie" | "mind-map-radial" | "state-fsm" | "chart-axes" | "bpmn-flow";
    /** Pass-through algorithm options (engine-specific). */
    layoutOptions?: Record<string, unknown>;

    /** Renderer module id; dispatches in doodles-svg / cd-editor. */
    rendererId: string;

    /** How user gestures are constrained in the interactive editor. */
    movementAxes: "free" | "horizontal-only" | "vertical-only" | "lane-constrained" | "none";
    portRules: PortRules;
    /** True when reordering siblings changes meaning (sequence: yes; flowchart: no). */
    nodeOrderingMatters: boolean;

    /** Display-only marker, e.g., 'timeline' for gantt. */
    background?: "timeline" | "grid" | "none";
}

const FLOWCHART_CONSTRAINTS: KindConstraints = {
    layoutAlgorithm: "filigree-layered",
    rendererId: "svg-standard",
    movementAxes: "free",
    portRules: {
        sides: [PortAlignment.Top, PortAlignment.Bottom, PortAlignment.Left, PortAlignment.Right],
        edgePosRatioEditable: true,
    },
    nodeOrderingMatters: false,
    background: "none",
};

const CHART_CONSTRAINTS: KindConstraints = {
    layoutAlgorithm: "chart-axes",
    rendererId: "svg-chart",
    movementAxes: "none",
    portRules: {
        sides: [],
        edgePosRatioEditable: false,
    },
    nodeOrderingMatters: false,
    background: "grid",
};

const BPMN_CONSTRAINTS: KindConstraints = {
    layoutAlgorithm: "bpmn-flow",
    rendererId: "svg-bpmn",
    // Within-lane free movement; pool/lane reordering is constrained separately by the editor.
    movementAxes: "lane-constrained",
    portRules: {
        sides: [PortAlignment.Top, PortAlignment.Bottom, PortAlignment.Left, PortAlignment.Right],
        edgePosRatioEditable: true,
    },
    // BPMN gateways and sequence flows derive meaning from connectivity, not sibling order.
    nodeOrderingMatters: false,
    background: "none",
};

const KIND_REGISTRY: Partial<Record<DiagramKind, KindConstraints>> = {
    flowchart: FLOWCHART_CONSTRAINTS,
    chart: CHART_CONSTRAINTS,
    bpmn: BPMN_CONSTRAINTS,
};

/**
 * Look up the constraints for a kind. Throws if the kind has not been
 * registered yet — useful as a fail-fast during the gradual kind migration.
 * Once all kinds are registered, this can be tightened to a total function.
 */
export const getKindConstraints = (kind: DiagramKind): KindConstraints => {
    const c = KIND_REGISTRY[kind];
    if (!c) throw new Error(`doodles: no KindConstraints registered for kind "${kind}"`);
    return c;
};

export const isKindRegistered = (kind: DiagramKind): boolean => KIND_REGISTRY[kind] !== undefined;

/**
 * Internal: extend the registry. Used by per-kind packages as they land.
 * Not exported from doodles-api.
 */
export const registerKindConstraints = (kind: DiagramKind, constraints: KindConstraints): void => {
    KIND_REGISTRY[kind] = constraints;
};
