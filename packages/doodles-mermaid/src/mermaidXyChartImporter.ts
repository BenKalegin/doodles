import {
    type ChartAxis,
    type ChartData,
    type ChartSeries,
    type ChartSpec,
    ChartFieldType,
    ChartMarkKind,
    ChartOrientation,
    ChartScaleKind,
    ChartSourceFormat,
    ElementType,
    defaultDiagramDisplay,
    zeroCoordinate,
} from "@benkalegin/doodles-core";
import {createMermaidIdGenerator, mermaidSourceLines, readFrontmatterLines} from "./mermaidImportUtils.js";

const HEADER_RE = /^xychart(?:-beta)?(?:\s+(horizontal))?\s*$/i;
const TITLE_RE = /^title\s+(.+)$/i;
const X_AXIS_RE = /^x-axis\s+(.+)$/i;
const Y_AXIS_RE = /^y-axis\s+(.+)$/i;
const SERIES_RE = /^(bar|line)\s+(.+)$/i;
const BAR_KEYWORD = "bar";
const RANGE_RE = /^(-?[\d.]+)\s*-->\s*(-?[\d.]+)$/;
const QUOTED_LABEL_RE = /^"((?:[^"\\]|\\.)*)"(?:\s+(.+))?$/;
// Matches both YAML-style (`plotColorPalette: "#a, #b"`) and JSON-style
// (`"plotColorPalette": "#a, #b"` inside a `%%{init: …}%%` directive). The
// optional `["']?` after the key consumes the closing quote of a JSON key.
const PLOT_PALETTE_RE = /plotColorPalette["']?\s*:\s*["']([^"'\n]+)["']/i;

const CATEGORY_FIELD = "category";
const VALUE_FIELD_PREFIX = "v";
const DEFAULT_CHART_WIDTH = 600;
const DEFAULT_CHART_HEIGHT = 400;

interface ParsedAxis {
    label?: string;
    /** When set, the axis is categorical. */
    categories?: string[];
    /** When set, the axis is numeric range. */
    range?: [number, number];
}

interface ParsedSeries {
    mark: typeof ChartMarkKind.Bar | typeof ChartMarkKind.Line;
    label?: string;
    values: number[];
}

interface ParseResult {
    horizontal: boolean;
    title?: string;
    xAxis?: ParsedAxis;
    yAxis?: ParsedAxis;
    seriesList: ParsedSeries[];
}

/**
 * Parse a Mermaid xychart-beta source into a ChartSpec.
 *
 * Accepts both the current `xychart` keyword and the legacy `xychart-beta`
 * keyword. Reads color palette from frontmatter
 * `config.themeVariables.xyChart.plotColorPalette` and assigns it to series
 * by index. Anything else in the frontmatter is preserved under
 * `extensions.frontmatter` for the renderer to interpret.
 */
export function importMermaidXyChartDiagram(source: string): ChartSpec {
    const lines = mermaidSourceLines(source);
    if (lines.length === 0) throw new Error("xychart: empty source");

    const headerMatch = lines[0]!.match(HEADER_RE);
    if (!headerMatch) throw new Error(`xychart: expected 'xychart' header, got "${lines[0]}"`);

    const parsed = parseDirectives(lines.slice(1), Boolean(headerMatch[1]));
    if (parsed.seriesList.length === 0) throw new Error("xychart: at least one bar/line series is required");

    const palette = readPlotColorPalette(source);
    const yIsCategory = parsed.yAxis?.categories !== undefined;
    const xAxisSpec = buildAxis(parsed.xAxis, yIsCategory ? ChartScaleKind.Linear : ChartScaleKind.Categorical);
    const yAxisSpec = buildAxis(parsed.yAxis, yIsCategory ? ChartScaleKind.Categorical : ChartScaleKind.Linear);
    const data = buildChartData(parsed, yIsCategory);
    const idGen = createMermaidIdGenerator();
    const series = buildSeries(parsed.seriesList, palette, idGen, yIsCategory);

    const spec: ChartSpec = {
        id: idGen(),
        type: ElementType.XyChartDiagram,
        kind: "chart",
        display: {...defaultDiagramDisplay, width: DEFAULT_CHART_WIDTH, height: DEFAULT_CHART_HEIGHT, offset: zeroCoordinate},
        orientation: parsed.horizontal ? ChartOrientation.Horizontal : ChartOrientation.Vertical,
        xAxis: xAxisSpec,
        yAxis: yAxisSpec,
        data,
        series,
        source: {format: ChartSourceFormat.MermaidXyChartBeta, raw: source},
    };
    if (parsed.title !== undefined) spec.title = parsed.title;
    return spec;
}

function parseDirectives(rest: string[], horizontal: boolean): ParseResult {
    const result: ParseResult = {horizontal, seriesList: []};
    for (const line of rest) {
        const titleMatch = line.match(TITLE_RE);
        if (titleMatch) {
            result.title = unquote(titleMatch[1]!.trim());
            continue;
        }
        const xMatch = line.match(X_AXIS_RE);
        if (xMatch) {
            result.xAxis = parseAxisRhs(xMatch[1]!);
            continue;
        }
        const yMatch = line.match(Y_AXIS_RE);
        if (yMatch) {
            result.yAxis = parseAxisRhs(yMatch[1]!);
            continue;
        }
        const seriesMatch = line.match(SERIES_RE);
        if (seriesMatch) {
            const mark = seriesMatch[1]!.toLowerCase() === BAR_KEYWORD ? ChartMarkKind.Bar : ChartMarkKind.Line;
            result.seriesList.push(parseSeriesRhs(mark, seriesMatch[2]!));
            continue;
        }
        const inlineSeriesMatch = line.match(/^(bar|line)\s*$/i);
        if (inlineSeriesMatch) throw new Error(`xychart: '${inlineSeriesMatch[1]}' missing data array`);
    }
    return result;
}

function parseAxisRhs(rhs: string): ParsedAxis {
    const trimmed = rhs.trim();
    let label: string | undefined;
    let remainder = trimmed;
    const labelMatch = trimmed.match(QUOTED_LABEL_RE);
    if (labelMatch) {
        label = labelMatch[1];
        remainder = (labelMatch[2] ?? "").trim();
    }
    if (!remainder) return withLabel({}, label);

    const rangeMatch = remainder.match(RANGE_RE);
    if (rangeMatch) {
        return withLabel({range: [Number(rangeMatch[1]), Number(rangeMatch[2])]}, label);
    }
    if (remainder.startsWith("[") && remainder.endsWith("]")) {
        const inside = remainder.slice(1, -1).trim();
        const categories = splitTopLevelCommas(inside).map(unquote);
        return withLabel({categories}, label);
    }
    if (!label) return {label: remainder};
    throw new Error(`xychart: cannot parse axis "${rhs}"`);
}

function withLabel<T extends object>(base: T, label: string | undefined): T & {label?: string} {
    return label === undefined ? base : {...base, label};
}

function parseSeriesRhs(mark: ParsedSeries["mark"], rhs: string): ParsedSeries {
    const trimmed = rhs.trim();
    let label: string | undefined;
    let remainder = trimmed;
    const labelMatch = trimmed.match(QUOTED_LABEL_RE);
    if (labelMatch) {
        label = labelMatch[1];
        remainder = (labelMatch[2] ?? "").trim();
    }
    if (!remainder.startsWith("[") || !remainder.endsWith("]")) {
        throw new Error(`xychart: ${mark} expects [v1, v2, ...] data, got "${rhs}"`);
    }
    const inside = remainder.slice(1, -1).trim();
    const values = inside.length === 0
        ? []
        : splitTopLevelCommas(inside).map(tok => parseNumber(tok));
    const out: ParsedSeries = {mark, values};
    if (label !== undefined) out.label = label;
    return out;
}

function parseNumber(token: string): number {
    const stripped = token.trim().replace(/^\+/, "");
    const n = Number(stripped);
    if (!Number.isFinite(n)) throw new Error(`xychart: invalid number "${token}"`);
    return n;
}

function splitTopLevelCommas(input: string): string[] {
    return input.split(",").map(s => s.trim()).filter(s => s.length > 0);
}

function unquote(s: string): string {
    const t = s.trim();
    if (t.length >= 2 && t.startsWith("\"") && t.endsWith("\"")) {
        return t.slice(1, -1).replace(/\\"/g, "\"");
    }
    return t;
}

function buildAxis(parsed: ParsedAxis | undefined, defaultScale: typeof ChartScaleKind.Categorical | typeof ChartScaleKind.Linear): ChartAxis {
    if (!parsed) return {scale: defaultScale};
    if (parsed.categories) {
        return withLabel({scale: ChartScaleKind.Categorical, domain: parsed.categories} as ChartAxis, parsed.label);
    }
    if (parsed.range) {
        return withLabel({scale: ChartScaleKind.Linear, domain: [parsed.range[0], parsed.range[1]]} as ChartAxis, parsed.label);
    }
    return withLabel({scale: defaultScale} as ChartAxis, parsed.label);
}

function buildChartData(parsed: ParseResult, yIsCategory: boolean): ChartData {
    const categories = (yIsCategory ? parsed.yAxis?.categories : parsed.xAxis?.categories);
    const seriesLengths = parsed.seriesList.map(s => s.values.length);
    const rowCount = Math.max(0, ...seriesLengths);
    const categoryValues: Array<string | number> = categories
        ? padCategoriesTo(categories, rowCount)
        : Array.from({length: rowCount}, (_, i) => i);

    const fields = [
        {name: CATEGORY_FIELD, type: categories ? ChartFieldType.Nominal : ChartFieldType.Quantitative},
        ...parsed.seriesList.map((_, i) => ({
            name: valueFieldName(i),
            type: ChartFieldType.Quantitative,
        })),
    ];

    const rows: Array<Record<string, string | number | null>> = [];
    for (let i = 0; i < rowCount; i++) {
        const row: Record<string, string | number | null> = {[CATEGORY_FIELD]: categoryValues[i]!};
        parsed.seriesList.forEach((s, si) => {
            row[valueFieldName(si)] = i < s.values.length ? s.values[i]! : null;
        });
        rows.push(row);
    }
    return {fields, rows};
}

function padCategoriesTo(categories: string[], target: number): string[] {
    if (categories.length >= target) return categories;
    const padded = [...categories];
    for (let i = categories.length; i < target; i++) padded.push(String(i));
    return padded;
}

function valueFieldName(index: number): string {
    return `${VALUE_FIELD_PREFIX}${index}`;
}

function buildSeries(parsed: ParsedSeries[], palette: string[], idGen: () => string, yIsCategory: boolean): ChartSeries[] {
    return parsed.map((s, i) => {
        const valueField = valueFieldName(i);
        const encoding = yIsCategory
            ? {x: valueField, y: CATEGORY_FIELD}
            : {x: CATEGORY_FIELD, y: valueField};
        const series: ChartSeries = {
            id: idGen(),
            mark: s.mark,
            encoding,
        };
        if (s.label) series.label = s.label;
        const color = palette[i];
        if (color) series.style = {color};
        return series;
    });
}

function readPlotColorPalette(source: string): string[] {
    // Frontmatter takes precedence over `%%{init: …}%%` so doodles-native
    // configuration wins when both are present.
    for (const line of readFrontmatterLines(source)) {
        const palette = matchPalette(line);
        if (palette) return palette;
    }
    for (const line of source.split("\n")) {
        const palette = matchPalette(line);
        if (palette) return palette;
    }
    return [];
}

function matchPalette(line: string): string[] | undefined {
    const m = line.match(PLOT_PALETTE_RE);
    if (!m) return undefined;
    return splitTopLevelCommas(m[1]!).map(s => s.replace(/^["']|["']$/g, "").trim()).filter(Boolean);
}
