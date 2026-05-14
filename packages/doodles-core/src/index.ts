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
} from "./bounds.js";

export {type Id, ElementType, type ElementRef} from "./element.js";

export {PortAlignment} from "./port.js";

export {FlowchartNodeKind} from "./flowchart.js";

export {type DiagramDisplay, defaultDiagramDisplay, type Diagram} from "./diagram.js";

export {
    type DiagramKind,
    type PortRules,
    type KindConstraints,
    getKindConstraints,
    isKindRegistered,
    registerKindConstraints,
} from "./kinds.js";

export const DOODLES_VERSION = "0.1.1";
