import {
    type ChartCellValue,
    type ChartData,
    type ChartInteraction,
    type ChartSeries,
    type ChartSpec,
    ChartMarkKind,
    ChartScaleKind,
    ChartStackMode,
} from "@benkalegin/doodles-core";
import {defaultLightTheme, type ThemeTokens} from "./theme.js";
import {xmlEscape} from "./escape.js";

export interface ChartRenderOptions {
    theme?: ThemeTokens;
    /** Extra padding around the chart bounding box (added to viewBox). Defaults to 12. */
    padding?: number;
    /** Override the default categorical color palette used when a series has no style.color. */
    palette?: string[];
}

// ── Layout constants ────────────────────────────────────────────────────────
const DEFAULT_PADDING = 12;
const PLOT_MARGIN_TOP_WITH_TITLE = 44;
const PLOT_MARGIN_TOP_NO_TITLE = 18;
const PLOT_MARGIN_RIGHT = 16;
const PLOT_MARGIN_BOTTOM = 56;
const PLOT_MARGIN_LEFT = 64;
const AXIS_TICK_LENGTH = 5;
const AXIS_TICK_LABEL_GAP = 6;
const X_AXIS_LABEL_OFFSET = 38;
const Y_AXIS_LABEL_OFFSET = 46;
const TITLE_BASELINE_OFFSET = 26;
const TITLE_FONT_SIZE_MULTIPLIER = 1.3;
const TICK_FONT_SIZE_MULTIPLIER = 0.85;

// ── Mark constants ──────────────────────────────────────────────────────────
const BAND_PADDING_INNER = 0.2;
const BAND_PADDING_OUTER = 0.1;
const DEFAULT_LINEAR_TICK_COUNT = 5;
const POINT_RADIUS = 4;
const LINE_STROKE_WIDTH = 2;
const AREA_FILL_OPACITY = 0.35;
const BAR_STROKE_WIDTH = 0.5;
const RULE_STROKE_WIDTH = 1;
const GRID_STROKE_WIDTH = 0.5;
const GRID_OPACITY = 0.18;
const AXIS_LINE_OPACITY = 0.6;

// Tableau-10-ish palette — picked so successive series stay distinguishable on
// both light and dark hosts. Override via ChartRenderOptions.palette.
const DEFAULT_PALETTE = [
    "#4C78A8", "#F58518", "#54A24B", "#E45756", "#72B7B2",
    "#EECA3B", "#B279A2", "#FF9DA6", "#9D755D", "#BAB0AC",
];

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

type ScaleFn = (value: ChartCellValue) => number;

interface ChartScales {
    xScale: ScaleFn;
    yScale: ScaleFn;
    /** Pixel width per category band — defined only when the axis is categorical. */
    xBandWidth?: number;
    yBandWidth?: number;
}

/**
 * Render a ChartSpec to an SVG string. Handles vertical or horizontal
 * orientation, bar/line/area/point/rule marks, and stacking (zero/normalize/
 * center). Bypasses doodles-layout — charts compute their own plot area from
 * spec.display + axis-label margins. Marks emit `data-doodles-handler`
 * attributes so the host can wire interactions registered in spec.interactions.
 */
export function renderChartSvg(spec: ChartSpec, options: ChartRenderOptions = {}): string {
    const theme = options.theme ?? defaultLightTheme;
    const padding = options.padding ?? DEFAULT_PADDING;
    const palette = options.palette ?? DEFAULT_PALETTE;

    const width = spec.display.width;
    const height = spec.display.height;
    const plotRect = computePlotRect(width, height, spec.title);
    const scales = buildScales(spec, plotRect);

    const layers: string[] = [];
    layers.push(renderGrid(spec, plotRect, scales, theme));
    layers.push(renderAxes(spec, plotRect, scales, theme));
    layers.push(...renderAllSeries(spec, plotRect, scales, palette));
    if (spec.title) layers.push(renderTitle(spec.title, width, theme));

    const viewBox = `${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`;
    const background = theme.colors.background !== "transparent"
        ? `<rect x="${-padding}" y="${-padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="${theme.colors.background}" />`
        : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" class="doodles-svg doodles-svg-chart" viewBox="${viewBox}" width="${width + padding * 2}" height="${height + padding * 2}">${background}${layers.join("")}</svg>`;
}

// ── Layout ──────────────────────────────────────────────────────────────────

function computePlotRect(width: number, height: number, title: string | undefined): Rect {
    const top = title ? PLOT_MARGIN_TOP_WITH_TITLE : PLOT_MARGIN_TOP_NO_TITLE;
    return {
        x: PLOT_MARGIN_LEFT,
        y: top,
        width: width - PLOT_MARGIN_LEFT - PLOT_MARGIN_RIGHT,
        height: height - top - PLOT_MARGIN_BOTTOM,
    };
}

// ── Scales ──────────────────────────────────────────────────────────────────

function buildScales(spec: ChartSpec, plot: Rect): ChartScales {
    const xCategorical = spec.xAxis.scale === ChartScaleKind.Categorical;
    const yCategorical = spec.yAxis.scale === ChartScaleKind.Categorical;

    const xField = spec.series[0]?.encoding.x;
    const yField = spec.series[0]?.encoding.y;

    const xResult = xCategorical
        ? buildBandScale(collectCategoryDomain(spec, "x", xField), plot.x, plot.x + plot.width)
        : {scale: buildLinearScale(numericDomain(spec, "x", xField), plot.x, plot.x + plot.width), bandWidth: undefined};
    const yResult = yCategorical
        ? buildBandScale(collectCategoryDomain(spec, "y", yField), plot.y + plot.height, plot.y)
        : {scale: buildLinearScale(numericDomain(spec, "y", yField), plot.y + plot.height, plot.y), bandWidth: undefined};

    const out: ChartScales = {xScale: xResult.scale, yScale: yResult.scale};
    if (xResult.bandWidth !== undefined) out.xBandWidth = xResult.bandWidth;
    if (yResult.bandWidth !== undefined) out.yBandWidth = yResult.bandWidth;
    return out;
}

function buildBandScale(domain: string[], rangeStart: number, rangeEnd: number): {scale: ScaleFn; bandWidth: number} {
    const totalSpan = rangeEnd - rangeStart;
    const usableSpan = totalSpan * (1 - BAND_PADDING_OUTER * 2);
    const stride = domain.length > 0 ? usableSpan / domain.length : 0;
    const bandWidth = Math.max(0, Math.abs(stride) * (1 - BAND_PADDING_INNER));
    const start = rangeStart + (totalSpan - usableSpan) / 2;
    const index = new Map<string, number>();
    domain.forEach((cat, i) => index.set(cat, i));
    const scale: ScaleFn = (raw) => {
        if (raw === null || raw === undefined) return Number.NaN;
        const key = String(raw);
        const i = index.get(key);
        if (i === undefined) return Number.NaN;
        return start + stride * i + stride / 2;
    };
    return {scale, bandWidth};
}

function buildLinearScale(domain: [number, number], rangeStart: number, rangeEnd: number): ScaleFn {
    const [d0, d1] = domain;
    const span = d1 - d0;
    if (span === 0) return () => (rangeStart + rangeEnd) / 2;
    const slope = (rangeEnd - rangeStart) / span;
    return (raw) => {
        const v = typeof raw === "number" ? raw : raw === null ? Number.NaN : Number(raw);
        if (!Number.isFinite(v)) return Number.NaN;
        return rangeStart + (v - d0) * slope;
    };
}

function collectCategoryDomain(spec: ChartSpec, axis: "x" | "y", field: string | undefined): string[] {
    const declared = (axis === "x" ? spec.xAxis.domain : spec.yAxis.domain);
    if (Array.isArray(declared) && declared.every(v => typeof v === "string")) return declared as string[];
    if (!field) return [];
    const seen = new Set<string>();
    const out: string[] = [];
    for (const row of spec.data.rows) {
        const v = row[field];
        const key = v === null ? "" : String(v);
        if (!seen.has(key)) {
            seen.add(key);
            out.push(key);
        }
    }
    return out;
}

function numericDomain(spec: ChartSpec, axis: "x" | "y", field: string | undefined): [number, number] {
    const declared = (axis === "x" ? spec.xAxis.domain : spec.yAxis.domain);
    if (Array.isArray(declared) && declared.length === 2 && declared.every(v => typeof v === "number")) {
        return declared as [number, number];
    }
    const declaredMin = Array.isArray(declared) && typeof declared[0] === "number" ? declared[0] : undefined;
    const declaredMax = Array.isArray(declared) && typeof declared[1] === "number" ? declared[1] : undefined;
    const {min, max} = extentOverSeriesAndStacks(spec, axis, field);
    const finalMin = declaredMin ?? Math.min(0, min);
    const finalMax = declaredMax ?? Math.max(0, max);
    return finalMin === finalMax ? [finalMin - 1, finalMax + 1] : [finalMin, finalMax];
}

function extentOverSeriesAndStacks(spec: ChartSpec, axis: "x" | "y", field: string | undefined): {min: number; max: number} {
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    if (!field) return {min: 0, max: 1};
    // When any series stacks, the value-axis extent must include the per-category stacked totals.
    const stackedSums = computeStackedSums(spec, axis);
    if (stackedSums) {
        for (const v of stackedSums.values()) {
            if (v < min) min = v;
            if (v > max) max = v;
        }
    }
    for (const series of spec.series) {
        const seriesField = (axis === "x" ? series.encoding.x : series.encoding.y);
        for (const row of spec.data.rows) {
            const raw = row[seriesField];
            if (typeof raw !== "number" || !Number.isFinite(raw)) continue;
            if (raw < min) min = raw;
            if (raw > max) max = raw;
        }
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return {min: 0, max: 1};
    return {min, max};
}

function computeStackedSums(spec: ChartSpec, valueAxis: "x" | "y"): Map<string, number> | undefined {
    const stacked = spec.series.filter(s => s.stack === ChartStackMode.Zero);
    if (stacked.length === 0) return undefined;
    const sums = new Map<string, number>();
    const categoryAxis: "x" | "y" = valueAxis === "x" ? "y" : "x";
    for (const series of stacked) {
        const catField = categoryAxis === "x" ? series.encoding.x : series.encoding.y;
        const valField = valueAxis === "x" ? series.encoding.x : series.encoding.y;
        for (const row of spec.data.rows) {
            const cat = row[catField];
            const val = row[valField];
            if (typeof val !== "number" || cat === null || cat === undefined) continue;
            const key = String(cat);
            sums.set(key, (sums.get(key) ?? 0) + val);
        }
    }
    return sums;
}

// ── Series rendering ────────────────────────────────────────────────────────

function renderAllSeries(spec: ChartSpec, plot: Rect, scales: ChartScales, palette: string[]): string[] {
    const stackState = new Map<string, number>();
    const layers: string[] = [];
    spec.series.forEach((series, index) => {
        const color = resolveColor(series, palette, index);
        layers.push(renderSeries(spec, series, plot, scales, color, stackState));
    });
    return layers;
}

function resolveColor(series: ChartSeries, palette: string[], index: number): string {
    const explicit = series.style?.color;
    if (explicit) return explicit;
    return palette[index % palette.length]!;
}

function renderSeries(spec: ChartSpec, series: ChartSeries, plot: Rect, scales: ChartScales, color: string, stackState: Map<string, number>): string {
    switch (series.mark) {
        case ChartMarkKind.Bar:
            return renderBars(spec, series, scales, color, stackState);
        case ChartMarkKind.Line:
            return renderLine(spec, series, scales, color);
        case ChartMarkKind.Area:
            return renderArea(spec, series, scales, color);
        case ChartMarkKind.Point:
            return renderPoints(spec, series, scales, color);
        case ChartMarkKind.Rule:
            return renderRule(spec, series, plot, scales, color);
    }
}

function valueAxisOf(scales: ChartScales): "x" | "y" {
    // The categorical axis has a defined bandWidth; the value axis does not.
    return scales.yBandWidth === undefined ? "y" : "x";
}

function renderBars(spec: ChartSpec, series: ChartSeries, scales: ChartScales, color: string, stackState: Map<string, number>): string {
    const valueAxis = valueAxisOf(scales);
    const categoryAxis: "x" | "y" = valueAxis === "x" ? "y" : "x";
    const catField = categoryAxis === "x" ? series.encoding.x : series.encoding.y;
    const valField = valueAxis === "x" ? series.encoding.x : series.encoding.y;
    const bandWidth = (categoryAxis === "x" ? scales.xBandWidth : scales.yBandWidth) ?? 0;
    const valueScale = valueAxis === "x" ? scales.xScale : scales.yScale;
    const categoryScale = categoryAxis === "x" ? scales.xScale : scales.yScale;
    const interactionAttrs = interactionAttrsFor(spec, series);

    const cells = spec.data.rows.map(row => {
        const catRaw = row[catField];
        const valRaw = row[valField];
        if (catRaw === null || catRaw === undefined || typeof valRaw !== "number") return "";
        const centerPx = categoryScale(catRaw);
        if (!Number.isFinite(centerPx)) return "";
        const key = String(catRaw);
        const offset = series.stack === ChartStackMode.Zero ? (stackState.get(key) ?? 0) : 0;
        if (series.stack === ChartStackMode.Zero) stackState.set(key, offset + valRaw);
        const startPx = valueScale(offset);
        const endPx = valueScale(offset + valRaw);
        return barRectSvg(categoryAxis, centerPx, bandWidth, startPx, endPx, color, interactionAttrs);
    });
    return groupFor(series, cells.join(""));
}

function barRectSvg(categoryAxis: "x" | "y", centerPx: number, bandWidth: number, startPx: number, endPx: number, color: string, interactionAttrs: string): string {
    if (categoryAxis === "x") {
        const x = centerPx - bandWidth / 2;
        const yTop = Math.min(startPx, endPx);
        const h = Math.abs(endPx - startPx);
        return `<rect x="${x}" y="${yTop}" width="${bandWidth}" height="${h}" fill="${color}" stroke="${color}" stroke-width="${BAR_STROKE_WIDTH}"${interactionAttrs} />`;
    }
    const y = centerPx - bandWidth / 2;
    const xLeft = Math.min(startPx, endPx);
    const w = Math.abs(endPx - startPx);
    return `<rect x="${xLeft}" y="${y}" width="${w}" height="${bandWidth}" fill="${color}" stroke="${color}" stroke-width="${BAR_STROKE_WIDTH}"${interactionAttrs} />`;
}

function renderLine(spec: ChartSpec, series: ChartSeries, scales: ChartScales, color: string): string {
    const points = collectPoints(spec.data, series, scales);
    if (points.length === 0) return "";
    const path = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const interactionAttrs = interactionAttrsFor(spec, series);
    return groupFor(series, `<path d="${path}" fill="none" stroke="${color}" stroke-width="${LINE_STROKE_WIDTH}"${interactionAttrs} />`);
}

function renderArea(spec: ChartSpec, series: ChartSeries, scales: ChartScales, color: string): string {
    const points = collectPoints(spec.data, series, scales);
    if (points.length === 0) return "";
    const valueAxis = valueAxisOf(scales);
    const valueScale = valueAxis === "x" ? scales.xScale : scales.yScale;
    const baseline = valueScale(0);
    const top = points.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ");
    const close = valueAxis === "y"
        ? `L ${points[points.length - 1]!.x} ${baseline} L ${points[0]!.x} ${baseline} Z`
        : `L ${baseline} ${points[points.length - 1]!.y} L ${baseline} ${points[0]!.y} Z`;
    const interactionAttrs = interactionAttrsFor(spec, series);
    return groupFor(series, `<path d="${top} ${close}" fill="${color}" fill-opacity="${AREA_FILL_OPACITY}" stroke="${color}" stroke-width="${LINE_STROKE_WIDTH}"${interactionAttrs} />`);
}

function renderPoints(spec: ChartSpec, series: ChartSeries, scales: ChartScales, color: string): string {
    const points = collectPoints(spec.data, series, scales);
    const interactionAttrs = interactionAttrsFor(spec, series);
    const dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${POINT_RADIUS}" fill="${color}"${interactionAttrs} />`).join("");
    return groupFor(series, dots);
}

function renderRule(spec: ChartSpec, series: ChartSeries, plot: Rect, scales: ChartScales, color: string): string {
    const points = collectPoints(spec.data, series, scales);
    const valueAxis = valueAxisOf(scales);
    const interactionAttrs = interactionAttrsFor(spec, series);
    const lines = points.map(p => valueAxis === "y"
        ? `<line x1="${plot.x}" y1="${p.y}" x2="${plot.x + plot.width}" y2="${p.y}" stroke="${color}" stroke-width="${RULE_STROKE_WIDTH}"${interactionAttrs} />`
        : `<line x1="${p.x}" y1="${plot.y}" x2="${p.x}" y2="${plot.y + plot.height}" stroke="${color}" stroke-width="${RULE_STROKE_WIDTH}"${interactionAttrs} />`
    ).join("");
    return groupFor(series, lines);
}

function collectPoints(data: ChartData, series: ChartSeries, scales: ChartScales): Array<{x: number; y: number}> {
    const out: Array<{x: number; y: number}> = [];
    for (const row of data.rows) {
        const x = scales.xScale(row[series.encoding.x] ?? null);
        const y = scales.yScale(row[series.encoding.y] ?? null);
        if (Number.isFinite(x) && Number.isFinite(y)) out.push({x, y});
    }
    return out;
}

function groupFor(series: ChartSeries, content: string): string {
    return `<g data-doodles-series="${xmlEscape(series.id)}">${content}</g>`;
}

function interactionAttrsFor(spec: ChartSpec, series: ChartSeries): string {
    const matching = (spec.interactions ?? []).filter((i: ChartInteraction) => i.seriesId === undefined || i.seriesId === series.id);
    if (matching.length === 0) return "";
    return matching
        .map(i => ` data-doodles-${i.event}="${xmlEscape(i.handler)}"`)
        .join("");
}

// ── Axes ────────────────────────────────────────────────────────────────────

function renderAxes(spec: ChartSpec, plot: Rect, scales: ChartScales, theme: ThemeTokens): string {
    return renderXAxis(spec, plot, scales, theme) + renderYAxis(spec, plot, scales, theme);
}

function renderXAxis(spec: ChartSpec, plot: Rect, scales: ChartScales, theme: ThemeTokens): string {
    const axisY = plot.y + plot.height;
    const line = `<line x1="${plot.x}" y1="${axisY}" x2="${plot.x + plot.width}" y2="${axisY}" stroke="${theme.colors.edgeStroke}" stroke-width="1" opacity="${AXIS_LINE_OPACITY}" />`;
    const ticks = axisTicks(spec.xAxis, scales.xScale, spec.xAxis.scale === ChartScaleKind.Categorical
        ? collectCategoryDomain(spec, "x", spec.series[0]?.encoding.x)
        : undefined);
    const tickSvg = ticks.map(t => xTickSvg(t.position, t.label, axisY, theme)).join("");
    const label = spec.xAxis.label
        ? `<text x="${plot.x + plot.width / 2}" y="${axisY + X_AXIS_LABEL_OFFSET}" text-anchor="middle" dominant-baseline="hanging" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" fill="${theme.colors.nodeText}">${xmlEscape(spec.xAxis.label)}</text>`
        : "";
    return line + tickSvg + label;
}

function renderYAxis(spec: ChartSpec, plot: Rect, scales: ChartScales, theme: ThemeTokens): string {
    const axisX = plot.x;
    const line = `<line x1="${axisX}" y1="${plot.y}" x2="${axisX}" y2="${plot.y + plot.height}" stroke="${theme.colors.edgeStroke}" stroke-width="1" opacity="${AXIS_LINE_OPACITY}" />`;
    const ticks = axisTicks(spec.yAxis, scales.yScale, spec.yAxis.scale === ChartScaleKind.Categorical
        ? collectCategoryDomain(spec, "y", spec.series[0]?.encoding.y)
        : undefined);
    const tickSvg = ticks.map(t => yTickSvg(t.position, t.label, axisX, theme)).join("");
    const label = spec.yAxis.label
        ? `<text x="${axisX - Y_AXIS_LABEL_OFFSET}" y="${plot.y + plot.height / 2}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${axisX - Y_AXIS_LABEL_OFFSET} ${plot.y + plot.height / 2})" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" fill="${theme.colors.nodeText}">${xmlEscape(spec.yAxis.label)}</text>`
        : "";
    return line + tickSvg + label;
}

interface AxisTick {
    position: number;
    label: string;
}

function axisTicks(axis: ChartSpec["xAxis"], scale: ScaleFn, categories: string[] | undefined): AxisTick[] {
    if (axis.scale === ChartScaleKind.Categorical && categories) {
        return categories.map(c => ({position: scale(c), label: c}));
    }
    if (Array.isArray(axis.domain) && axis.domain.length === 2 && typeof axis.domain[0] === "number" && typeof axis.domain[1] === "number") {
        const [d0, d1] = axis.domain as [number, number];
        const step = (d1 - d0) / (DEFAULT_LINEAR_TICK_COUNT - 1);
        return Array.from({length: DEFAULT_LINEAR_TICK_COUNT}, (_, i) => {
            const v = d0 + step * i;
            return {position: scale(v), label: formatNumber(v)};
        });
    }
    return [];
}

function xTickSvg(position: number, label: string, axisY: number, theme: ThemeTokens): string {
    const tickLine = `<line x1="${position}" y1="${axisY}" x2="${position}" y2="${axisY + AXIS_TICK_LENGTH}" stroke="${theme.colors.edgeStroke}" stroke-width="1" opacity="${AXIS_LINE_OPACITY}" />`;
    const text = `<text x="${position}" y="${axisY + AXIS_TICK_LENGTH + AXIS_TICK_LABEL_GAP}" text-anchor="middle" dominant-baseline="hanging" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size * TICK_FONT_SIZE_MULTIPLIER}" fill="${theme.colors.nodeText}">${xmlEscape(label)}</text>`;
    return tickLine + text;
}

function yTickSvg(position: number, label: string, axisX: number, theme: ThemeTokens): string {
    const tickLine = `<line x1="${axisX - AXIS_TICK_LENGTH}" y1="${position}" x2="${axisX}" y2="${position}" stroke="${theme.colors.edgeStroke}" stroke-width="1" opacity="${AXIS_LINE_OPACITY}" />`;
    const text = `<text x="${axisX - AXIS_TICK_LENGTH - AXIS_TICK_LABEL_GAP}" y="${position}" text-anchor="end" dominant-baseline="middle" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size * TICK_FONT_SIZE_MULTIPLIER}" fill="${theme.colors.nodeText}">${xmlEscape(label)}</text>`;
    return tickLine + text;
}

function formatNumber(n: number): string {
    if (Number.isInteger(n)) return String(n);
    return Number(n.toFixed(2)).toString();
}

// ── Grid ────────────────────────────────────────────────────────────────────

function renderGrid(spec: ChartSpec, plot: Rect, scales: ChartScales, theme: ThemeTokens): string {
    const parts: string[] = [];
    if (spec.xAxis.grid) parts.push(verticalGridLines(spec, plot, scales, theme));
    if (spec.yAxis.grid) parts.push(horizontalGridLines(spec, plot, scales, theme));
    return parts.join("");
}

function verticalGridLines(spec: ChartSpec, plot: Rect, scales: ChartScales, theme: ThemeTokens): string {
    const ticks = axisTicks(spec.xAxis, scales.xScale, spec.xAxis.scale === ChartScaleKind.Categorical
        ? collectCategoryDomain(spec, "x", spec.series[0]?.encoding.x)
        : undefined);
    return ticks.map(t => `<line x1="${t.position}" y1="${plot.y}" x2="${t.position}" y2="${plot.y + plot.height}" stroke="${theme.colors.edgeStroke}" stroke-width="${GRID_STROKE_WIDTH}" opacity="${GRID_OPACITY}" />`).join("");
}

function horizontalGridLines(spec: ChartSpec, plot: Rect, scales: ChartScales, theme: ThemeTokens): string {
    const ticks = axisTicks(spec.yAxis, scales.yScale, spec.yAxis.scale === ChartScaleKind.Categorical
        ? collectCategoryDomain(spec, "y", spec.series[0]?.encoding.y)
        : undefined);
    return ticks.map(t => `<line x1="${plot.x}" y1="${t.position}" x2="${plot.x + plot.width}" y2="${t.position}" stroke="${theme.colors.edgeStroke}" stroke-width="${GRID_STROKE_WIDTH}" opacity="${GRID_OPACITY}" />`).join("");
}

// ── Title ───────────────────────────────────────────────────────────────────

function renderTitle(title: string, chartWidth: number, theme: ThemeTokens): string {
    return `<text x="${chartWidth / 2}" y="${TITLE_BASELINE_OFFSET}" text-anchor="middle" dominant-baseline="middle" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size * TITLE_FONT_SIZE_MULTIPLIER}" font-weight="bold" fill="${theme.colors.nodeText}">${xmlEscape(title)}</text>`;
}
