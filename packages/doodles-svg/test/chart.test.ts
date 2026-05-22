import {describe, expect, it} from "vitest";
import {importMermaidXyChartDiagram} from "@benkalegin/doodles-mermaid";
import {importVegaLiteChart} from "@benkalegin/doodles-vega";
import {renderChartSvg} from "../src/chart.js";

describe("renderChartSvg via importMermaidXyChartDiagram", () => {
    it("emits a single <svg> root sized to the spec's display + padding", () => {
        const spec = importMermaidXyChartDiagram(`xychart\n    bar [1, 2, 3]`);
        const svg = renderChartSvg(spec);
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg.endsWith("</svg>")).toBe(true);
        expect(svg).toMatch(/viewBox="-?\d+ -?\d+ \d+ \d+"/);
        // 600x400 display + default padding of 12 on each side
        expect(svg).toContain(`width="624"`);
        expect(svg).toContain(`height="424"`);
    });

    it("renders one <rect> per bar (4 bars from doc fixture 2)", () => {
        const spec = importMermaidXyChartDiagram(`xychart
    title "Sales Data"
    x-axis [Q1, Q2, Q3, Q4]
    y-axis "Revenue" 0 --> 100
    bar [23, 45, 35, 67]`);
        const svg = renderChartSvg(spec);
        const rects = (svg.match(/<rect\b/g) ?? []).length;
        expect(rects).toBe(4);
    });

    it("renders a <path> for line series and a <rect> set for bar series in mixed mode", () => {
        const spec = importMermaidXyChartDiagram(`xychart
    title "Comparison"
    x-axis [Jan, Feb, Mar]
    y-axis "Values" 0 --> 50
    bar [20, 30, 25]
    line [15, 28, 35]`);
        const svg = renderChartSvg(spec);
        expect((svg.match(/<rect\b/g) ?? []).length).toBe(3);
        expect((svg.match(/<path\b/g) ?? []).length).toBe(1);
    });

    it("emits the title text", () => {
        const spec = importMermaidXyChartDiagram(`xychart\n    title "My Chart"\n    bar [1, 2, 3]`);
        const svg = renderChartSvg(spec);
        expect(svg).toMatch(/<text[^>]*>My Chart<\/text>/);
    });

    it("emits axis tick labels for categorical axes", () => {
        const spec = importMermaidXyChartDiagram(`xychart
    x-axis [Jan, Feb, Mar]
    y-axis 0 --> 50
    bar [10, 20, 30]`);
        const svg = renderChartSvg(spec);
        expect(svg).toContain(">Jan<");
        expect(svg).toContain(">Feb<");
        expect(svg).toContain(">Mar<");
    });

    it("emits numeric tick labels for linear axes", () => {
        const spec = importMermaidXyChartDiagram(`xychart
    x-axis [a, b]
    y-axis 0 --> 100
    bar [50, 80]`);
        const svg = renderChartSvg(spec);
        expect(svg).toContain(">0<");
        expect(svg).toContain(">100<");
    });

    it("applies palette colors when frontmatter declares plotColorPalette", () => {
        const spec = importMermaidXyChartDiagram(`---
config:
  themeVariables:
    xyChart:
      plotColorPalette: "#aabbcc, #ddeeff"
---
xychart
    x-axis [Jan, Feb]
    y-axis 0 --> 100
    bar [50, 80]
    line [40, 60]`);
        const svg = renderChartSvg(spec);
        expect(svg).toContain("#aabbcc");
        expect(svg).toContain("#ddeeff");
    });

    it("groups marks by series id so the host can target a whole series", () => {
        const spec = importMermaidXyChartDiagram(`xychart\n    bar [1, 2, 3]`);
        const svg = renderChartSvg(spec);
        const seriesId = spec.series[0]!.id;
        expect(svg).toContain(`data-doodles-series="${seriesId}"`);
    });

    it("places category bars in source order on the horizontal axis (vertical orientation)", () => {
        const spec = importMermaidXyChartDiagram(`xychart
    x-axis [A, B, C]
    y-axis 0 --> 10
    bar [5, 5, 5]`);
        const svg = renderChartSvg(spec);
        const xs = Array.from(svg.matchAll(/<rect x="([0-9.]+)"/g)).map(m => Number(m[1]));
        // Category bars only — should be 3 sorted ascending.
        expect(xs).toHaveLength(3);
        expect(xs[0]!).toBeLessThan(xs[1]!);
        expect(xs[1]!).toBeLessThan(xs[2]!);
    });

    it("renders horizontal bars when xychart-beta uses horizontal orientation", () => {
        const spec = importMermaidXyChartDiagram(`xychart horizontal
    title "Performance"
    x-axis "Score" 0 --> 100
    y-axis [A, B, C]
    bar [40, 60, 80]`);
        const svg = renderChartSvg(spec);
        // Match the rect's own width attribute (anchored after `y="..."`) to
        // avoid catching `stroke-width="0.5"` further down the tag.
        const widths = Array.from(svg.matchAll(/<rect x="[0-9.-]+" y="[0-9.-]+" width="([0-9.]+)"/g)).map(m => Number(m[1]));
        expect(widths).toHaveLength(3);
        expect(widths[0]!).toBeLessThan(widths[1]!);
        expect(widths[1]!).toBeLessThan(widths[2]!);
    });
});

describe("renderChartSvg via importVegaLiteChart", () => {
    it("renders a vega-lite bar spec to SVG", () => {
        const spec = importVegaLiteChart({
            data: {values: [{a: "A", b: 10}, {a: "B", b: 20}, {a: "C", b: 30}]},
            mark: "bar",
            encoding: {x: {field: "a", type: "nominal"}, y: {field: "b", type: "quantitative"}},
        } as never);
        const svg = renderChartSvg(spec);
        expect((svg.match(/<rect\b/g) ?? []).length).toBe(3);
        expect(svg).toContain(">A<");
        expect(svg).toContain(">B<");
        expect(svg).toContain(">C<");
    });

    it("renders stacked bars from a color-split vega-lite spec — same y-position groups stack", () => {
        const spec = importVegaLiteChart({
            data: {
                values: [
                    {m: "Jan", w: "sun", c: 5},
                    {m: "Jan", w: "rain", c: 10},
                    {m: "Feb", w: "sun", c: 7},
                    {m: "Feb", w: "rain", c: 9},
                ],
            },
            mark: "bar",
            encoding: {
                x: {field: "m", type: "ordinal"},
                y: {field: "c", type: "quantitative"},
                color: {field: "w", scale: {range: ["#eebb22", "#1f77b4"]}},
            },
        } as never);
        const svg = renderChartSvg(spec);
        // Two series × two months = 4 rects.
        expect((svg.match(/<rect\b/g) ?? []).length).toBe(4);
        // Both palette colors appear.
        expect(svg).toContain("#eebb22");
        expect(svg).toContain("#1f77b4");
    });

    it("renders point marks as <circle> elements for a scatter spec", () => {
        const spec = importVegaLiteChart({
            data: {values: [{x: 1, y: 2}, {x: 3, y: 4}, {x: 5, y: 6}]},
            mark: "point",
            encoding: {x: {field: "x", type: "quantitative"}, y: {field: "y", type: "quantitative"}},
        } as never);
        const svg = renderChartSvg(spec);
        expect((svg.match(/<circle\b/g) ?? []).length).toBe(3);
    });

    it("emits interaction data-* attributes for params with point selections", () => {
        const spec = importVegaLiteChart({
            data: {values: [{a: "A", b: 1}, {a: "B", b: 2}]},
            params: [
                {name: "highlight", select: {type: "point", on: "pointerover"}},
                {name: "select", select: "point"},
            ],
            mark: "bar",
            encoding: {x: {field: "a", type: "ordinal"}, y: {field: "b", type: "quantitative"}},
        } as never);
        const svg = renderChartSvg(spec);
        expect(svg).toContain(`data-doodles-hover="highlight"`);
        expect(svg).toContain(`data-doodles-click="select"`);
    });

    it("verifies stacked bar heights actually stack on the same x-position", () => {
        const spec = importVegaLiteChart({
            data: {
                values: [
                    {m: "Jan", w: "a", c: 10},
                    {m: "Jan", w: "b", c: 20},
                ],
            },
            mark: "bar",
            encoding: {
                x: {field: "m", type: "ordinal"},
                y: {field: "c", type: "quantitative"},
                color: {field: "w"},
            },
        } as never);
        const svg = renderChartSvg(spec);
        // Both bars share the same x position; the second's y-top should equal the first's y-bottom (top - height).
        const rectMatches = Array.from(svg.matchAll(/<rect x="([0-9.-]+)" y="([0-9.-]+)" width="([0-9.-]+)" height="([0-9.-]+)"/g));
        expect(rectMatches.length).toBe(2);
        const a = rectMatches[0]!;
        const b = rectMatches[1]!;
        expect(Number(a[1])).toBeCloseTo(Number(b[1]), 1); // same x
        // Series A (value 10) sits below Series B (value 20). In SVG y, lower y = higher visually.
        // Stacked: A's top = baseline - h_a; B's top = A's top - h_b. So B's top + B's height = A's top.
        const aTop = Number(a[2]);
        const bTop = Number(b[2]);
        const bHeight = Number(b[4]);
        expect(bTop + bHeight).toBeCloseTo(aTop, 1);
    });
});
