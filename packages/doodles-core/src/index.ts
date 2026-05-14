export {
    type Coordinate,
    type Bounds,
    zeroCoordinate,
    zeroBounds,
    inflate,
    rightOf,
    withinBounds,
    withinXBounds,
    withinYBounds,
    minus,
    center,
} from "./bounds";

export {type Id, ElementType, type ElementRef} from "./element";

export {PortAlignment} from "./port";

export {FlowchartNodeKind} from "./flowchart";

export {type DiagramDisplay, defaultDiagramDisplay, type Diagram} from "./diagram";

export {
    type DiagramKind,
    type PortRules,
    type KindConstraints,
    getKindConstraints,
    isKindRegistered,
    registerKindConstraints,
} from "./kinds";

export const DOODLES_VERSION = "0.1.0";
