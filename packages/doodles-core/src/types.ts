import type {ElementRef, Id} from "./element.js";
import type {FlowchartNodeKind} from "./flowchart.js";

export interface ColorSchema {
    strokeColor: string;
    fillColor: string;
    textColor?: string;
    /** When true, skip the dark-mode colour transform — colours are already theme-ready. */
    rawColors?: boolean;
}

// for sequence diagram messages
export interface LineStyle {
    strokeColor: string;
    fillColor: string;
    width: number;
}

export enum PictureLayout {
    NoIconRect,
    TopLeftCorner,
    FullIconTextBelow,
    Center,
}

/**
 * `pictureId` is a host-defined SVG asset identifier. doodles treats it as
 * an opaque string; clouddiagram narrows it to its PredefinedSvg enum at
 * use sites.
 */
export interface CustomShape {
    pictureId: string;
    layout: PictureLayout;
}

export interface DiagramElement extends ElementRef {
    customShape?: CustomShape;
}

export interface Package {
    elements: { [id: Id]: DiagramElement };
}

export interface PortState extends DiagramElement {
    /**
     * Percentage of the port going deep inside the node.
     * - 0 means the port is on the edge of the node pointing outward
     * - 50 means the half of port crosses the edge
     * - 100 means the port is sunk into the node
     */
    depthRatio: number;

    /** Width of the marker along the edge it belong to. */
    latitude: number;

    /** Height of the marker in perpendicular direction to the edge it belong to. */
    longitude: number;

    nodeId: Id;
    links: Id[];
}

export interface HasColorSchema {
    colorSchema: ColorSchema;
}

export type GanttTaskStatus = "" | "active" | "done" | "crit" | "milestone";

export interface GanttTaskState {
    taskId: string;
    label: string;
    section: string;
    start: string;
    end: string;
    status: GanttTaskStatus;
}

export interface GanttDependencyState {
    sourceTaskId: string;
    targetTaskId: string;
}

export type ClassMemberKind = "field" | "method";

export interface ClassMemberState {
    kind: ClassMemberKind;
    text: string;
}

export interface ErAttributeState {
    type: string;
    name: string;
    keys?: string;
    comment?: string;
}

export interface ErEntityState {
    entityId: string;
    alias?: string;
    attributes: ErAttributeState[];
}

export type ErCardinality = "||" | "|o" | "}o" | "}|";

export interface ErRelationshipState {
    sourceCardinality: ErCardinality;
    targetCardinality: ErCardinality;
    identifying: boolean;
    label: string;
}

export interface PieSliceState {
    label: string;
    value: number;
}

export interface NodeState extends DiagramElement, HasColorSchema {
    text: string;
    ports: Id[];
    classAnnotation?: string;
    classMembers?: ClassMemberState[];
    erEntity?: ErEntityState;
    flowchartKind?: FlowchartNodeKind;
    ganttTask?: GanttTaskState;
    memberNodeIds?: string[];
}

export enum RouteStyle {
    Direct = "direct",
    AutoRouting = "autoRouting",
    CustomLine = "customLine",
    Bezier = "bezier",
    TreeStyleVertical = "treeStyleVertical",
    TreeStyleHorizontal = "treeStyleHorizontal",
    LateralVertical = "lateralVertical",
    LateralHorizontal = "lateralHorizontal",
    OrthogonalSquare = "orthogonalSquare",
    OrthogonalRounded = "orthogonalRounded",
}

export enum TipStyle {
    None = "none",
    Arrow = "arrow",
    Triangle = "triangle",
    Diamond = "diamond",
    Circle = "circle",
    Square = "square",
}

export const defaultRouteStyle: RouteStyle = RouteStyle.Direct;

export enum CornerStyle {
    Straight = "straight",
}

export const defaultCornerStyle: CornerStyle = CornerStyle.Straight;

export const defaultNoteStyle: ColorSchema = {
    strokeColor: "black",
    fillColor: "white",
};

export const defaultNoteWidth = 120;
export const defaultNoteHeight = 70;

export interface LinkState extends DiagramElement, HasColorSchema {
    port1: Id;
    port2: Id;
    text?: string;
    ganttDependency?: GanttDependencyState;
    erRelationship?: ErRelationshipState;
    tipStyle1: TipStyle;
    tipStyle2: TipStyle;
    routeStyle: RouteStyle;
    cornerStyle: CornerStyle;
}
