import {
    type ChartCellValue,
    type ChartInteraction,
    type ChartSeries,
    type ChartSpec,
    type Coordinate,
    ChartMarkKind,
    ChartScaleKind,
    ChartStackMode,
} from "@benkalegin/doodles-core";
import {defaultLightTheme, type ThemeTokens} from "./theme.js";
import {xmlEscape} from "./escape.js";
import {polylineToPathD} from "./index.js";

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
const DEGENERATE_DOMAIN_PAD = 1;
const TICK_DECIMAL_DIGITS = 2;
const FALLBACK_EXTENT_MIN = 0;
const FALLBACK_EXTENT_MAX = 1;

// Tableau-10-ish palette — picked so successive series stay distinguishable on
// both light and dark hosts. Override via ChartRenderOptions.palette.
const DEFAULT_PALETTE = [
    "#4C78A8", "#F58518", "#54A24B", "#E45756", "#72B7B2",
    "#EECA3B", "#B279A2", "#FF9DA6", "#9D755D", "#BAB0AC",
];

const AxisSide = {
    X: "x",
    Y: "y",
} as const;
type AxisSide = (typeof AxisSide)[keyof typeof AxisSide];

const AxisKind = {
    Categorical: "categorical",
    Linear: "linear",
} as const;
type AxisKind = (typeof AxisKind)[keyof typeof AxisKind];

interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}

type ScaleFn = (value: ChartCellValue) => number;

interface AxisTick {
    position: number;
    label: string;
}

interface BaseAxis {
    side: AxisSide;
    scale: ScaleFn;
    ticks: AxisTick[];
    field?: string;
}

interface CategoricalAxis extends BaseAxis {
    kind: typeof AxisKind.Categorical;
    categories: string[];
    bandWidth: number;
}

interface LinearAxis extends BaseAxis {
    kind: typeof AxisKind.Linear;
    domain: [number, number];
}

type ResolvedAxis = CategoricalAxis | LinearAxis;

interface ChartLayout {
    plot: Rect;
    xAxis: ResolvedAxis;
    yAxis: ResolvedAxis;
    /** Present when exactly one axis is categorical (bar/area/rule modes). */
    categoryAxis?: CategoricalAxis;
    /** The numeric axis values measure against; defaults to y in scatter mode. */
    valueAxis?: LinearAxis;
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

    const layout = computeLayout(spec);

    const layers: string[] = [];
    layers.push(renderGrid(spec, layout, theme));
    layers.push(renderAxes(spec, layout, theme));
    layers.push(...renderAllSeries(spec, layout, palette));
    if (spec.title) layers.push(renderTitle(spec.title, spec.display.width, theme));

    const {width, height} = spec.display;
    const outerWidth = width + padding * 2;
    const outerHeight = height + padding * 2;
    const viewBox = `${-padding} ${-padding} ${outerWidth} ${outerHeight}`;
    const background = theme.colors.background !== "transparent"
        ? `<rect x="${-padding}" y="${-padding}" width="${outerWidth}" height="${outerHeight}" fill="${theme.colors.background}" />`
        : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" class="doodles-svg doodles-svg-chart" viewBox="${viewBox}" width="${outerWidth}" height="${outerHeight}">${background}${layers.join("")}</svg>`;
}

// ── Layout ──────────────────────────────────────────────────────────────────

function computeLayout(spec: ChartSpec): ChartLayout {
    const plot = computePlotRect(spec.display.width, spec.display.height, spec.title);
    const xField = spec.series[0]?.encoding.x;
    const yField = spec.series[0]?.encoding.y;

    const xCategorical = spec.xAxis.scale === ChartScaleKind.Categorical;
    const yCategorical = spec.yAxis.scale === ChartScaleKind.Categorical;

    const xAxis = resolveAxis(spec, AxisSide.X, xField, xCategorical, plot.x, plot.x + plot.width);
    const yAxis = resolveAxis(spec, AxisSide.Y, yField, yCategorical, plot.y + plot.height, plot.y);

    const categoryAxis = pickCategoryAxis(xAxis, yAxis);
    const valueAxis = pickValueAxis(xAxis, yAxis);

    const layout: ChartLayout = {plot, xAxis, yAxis};
    if (categoryAxis) layout.categoryAxis = categoryAxis;
    if (valueAxis) layout.valueAxis = valueAxis;
    return layout;
}

function pickCategoryAxis(xAxis: ResolvedAxis, yAxis: ResolvedAxis): CategoricalAxis | undefined {
    if (xAxis.kind === AxisKind.Categorical) return xAxis;
    if (yAxis.kind === AxisKind.Categorical) return yAxis;
    return undefined;
}

// In scatter mode (both linear) the y-axis carries values by convention.
function pickValueAxis(xAxis: ResolvedAxis, yAxis: ResolvedAxis): LinearAxis | undefined {
    if (yAxis.kind === AxisKind.Linear) return yAxis;
    if (xAxis.kind === AxisKind.Linear) return xAxis;
    return undefined;
}

function computePlotRect(width: number, height: number, title: string | undefined): Rect {
    const top = title ? PLOT_MARGIN_TOP_WITH_TITLE : PLOT_MARGIN_TOP_NO_TITLE;
    return {
        x: PLOT_MARGIN_LEFT,
        y: top,
        width: width - PLOT_MARGIN_LEFT - PLOT_MARGIN_RIGHT,
        height: height - top - PLOT_MARGIN_BOTTOM,
    };
}

function resolveAxis(
    spec: ChartSpec,
    side: AxisSide,
    field: string | undefined,
    categorical: boolean,
    rangeStart: number,
    rangeEnd: number,
): ResolvedAxis {
    if (categorical) {
        const categories = collectCategoryDomain(spec, side, field);
        const {scale, bandWidth} = buildBandScale(categories, rangeStart, rangeEnd);
        const ticks: AxisTick[] = categories.map(c => ({position: scale(c), label: c}));
        const axis: CategoricalAxis = {kind: AxisKind.Categorical, side, scale, ticks, categories, bandWidth};
        if (field !== undefined) axis.field = field;
        return axis;
    }
    const domain = computeAxisExtent(spec, side);
    const scale = buildLinearScale(domain, rangeStart, rangeEnd);
    const ticks = linearAxisTicks(domain, scale);
    const axis: LinearAxis = {kind: AxisKind.Linear, side, scale, ticks, domain};
    if (field !== undefined) axis.field = field;
    return axis;
}

// ── Scales ──────────────────────────────────────────────────────────────────

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
        const i = index.get(String(raw));
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

function collectCategoryDomain(spec: ChartSpec, side: AxisSide, field: string | undefined): string[] {
    const declared = (side === AxisSide.X ? spec.xAxis.domain : spec.yAxis.domain);
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

/**
 * Single-pass extent computation for a numeric axis. Walks each row once,
 * accumulating both individual series min/max and per-category stacked totals
 * (when stacking applies — i.e. the OTHER axis is categorical). Old code
 * iterated rows (1 + series.length) times; this is a single sweep.
 */
function computeAxisExtent(spec: ChartSpec, side: AxisSide): [number, number] {
    const declared = (side === AxisSide.X ? spec.xAxis.domain : spec.yAxis.domain);
    const declaredMin = Array.isArray(declared) && typeof declared[0] === "number" ? declared[0] : undefined;
    const declaredMax = Array.isArray(declared) && typeof declared[1] === "number" ? declared[1] : undefined;
    if (declaredMin !== undefined && declaredMax !== undefined) return [declaredMin, declaredMax];

    const otherSide: AxisSide = side === AxisSide.X ? AxisSide.Y : AxisSide.X;
    const otherCategorical = (otherSide === AxisSide.X ? spec.xAxis.scale : spec.yAxis.scale) === ChartScaleKind.Categorical;

    const stackedTotals = new Map<string, number>();
    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;

    for (const row of spec.data.rows) {
        for (const series of spec.series) {
            const v = row[fieldFor(series, side)];
            if (typeof v !== "number" || !Number.isFinite(v)) continue;
            if (v < min) min = v;
            if (v > max) max = v;
            if (!otherCategorical || series.stack !== ChartStackMode.Zero) continue;
            const cat = row[fieldFor(series, otherSide)];
            if (cat === null || cat === undefined) continue;
            const key = String(cat);
            stackedTotals.set(key, (stackedTotals.get(key) ?? 0) + v);
        }
    }
    for (const total of stackedTotals.values()) {
        if (total < min) min = total;
        if (total > max) max = total;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) {
        min = FALLBACK_EXTENT_MIN;
        max = FALLBACK_EXTENT_MAX;
    }
    const finalMin = declaredMin ?? Math.min(0, min);
    const finalMax = declaredMax ?? Math.max(0, max);
    if (finalMin === finalMax) return [finalMin - DEGENERATE_DOMAIN_PAD, finalMax + DEGENERATE_DOMAIN_PAD];
    return [finalMin, finalMax];
}

function fieldFor(series: ChartSeries, side: AxisSide): string {
    return side === AxisSide.X ? series.encoding.x : series.encoding.y;
}

function linearAxisTicks(domain: [number, number], scale: ScaleFn): AxisTick[] {
    const [d0, d1] = domain;
    const step = (d1 - d0) / (DEFAULT_LINEAR_TICK_COUNT - 1);
    return Array.from({length: DEFAULT_LINEAR_TICK_COUNT}, (_, i) => {
        const v = d0 + step * i;
        return {position: scale(v), label: formatNumber(v)};
    });
}

// ── Series rendering ────────────────────────────────────────────────────────

function renderAllSeries(spec: ChartSpec, layout: ChartLayout, palette: string[]): string[] {
    const stackState = new Map<string, number>();
    return spec.series.map((series, index) => {
        const color = resolveColor(series, palette, index);
        return renderSeries(spec, series, layout, color, stackState);
    });
}

function resolveColor(series: ChartSeries, palette: string[], index: number): string {
    return series.style?.color ?? palette[index % palette.length]!;
}

function renderSeries(spec: ChartSpec, series: ChartSeries, layout: ChartLayout, color: string, stackState: Map<string, number>): string {
    switch (series.mark) {
        case ChartMarkKind.Bar:
            return renderBars(spec, series, layout, color, stackState);
        case ChartMarkKind.Line:
            return renderLine(spec, series, layout, color);
        case ChartMarkKind.Area:
            return renderArea(spec, series, layout, color);
        case ChartMarkKind.Point:
            return renderPoints(spec, series, layout, color);
        case ChartMarkKind.Rule:
            return renderRule(spec, series, layout, color);
    }
}

function renderBars(spec: ChartSpec, series: ChartSeries, layout: ChartLayout, color: string, stackState: Map<string, number>): string {
    const {categoryAxis, valueAxis} = layout;
    if (!categoryAxis || !valueAxis) return ""; // bars require one categorical + one linear axis
    const catField = fieldFor(series, categoryAxis.side);
    const valField = fieldFor(series, valueAxis.side);
    const interactionAttrs = interactionAttrsFor(spec, series);
    const stacked = series.stack === ChartStackMode.Zero;

    const cells = spec.data.rows.map(row => {
        const catRaw = row[catField];
        const valRaw = row[valField];
        if (catRaw === null || catRaw === undefined || typeof valRaw !== "number") return "";
        const centerPx = categoryAxis.scale(catRaw);
        if (!Number.isFinite(centerPx)) return "";
        const key = String(catRaw);
        const offset = stacked ? (stackState.get(key) ?? 0) : 0;
        if (stacked) stackState.set(key, offset + valRaw);
        const startPx = valueAxis.scale(offset);
        const endPx = valueAxis.scale(offset + valRaw);
        return barRectSvg(categoryAxis.side, centerPx, categoryAxis.bandWidth, startPx, endPx, color, interactionAttrs);
    });
    return groupFor(series, cells.join(""));
}

function barRectSvg(categorySide: AxisSide, centerPx: number, bandWidth: number, startPx: number, endPx: number, color: string, interactionAttrs: string): string {
    const isVertical = categorySide === AxisSide.X;
    const x = isVertical ? centerPx - bandWidth / 2 : Math.min(startPx, endPx);
    const y = isVertical ? Math.min(startPx, endPx) : centerPx - bandWidth / 2;
    const width = isVertical ? bandWidth : Math.abs(endPx - startPx);
    const height = isVertical ? Math.abs(endPx - startPx) : bandWidth;
    return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${color}" stroke="${color}" stroke-width="${BAR_STROKE_WIDTH}"${interactionAttrs} />`;
}

function renderLine(spec: ChartSpec, series: ChartSeries, layout: ChartLayout, color: string): string {
    const points = collectPoints(spec, series, layout);
    if (points.length === 0) return "";
    const interactionAttrs = interactionAttrsFor(spec, series);
    return groupFor(series, `<path d="${polylineToPathD(points)}" fill="none" stroke="${color}" stroke-width="${LINE_STROKE_WIDTH}"${interactionAttrs} />`);
}

function renderArea(spec: ChartSpec, series: ChartSeries, layout: ChartLayout, color: string): string {
    const points = collectPoints(spec, series, layout);
    if (points.length === 0) return "";
    const {valueAxis} = layout;
    if (!valueAxis) return ""; // area needs a value axis to anchor the baseline
    const baseline = valueAxis.scale(0);
    const top = polylineToPathD(points);
    const last = points[points.length - 1]!;
    const first = points[0]!;
    const close = valueAxis.side === AxisSide.Y
        ? `L ${last.x} ${baseline} L ${first.x} ${baseline} Z`
        : `L ${baseline} ${last.y} L ${baseline} ${first.y} Z`;
    const interactionAttrs = interactionAttrsFor(spec, series);
    return groupFor(series, `<path d="${top} ${close}" fill="${color}" fill-opacity="${AREA_FILL_OPACITY}" stroke="${color}" stroke-width="${LINE_STROKE_WIDTH}"${interactionAttrs} />`);
}

function renderPoints(spec: ChartSpec, series: ChartSeries, layout: ChartLayout, color: string): string {
    const points = collectPoints(spec, series, layout);
    const interactionAttrs = interactionAttrsFor(spec, series);
    const dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="${POINT_RADIUS}" fill="${color}"${interactionAttrs} />`).join("");
    return groupFor(series, dots);
}

function renderRule(spec: ChartSpec, series: ChartSeries, layout: ChartLayout, color: string): string {
    const points = collectPoints(spec, series, layout);
    if (points.length === 0) return "";
    const interactionAttrs = interactionAttrsFor(spec, series);
    const {plot, valueAxis} = layout;
    const horizontal = (valueAxis?.side ?? AxisSide.Y) === AxisSide.Y;
    const lines = points.map(p => horizontal
        ? `<line x1="${plot.x}" y1="${p.y}" x2="${plot.x + plot.width}" y2="${p.y}" stroke="${color}" stroke-width="${RULE_STROKE_WIDTH}"${interactionAttrs} />`
        : `<line x1="${p.x}" y1="${plot.y}" x2="${p.x}" y2="${plot.y + plot.height}" stroke="${color}" stroke-width="${RULE_STROKE_WIDTH}"${interactionAttrs} />`
    ).join("");
    return groupFor(series, lines);
}

function collectPoints(spec: ChartSpec, series: ChartSeries, layout: ChartLayout): Coordinate[] {
    const {xAxis, yAxis} = layout;
    const out: Coordinate[] = [];
    for (const row of spec.data.rows) {
        const x = xAxis.scale(row[series.encoding.x] ?? null);
        const y = yAxis.scale(row[series.encoding.y] ?? null);
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
    return matching.map(i => ` data-doodles-${i.event}="${xmlEscape(i.handler)}"`).join("");
}

// ── Axes ────────────────────────────────────────────────────────────────────

function renderAxes(spec: ChartSpec, layout: ChartLayout, theme: ThemeTokens): string {
    return renderXAxisLine(spec, layout, theme) + renderYAxisLine(spec, layout, theme);
}

function renderXAxisLine(spec: ChartSpec, layout: ChartLayout, theme: ThemeTokens): string {
    const {plot, xAxis} = layout;
    const axisY = plot.y + plot.height;
    const line = `<line x1="${plot.x}" y1="${axisY}" x2="${plot.x + plot.width}" y2="${axisY}" stroke="${theme.colors.edgeStroke}" stroke-width="1" opacity="${AXIS_LINE_OPACITY}" />`;
    const tickSvg = xAxis.ticks.map(t => xTickSvg(t.position, t.label, axisY, theme)).join("");
    const label = spec.xAxis.label
        ? `<text x="${plot.x + plot.width / 2}" y="${axisY + X_AXIS_LABEL_OFFSET}" text-anchor="middle" dominant-baseline="hanging" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" fill="${theme.colors.nodeText}">${xmlEscape(spec.xAxis.label)}</text>`
        : "";
    return line + tickSvg + label;
}

function renderYAxisLine(spec: ChartSpec, layout: ChartLayout, theme: ThemeTokens): string {
    const {plot, yAxis} = layout;
    const axisX = plot.x;
    const line = `<line x1="${axisX}" y1="${plot.y}" x2="${axisX}" y2="${plot.y + plot.height}" stroke="${theme.colors.edgeStroke}" stroke-width="1" opacity="${AXIS_LINE_OPACITY}" />`;
    const tickSvg = yAxis.ticks.map(t => yTickSvg(t.position, t.label, axisX, theme)).join("");
    const label = spec.yAxis.label
        ? `<text x="${axisX - Y_AXIS_LABEL_OFFSET}" y="${plot.y + plot.height / 2}" text-anchor="middle" dominant-baseline="middle" transform="rotate(-90 ${axisX - Y_AXIS_LABEL_OFFSET} ${plot.y + plot.height / 2})" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size}" fill="${theme.colors.nodeText}">${xmlEscape(spec.yAxis.label)}</text>`
        : "";
    return line + tickSvg + label;
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
    return Number(n.toFixed(TICK_DECIMAL_DIGITS)).toString();
}

// ── Grid ────────────────────────────────────────────────────────────────────

function renderGrid(spec: ChartSpec, layout: ChartLayout, theme: ThemeTokens): string {
    const parts: string[] = [];
    if (spec.xAxis.grid) parts.push(verticalGridLines(layout, theme));
    if (spec.yAxis.grid) parts.push(horizontalGridLines(layout, theme));
    return parts.join("");
}

function verticalGridLines(layout: ChartLayout, theme: ThemeTokens): string {
    const {plot, xAxis} = layout;
    return xAxis.ticks.map(t => `<line x1="${t.position}" y1="${plot.y}" x2="${t.position}" y2="${plot.y + plot.height}" stroke="${theme.colors.edgeStroke}" stroke-width="${GRID_STROKE_WIDTH}" opacity="${GRID_OPACITY}" />`).join("");
}

function horizontalGridLines(layout: ChartLayout, theme: ThemeTokens): string {
    const {plot, yAxis} = layout;
    return yAxis.ticks.map(t => `<line x1="${plot.x}" y1="${t.position}" x2="${plot.x + plot.width}" y2="${t.position}" stroke="${theme.colors.edgeStroke}" stroke-width="${GRID_STROKE_WIDTH}" opacity="${GRID_OPACITY}" />`).join("");
}

// ── Title ───────────────────────────────────────────────────────────────────

function renderTitle(title: string, chartWidth: number, theme: ThemeTokens): string {
    return `<text x="${chartWidth / 2}" y="${TITLE_BASELINE_OFFSET}" text-anchor="middle" dominant-baseline="middle" font-family="${xmlEscape(theme.font.family)}" font-size="${theme.font.size * TITLE_FONT_SIZE_MULTIPLIER}" font-weight="bold" fill="${theme.colors.nodeText}">${xmlEscape(title)}</text>`;
}
