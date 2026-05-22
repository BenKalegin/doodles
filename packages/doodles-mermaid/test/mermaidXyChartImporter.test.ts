import {describe, expect, it} from "vitest";
import {
    ChartMarkKind,
    ChartOrientation,
    ChartScaleKind,
    ChartSourceFormat,
} from "@benkalegin/doodles-core";
import {importMermaidXyChartDiagram} from "../src/mermaidXyChartImporter.js";

// Fixtures lifted from https://mermaid.js.org/syntax/xyChart.html (May 2026).

describe("importMermaidXyChartDiagram", () => {
    describe("doc fixture 1: implicit x-axis", () => {
        const src = `xychart
    line [+1.3, .6, 2.4, -.34]`;
        const spec = importMermaidXyChartDiagram(src);

        it("identifies as chart with vertical orientation", () => {
            expect(spec.kind).toBe("chart");
            expect(spec.orientation).toBe(ChartOrientation.Vertical);
        });

        it("synthesizes an integer x-axis when none is declared", () => {
            expect(spec.xAxis.scale).toBe(ChartScaleKind.Categorical);
            expect(spec.data.rows.map(r => r.category)).toEqual([0, 1, 2, 3]);
        });

        it("parses signed and unsigned decimals correctly", () => {
            expect(spec.data.rows.map(r => r.v0)).toEqual([1.3, 0.6, 2.4, -0.34]);
        });

        it("encodes the single series with category on x and value on y", () => {
            expect(spec.series[0]!.encoding).toEqual({x: "category", y: "v0"});
        });

        it("emits a single line series", () => {
            expect(spec.series).toHaveLength(1);
            expect(spec.series[0]!.mark).toBe(ChartMarkKind.Line);
        });

        it("tags the source format", () => {
            expect(spec.source?.format).toBe(ChartSourceFormat.MermaidXyChartBeta);
            expect(spec.source?.raw).toBe(src);
        });
    });

    describe("doc fixture 2: title, categorical x-axis, numeric y-range, bar", () => {
        const src = `xychart
    title "Sales Data"
    x-axis [Q1, Q2, Q3, Q4]
    y-axis "Revenue" 0 --> 100
    bar [23, 45, 35, 67]`;
        const spec = importMermaidXyChartDiagram(src);

        it("captures the unquoted title", () => {
            expect(spec.title).toBe("Sales Data");
        });

        it("maps bare-token categories on the x-axis", () => {
            expect(spec.xAxis.scale).toBe(ChartScaleKind.Categorical);
            expect(spec.xAxis.domain).toEqual(["Q1", "Q2", "Q3", "Q4"]);
        });

        it("maps the labelled numeric y-axis range", () => {
            expect(spec.yAxis.label).toBe("Revenue");
            expect(spec.yAxis.scale).toBe(ChartScaleKind.Linear);
            expect(spec.yAxis.domain).toEqual([0, 100]);
        });

        it("emits one bar series with the declared values", () => {
            expect(spec.series).toHaveLength(1);
            expect(spec.series[0]!.mark).toBe(ChartMarkKind.Bar);
            expect(spec.data.rows.map(r => r.v0)).toEqual([23, 45, 35, 67]);
        });

        it("aligns categories with the rows", () => {
            expect(spec.data.rows.map(r => r.category)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
        });
    });

    describe("doc fixture 3: horizontal + numeric x-range, categorical y", () => {
        const src = `xychart horizontal
    title "Performance Metrics"
    x-axis "Score" 0 --> 100
    y-axis [Category1, Category2, Category3]
    bar [75, 82, 91]`;
        const spec = importMermaidXyChartDiagram(src);

        it("records the horizontal orientation", () => {
            expect(spec.orientation).toBe(ChartOrientation.Horizontal);
        });

        it("preserves source-side axis labelling (x = numeric, y = categorical)", () => {
            expect(spec.xAxis.scale).toBe(ChartScaleKind.Linear);
            expect(spec.xAxis.label).toBe("Score");
            expect(spec.xAxis.domain).toEqual([0, 100]);
            expect(spec.yAxis.scale).toBe(ChartScaleKind.Categorical);
            expect(spec.yAxis.domain).toEqual(["Category1", "Category2", "Category3"]);
        });

        it("puts categories on the y column and values on the x-side", () => {
            expect(spec.data.rows.map(r => r.category)).toEqual(["Category1", "Category2", "Category3"]);
            expect(spec.data.rows.map(r => r.v0)).toEqual([75, 82, 91]);
        });

        it("swaps series encoding so x reads the value field and y reads the category field", () => {
            expect(spec.series[0]!.encoding).toEqual({x: "v0", y: "category"});
        });
    });

    describe("doc fixture 4: mixed bar + line on same x-axis", () => {
        const src = `xychart
    title "Comparison"
    x-axis [Jan, Feb, Mar]
    y-axis "Values" 0 --> 50
    bar [20, 30, 25]
    line [15, 28, 35]`;
        const spec = importMermaidXyChartDiagram(src);

        it("emits two series with distinct mark types", () => {
            expect(spec.series).toHaveLength(2);
            expect(spec.series[0]!.mark).toBe(ChartMarkKind.Bar);
            expect(spec.series[1]!.mark).toBe(ChartMarkKind.Line);
        });

        it("packs both series into one wide-row table", () => {
            expect(spec.data.fields.map(f => f.name)).toEqual(["category", "v0", "v1"]);
            expect(spec.data.rows).toEqual([
                {category: "Jan", v0: 20, v1: 15},
                {category: "Feb", v0: 30, v1: 28},
                {category: "Mar", v0: 25, v1: 35},
            ]);
        });

        it("leaves stacking unset (xychart-beta has no native stacking)", () => {
            expect(spec.series[0]!.stack).toBeUndefined();
            expect(spec.series[1]!.stack).toBeUndefined();
        });
    });

    describe("doc fixture 5: frontmatter plotColorPalette assigns per-series colors", () => {
        const src = `---
config:
  themeVariables:
    xyChart:
      plotColorPalette: "#f34561, #434452"
---
xychart
    title "Multi-Series"
    x-axis "Months" [Jan, Feb, Mar, Apr]
    y-axis "Sales" 0 --> 150
    bar [45, 60, 55, 70]
    line [30, 50, 48, 65]`;
        const spec = importMermaidXyChartDiagram(src);

        it("assigns palette[0] to the first series", () => {
            expect(spec.series[0]!.style?.color).toBe("#f34561");
        });

        it("assigns palette[1] to the second series", () => {
            expect(spec.series[1]!.style?.color).toBe("#434452");
        });

        it("preserves the quoted x-axis label alongside categories", () => {
            expect(spec.xAxis.label).toBe("Months");
            expect(spec.xAxis.domain).toEqual(["Jan", "Feb", "Mar", "Apr"]);
        });
    });

    describe("plotColorPalette via %%{init: …}%% directive", () => {
        it("reads palette from mermaid's canonical init directive", () => {
            const src = `%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#3b82f6dd, #22c55edd"}}}}%%
xychart-beta
    x-axis [Jan, Feb]
    y-axis 0 --> 100
    bar [50, 80]
    line [40, 60]`;
            const spec = importMermaidXyChartDiagram(src);
            expect(spec.series[0]!.style?.color).toBe("#3b82f6dd");
            expect(spec.series[1]!.style?.color).toBe("#22c55edd");
        });

        it("frontmatter palette wins over init directive when both are present", () => {
            const src = `---
config:
  themeVariables:
    xyChart:
      plotColorPalette: "#aaa, #bbb"
---
%%{init: {"themeVariables": {"xyChart": {"plotColorPalette": "#111, #222"}}}}%%
xychart-beta
    bar [1, 2, 3]
    line [3, 2, 1]`;
            const spec = importMermaidXyChartDiagram(src);
            expect(spec.series[0]!.style?.color).toBe("#aaa");
            expect(spec.series[1]!.style?.color).toBe("#bbb");
        });
    });

    describe("backward-compat: xychart-beta keyword", () => {
        it("accepts the legacy 'xychart-beta' header", () => {
            const spec = importMermaidXyChartDiagram(`xychart-beta\n    bar [1, 2, 3]`);
            expect(spec.kind).toBe("chart");
            expect(spec.series).toHaveLength(1);
        });
    });

    describe("error cases", () => {
        it("rejects empty input", () => {
            expect(() => importMermaidXyChartDiagram("")).toThrow(/empty source/);
        });

        it("rejects missing series", () => {
            expect(() => importMermaidXyChartDiagram("xychart\n    title \"x\"")).toThrow(/at least one bar\/line series/);
        });

        it("rejects non-chart header", () => {
            expect(() => importMermaidXyChartDiagram("flowchart TD\n  A --> B")).toThrow(/expected 'xychart' header/);
        });

        it("rejects malformed series array", () => {
            expect(() => importMermaidXyChartDiagram("xychart\n    bar 1, 2, 3")).toThrow(/\[v1, v2, \.\.\.\]/);
        });

        it("rejects non-numeric series values", () => {
            expect(() => importMermaidXyChartDiagram("xychart\n    bar [1, abc, 3]")).toThrow(/invalid number/);
        });
    });
});
