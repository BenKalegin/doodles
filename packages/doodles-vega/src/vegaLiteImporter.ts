import {nanoid} from "nanoid";
import {
    type ChartAxis,
    type ChartCellValue,
    type ChartData,
    type ChartDataField,
    type ChartInteraction,
    type ChartSeries,
    type ChartSpec,
    ChartFieldType,
    ChartInteractionEvent,
    ChartInteractionTarget,
    ChartMarkKind,
    ChartOrientation,
    ChartScaleKind,
    ChartSourceFormat,
    ChartStackMode,
    ElementType,
    defaultDiagramDisplay,
    zeroCoordinate,
} from "@benkalegin/doodles-core";

const DEFAULT_CHART_WIDTH = 600;
const DEFAULT_CHART_HEIGHT = 400;

type VegaMarkType = "bar" | "line" | "point" | "area" | "rule";

interface VegaMarkObject {
    type: VegaMarkType;
    fill?: string;
    color?: string;
    stroke?: string;
    opacity?: number;
}

interface VegaEncodingField {
    field?: string;
    type?: "quantitative" | "ordinal" | "nominal" | "temporal";
    title?: string;
    stack?: "zero" | "normalize" | "center" | null | false;
    aggregate?: string;
    timeUnit?: string;
    scale?: {
        domain?: unknown;
        range?: string[];
    };
}

interface VegaParamPoint {
    name: string;
    select: "point" | {type: "point"; on?: string};
}

interface VegaSpec {
    $schema?: string;
    description?: string;
    title?: string | {text: string};
    data?: {values?: Array<Record<string, ChartCellValue>>; url?: string};
    transform?: unknown;
    mark: VegaMarkType | VegaMarkObject;
    encoding: {
        x?: VegaEncodingField;
        y?: VegaEncodingField;
        color?: VegaEncodingField;
    };
    params?: VegaParamPoint[];
}

/**
 * Import a Vega-Lite single-view subset into a ChartSpec.
 *
 * Supported: inline `data.values`; marks bar/line/point/area/rule; encoding
 * `x`, `y`, `color` (categorical split); `y.stack` (zero/normalize/center);
 * `params[].select` of type point → click interaction.
 *
 * Unsupported (throws): `data.url`, `transform`, `aggregate`, `timeUnit`,
 * multi-layer (`layer`/`hconcat`/`vconcat`/`repeat`/`facet`).
 */
export function importVegaLiteChart(spec: VegaSpec | string): ChartSpec {
    const parsed: VegaSpec = typeof spec === "string" ? JSON.parse(spec) as VegaSpec : spec;
    rejectUnsupported(parsed);

    const rows = readInlineRows(parsed);
    const mark = normalizeMark(parsed.mark);
    const xField = requireEncodingField(parsed.encoding.x, "x");
    const yField = requireEncodingField(parsed.encoding.y, "y");

    const xType = mapFieldType(parsed.encoding.x?.type);
    const yType = mapFieldType(parsed.encoding.y?.type);
    const xScale = scaleFor(parsed.encoding.x?.type);
    const yScale = scaleFor(parsed.encoding.y?.type);

    const colorField = parsed.encoding.color?.field;
    const colorRange = parsed.encoding.color?.scale?.range ?? [];
    const stackMode = resolveStack(mark, parsed.encoding.y?.stack, Boolean(colorField));
    const markStyle = markStyleFrom(parsed.mark);

    const {data, series} = colorField
        ? pivotColorSplit(rows, xField, xType, colorField, yField, yType, mark, stackMode, colorRange, markStyle)
        : {
            data: buildData(rows, [
                {name: xField, type: xType},
                {name: yField, type: yType},
            ]),
            series: [buildSingleSeries(mark, xField, yField, stackMode, markStyle)],
        };

    const interactions = buildInteractions(parsed.params);
    const xAxis = buildAxis(parsed.encoding.x, xScale);
    const yAxis = buildAxis(parsed.encoding.y, yScale);

    const out: ChartSpec = {
        id: nanoid(),
        type: ElementType.XyChartDiagram,
        kind: "chart",
        display: {...defaultDiagramDisplay, width: DEFAULT_CHART_WIDTH, height: DEFAULT_CHART_HEIGHT, offset: zeroCoordinate},
        orientation: ChartOrientation.Vertical,
        xAxis,
        yAxis,
        data,
        series,
        source: {format: ChartSourceFormat.VegaLite, raw: typeof spec === "string" ? spec : JSON.stringify(spec)},
    };
    const title = readTitle(parsed);
    if (title !== undefined) out.title = title;
    if (interactions.length > 0) out.interactions = interactions;
    return out;
}

function rejectUnsupported(spec: VegaSpec): void {
    if (spec.data?.url) throw new Error("vega-lite: data.url is not supported in v1 — inline data.values only");
    if (spec.transform !== undefined) throw new Error("vega-lite: top-level transforms are not supported in v1");
    if (spec.encoding.x?.aggregate || spec.encoding.y?.aggregate) {
        throw new Error("vega-lite: encoding.aggregate is not supported in v1 — pre-aggregate the data");
    }
    if (spec.encoding.x?.timeUnit || spec.encoding.y?.timeUnit) {
        throw new Error("vega-lite: encoding.timeUnit is not supported in v1");
    }
    const anySpec = spec as unknown as Record<string, unknown>;
    for (const key of ["layer", "hconcat", "vconcat", "repeat", "facet"]) {
        if (anySpec[key] !== undefined) throw new Error(`vega-lite: ${key} compositions are not supported in v1`);
    }
}

function readInlineRows(spec: VegaSpec): Array<Record<string, ChartCellValue>> {
    const rows = spec.data?.values;
    if (!rows) throw new Error("vega-lite: data.values is required (v1 supports inline data only)");
    return rows;
}

function readTitle(spec: VegaSpec): string | undefined {
    if (typeof spec.title === "string") return spec.title;
    if (spec.title && typeof spec.title === "object" && "text" in spec.title) return spec.title.text;
    return spec.description;
}

function normalizeMark(m: VegaSpec["mark"]): ChartSeries["mark"] {
    const type = typeof m === "string" ? m : m.type;
    switch (type) {
        case "bar": return ChartMarkKind.Bar;
        case "line": return ChartMarkKind.Line;
        case "point": return ChartMarkKind.Point;
        case "area": return ChartMarkKind.Area;
        case "rule": return ChartMarkKind.Rule;
        default: throw new Error(`vega-lite: unsupported mark type "${type}"`);
    }
}

function markStyleFrom(m: VegaSpec["mark"]): ChartSeries["style"] | undefined {
    if (typeof m === "string") return undefined;
    const style: NonNullable<ChartSeries["style"]> = {};
    if (m.fill !== undefined) style.color = m.fill;
    else if (m.color !== undefined) style.color = m.color;
    if (m.opacity !== undefined) style.opacity = m.opacity;
    return Object.keys(style).length > 0 ? style : undefined;
}

function requireEncodingField(enc: VegaEncodingField | undefined, channel: string): string {
    if (!enc?.field) throw new Error(`vega-lite: encoding.${channel}.field is required`);
    return enc.field;
}

function mapFieldType(t: string | undefined): ChartDataField["type"] {
    switch (t) {
        case "quantitative": return ChartFieldType.Quantitative;
        case "ordinal": return ChartFieldType.Ordinal;
        case "nominal": return ChartFieldType.Nominal;
        case "temporal": return ChartFieldType.Temporal;
        default: return ChartFieldType.Nominal;
    }
}

function scaleFor(t: string | undefined): ChartAxis["scale"] {
    switch (t) {
        case "quantitative": return ChartScaleKind.Linear;
        case "temporal": return ChartScaleKind.Time;
        case "ordinal":
        case "nominal":
        default: return ChartScaleKind.Categorical;
    }
}

function buildData(rows: Array<Record<string, ChartCellValue>>, fields: ChartDataField[]): ChartData {
    const fieldNames = new Set(fields.map(f => f.name));
    const projected = rows.map(row => {
        const out: Record<string, ChartCellValue> = {};
        for (const name of fieldNames) out[name] = row[name] ?? null;
        return out;
    });
    return {fields, rows: projected};
}

function resolveStack(mark: ChartSeries["mark"], explicit: VegaEncodingField["stack"], hasColorSplit: boolean): ChartSeries["stack"] | undefined {
    if (explicit === null || explicit === false) return undefined;
    if (explicit === "zero") return ChartStackMode.Zero;
    if (explicit === "normalize") return ChartStackMode.Normalize;
    if (explicit === "center") return ChartStackMode.Center;
    // Vega-Lite implicit: bar/area + categorical color split → stack: "zero"
    if ((mark === ChartMarkKind.Bar || mark === ChartMarkKind.Area) && hasColorSplit) return ChartStackMode.Zero;
    return undefined;
}

function buildSingleSeries(mark: ChartSeries["mark"], x: string, y: string, stack: ChartSeries["stack"] | undefined, style: ChartSeries["style"] | undefined): ChartSeries {
    const s: ChartSeries = {id: nanoid(), mark, encoding: {x, y}};
    if (stack !== undefined) s.stack = stack;
    if (style !== undefined) s.style = style;
    return s;
}

const VALUE_FIELD_PREFIX = "value";

/**
 * Pivot a long-format Vega-Lite spec (one row per category/color combination)
 * into wide format (one row per category, one value column per series).
 * Necessary so each series's encoding.y points at its own column — otherwise
 * every series would render marks for every color value's data.
 */
function pivotColorSplit(
    rows: Array<Record<string, ChartCellValue>>,
    xField: string,
    xType: ChartDataField["type"],
    colorField: string,
    yField: string,
    yType: ChartDataField["type"],
    mark: ChartSeries["mark"],
    stack: ChartSeries["stack"] | undefined,
    colorRange: string[],
    baseStyle: ChartSeries["style"] | undefined,
): {data: ChartData; series: ChartSeries[]} {
    const colorOrder = distinctValuesInOrder(rows, colorField);
    const xOrder = distinctValuesInOrder(rows, xField);
    const valueFieldFor = (idx: number) => `${VALUE_FIELD_PREFIX}${idx}`;

    const pivoted: Array<Record<string, ChartCellValue>> = xOrder.map(xVal => {
        const row: Record<string, ChartCellValue> = {[xField]: xVal};
        colorOrder.forEach((_, idx) => { row[valueFieldFor(idx)] = null; });
        return row;
    });
    const xIndex = new Map(xOrder.map((v, i) => [v, i]));
    const colorIndex = new Map(colorOrder.map((v, i) => [v, i]));
    for (const row of rows) {
        const xKey = String(row[xField] ?? "");
        const colorKey = String(row[colorField] ?? "");
        const xi = xIndex.get(xKey);
        const ci = colorIndex.get(colorKey);
        if (xi === undefined || ci === undefined) continue;
        pivoted[xi]![valueFieldFor(ci)] = row[yField] ?? null;
    }

    const fields: ChartDataField[] = [
        {name: xField, type: xType},
        ...colorOrder.map((_, idx) => ({name: valueFieldFor(idx), type: yType})),
    ];

    const series = colorOrder.map((colorValue, idx) => {
        const s: ChartSeries = {
            id: nanoid(),
            label: colorValue,
            mark,
            encoding: {x: xField, y: valueFieldFor(idx)},
        };
        if (stack !== undefined) s.stack = stack;
        const style: NonNullable<ChartSeries["style"]> = {...baseStyle};
        const paletteColor = colorRange[idx];
        if (paletteColor) style.color = paletteColor;
        if (Object.keys(style).length > 0) s.style = style;
        return s;
    });
    return {data: {fields, rows: pivoted}, series};
}

function distinctValuesInOrder(rows: Array<Record<string, ChartCellValue>>, field: string): string[] {
    const seen = new Set<string>();
    const order: string[] = [];
    for (const row of rows) {
        const v = row[field];
        const key = v === null ? "" : String(v);
        if (!seen.has(key)) {
            seen.add(key);
            order.push(key);
        }
    }
    return order;
}

function buildInteractions(params: VegaSpec["params"]): ChartInteraction[] {
    if (!params) return [];
    const out: ChartInteraction[] = [];
    for (const p of params) {
        const sel = p.select;
        const isPoint = sel === "point" || (typeof sel === "object" && sel.type === "point");
        if (!isPoint) continue;
        const on = typeof sel === "object" ? sel.on : undefined;
        const event = on === "pointerover" || on === "mouseover" ? ChartInteractionEvent.Hover : ChartInteractionEvent.Click;
        out.push({
            target: ChartInteractionTarget.Mark,
            event,
            handler: p.name,
        });
    }
    return out;
}

function buildAxis(enc: VegaEncodingField | undefined, scale: ChartAxis["scale"]): ChartAxis {
    const label = enc?.title;
    const axis: ChartAxis = {scale};
    if (label !== undefined) axis.label = label;
    const range = enc?.scale?.domain;
    if (Array.isArray(range)) {
        // Vega-Lite domain for categorical is string[]; for quantitative is [min, max].
        if (scale === ChartScaleKind.Categorical && range.every(v => typeof v === "string")) {
            axis.domain = range as string[];
        } else if (scale === ChartScaleKind.Linear && range.length === 2 && range.every(v => typeof v === "number")) {
            axis.domain = [range[0] as number, range[1] as number];
        }
    }
    return axis;
}
