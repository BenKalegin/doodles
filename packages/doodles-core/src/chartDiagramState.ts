import type {Diagram} from "./diagram.js";
import type {Id} from "./element.js";

/**
 * Render-ready shape of an xy-chart diagram. Importers (xychart-beta,
 * vega-lite) normalize their source format into this; doodles-svg's chart
 * renderer consumes it. The model is long-format tabular data + Vega-Lite-
 * style encoding channels, with stacking and interactions as first-class.
 */

export type ChartSeriesId = Id;
export type ChartFieldName = string;

export const ChartMarkKind = {
    Bar: "bar",
    Line: "line",
    Area: "area",
    Point: "point",
    Rule: "rule",
} as const;
export type ChartMarkKind = (typeof ChartMarkKind)[keyof typeof ChartMarkKind];

export const ChartScaleKind = {
    Categorical: "categorical",
    Linear: "linear",
    Log: "log",
    Time: "time",
} as const;
export type ChartScaleKind = (typeof ChartScaleKind)[keyof typeof ChartScaleKind];

export const ChartFieldType = {
    Quantitative: "quantitative",
    Ordinal: "ordinal",
    Nominal: "nominal",
    Temporal: "temporal",
} as const;
export type ChartFieldType = (typeof ChartFieldType)[keyof typeof ChartFieldType];

export const ChartStackMode = {
    /** Stack from y=0 baseline (standard stacked bar). */
    Zero: "zero",
    /** Percent-stack: each x-position sums to 1.0. */
    Normalize: "normalize",
    /** Stream-graph centering around y=0. */
    Center: "center",
} as const;
export type ChartStackMode = (typeof ChartStackMode)[keyof typeof ChartStackMode];

export const ChartOrientation = {
    Vertical: "vertical",
    Horizontal: "horizontal",
} as const;
export type ChartOrientation = (typeof ChartOrientation)[keyof typeof ChartOrientation];

export const ChartPointShape = {
    Circle: "circle",
    Square: "square",
    Diamond: "diamond",
    Triangle: "triangle",
} as const;
export type ChartPointShape = (typeof ChartPointShape)[keyof typeof ChartPointShape];

export const ChartInteractionTarget = {
    Mark: "mark",
    Legend: "legend",
    AxisTick: "axis-tick",
} as const;
export type ChartInteractionTarget = (typeof ChartInteractionTarget)[keyof typeof ChartInteractionTarget];

export const ChartInteractionEvent = {
    Click: "click",
    DblClick: "dblclick",
    Hover: "hover",
} as const;
export type ChartInteractionEvent = (typeof ChartInteractionEvent)[keyof typeof ChartInteractionEvent];

export const ChartSourceFormat = {
    MermaidXyChartBeta: "mermaid-xychart-beta",
    VegaLite: "vega-lite",
} as const;
export type ChartSourceFormat = (typeof ChartSourceFormat)[keyof typeof ChartSourceFormat];

export type ChartCellValue = string | number | null;

export interface ChartAxis {
    label?: string;
    scale: ChartScaleKind;
    /** categorical: explicit domain ordering; numeric/time: [min, max] (null entries auto-resolve). */
    domain?: string[] | [number | null, number | null];
    tickStep?: number;
    timeFormat?: string;
    grid?: boolean;
}

export interface ChartDataField {
    name: ChartFieldName;
    type: ChartFieldType;
}

/** Long-format table. Each row is a record keyed by ChartDataField.name. */
export interface ChartData {
    fields: ChartDataField[];
    rows: Array<Record<ChartFieldName, ChartCellValue>>;
}

export interface ChartEncoding {
    x: ChartFieldName;
    y: ChartFieldName;
}

export interface ChartSeriesStyle {
    color?: string;
    opacity?: number;
    strokeWidth?: number;
    dash?: number[];
    pointShape?: ChartPointShape;
}

export interface ChartSeries {
    id: ChartSeriesId;
    label?: string;
    mark: ChartMarkKind;
    encoding: ChartEncoding;
    /** Bar/area only; undefined = overlay (xychart-beta default). */
    stack?: ChartStackMode;
    style?: ChartSeriesStyle;
}

/**
 * Named handler invocation. The host (axonize / clouddiagram) registers a
 * {name → fn} map at render time; the renderer dispatches by string id so the
 * spec stays serializable. `params` values may include `{{field}}` templates
 * that the renderer expands from the clicked mark's row.
 */
export interface ChartInteraction {
    target: ChartInteractionTarget;
    event: ChartInteractionEvent;
    handler: string;
    params?: Record<string, string>;
    /** Restrict to a specific series id; omit to apply to all. */
    seriesId?: ChartSeriesId;
}

export interface ChartSource {
    format: ChartSourceFormat;
    /** Original source text — kept for round-trip / debugging. */
    raw?: string;
}

export interface ChartSpec extends Diagram {
    kind: "chart";
    orientation: ChartOrientation;
    xAxis: ChartAxis;
    yAxis: ChartAxis;
    data: ChartData;
    series: ChartSeries[];
    interactions?: ChartInteraction[];
    /** Namespaced renderer hints (e.g. doodles.* from mermaid frontmatter). */
    extensions?: Record<string, unknown>;
    source?: ChartSource;
}
