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

export {type EdgeRoute} from "./edgeRoute.js";

export {FlowchartNodeKind} from "./flowchart.js";

export {type DiagramDisplay, defaultDiagramDisplay, type Diagram} from "./diagram.js";

export {LayoutDirection, type LayoutHints} from "./layoutHints.js";

export {
    type DiagramKind,
    type PortRules,
    type KindConstraints,
    getKindConstraints,
    isKindRegistered,
    registerKindConstraints,
} from "./kinds.js";

export {
    type ColorSchema,
    type LineStyle,
    PictureLayout,
    type CustomShape,
    type DiagramElement,
    type Package,
    type PortState,
    type HasColorSchema,
    type GanttTaskStatus,
    type GanttTaskState,
    type GanttDependencyState,
    type ClassMemberKind,
    type ClassMemberState,
    type ErAttributeState,
    type ErEntityState,
    type ErCardinality,
    type ErRelationshipState,
    type PieSliceState,
    type NodeState,
    RouteStyle,
    TipStyle,
    defaultRouteStyle,
    CornerStyle,
    defaultCornerStyle,
    defaultNoteStyle,
    defaultNoteWidth,
    defaultNoteHeight,
    type LinkState,
} from "./types.js";

export {
    defaultColorSchema,
    neutralColorSchema,
    colorSchemaList,
    lineStyleList,
    defaultLineStyle,
} from "./colorSchemas.js";

export {
    createClassMember,
    inferClassMemberKind,
    getClassFieldsText,
    getClassMethodsText,
    getClassMembersText,
    replaceClassMembersText,
    normalizeClassAnnotation,
    minimumClassNodeHeight,
} from "./classDiagramUtils.js";

export {
    type NodePlacement,
    type PortPlacement,
    defaultLinkPlacement,
    type LinkPlacement,
    type LinkRender,
    type PortRender,
    type NodeId,
    type PortId,
    type LinkId,
    type StructureDiagramState,
} from "./structureDiagramState.js";

export const DOODLES_VERSION = "0.2.0";
