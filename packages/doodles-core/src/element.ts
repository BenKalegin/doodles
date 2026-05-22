export type Id = string;

/**
 * The set of element kinds doodles knows about. Mirrors clouddiagram's
 * historical enum for compatibility; values are not stable across rewrites.
 *
 * For 0.1.0 only Flowchart-flavoured elements (ClassNode, ClassLink,
 * ClassPort, Cluster, FlowchartDiagram) are exercised by the layout
 * pipeline. The remaining values exist so consumers that re-export the
 * enum stay source-compatible.
 */
export enum ElementType {
    Unexpected,
    ClassNode,
    ClassDiagram,
    ClassLink,
    ClassPort,
    SequenceDiagram,
    SequenceLifeLine,
    SequenceMessage,
    SequenceActivation,
    Note,
    DeploymentDiagram,
    DeploymentNode,
    DeploymentLink,
    FlowchartDiagram,
    GanttDiagram,
    ErDiagram,
    PieChartDiagram,
    Cluster,
    MindMapDiagram,
    XyChartDiagram,
}

export interface ElementRef {
    id: Id;
    type: ElementType;
}
