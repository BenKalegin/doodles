import {describe, expect, it} from "vitest";
import {
    ChartInteractionEvent,
    ChartInteractionTarget,
    ChartMarkKind,
    ChartOrientation,
    ChartScaleKind,
    ChartSourceFormat,
    ChartStackMode,
} from "@benkalegin/doodles-core";
import {importVegaLiteChart} from "../src/vegaLiteImporter.js";

// Fixtures lifted from https://vega.github.io/vega-lite/examples/ (May 2026).

describe("importVegaLiteChart", () => {
    describe("simple bar (vega-lite/examples/bar.html)", () => {
        const spec = {
            $schema: "https://vega.github.io/schema/vega-lite/v6.json",
            description: "A simple bar chart with embedded data.",
            data: {
                values: [
                    {a: "A", b: 28}, {a: "B", b: 55}, {a: "C", b: 43},
                    {a: "D", b: 91}, {a: "E", b: 81}, {a: "F", b: 53},
                    {a: "G", b: 19}, {a: "H", b: 87}, {a: "I", b: 52},
                ],
            },
            mark: "bar",
            encoding: {
                x: {field: "a", type: "nominal", axis: {labelAngle: 0}},
                y: {field: "b", type: "quantitative"},
            },
        };

        it("imports as a single bar series", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.series).toHaveLength(1);
            expect(out.series[0]!.mark).toBe(ChartMarkKind.Bar);
            expect(out.series[0]!.encoding).toEqual({x: "a", y: "b"});
        });

        it("maps nominal x to categorical scale and quantitative y to linear scale", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.xAxis.scale).toBe(ChartScaleKind.Categorical);
            expect(out.yAxis.scale).toBe(ChartScaleKind.Linear);
        });

        it("preserves inline data values", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.data.rows.map(r => r.a)).toEqual(["A", "B", "C", "D", "E", "F", "G", "H", "I"]);
            expect(out.data.rows.map(r => r.b)).toEqual([28, 55, 43, 91, 81, 53, 19, 87, 52]);
        });

        it("uses description as title fallback", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.title).toBe("A simple bar chart with embedded data.");
        });

        it("tags source format and orientation", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.source?.format).toBe(ChartSourceFormat.VegaLite);
            expect(out.orientation).toBe(ChartOrientation.Vertical);
        });

        it("does not emit a stack mode for a bar without color split", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.series[0]!.stack).toBeUndefined();
        });

        it("accepts JSON string input as well as parsed object", () => {
            const out = importVegaLiteChart(JSON.stringify(spec));
            expect(out.kind).toBe("chart");
            expect(out.series).toHaveLength(1);
        });
    });

    describe("scatter (point mark)", () => {
        // Adapted to inline data — original example uses data.url.
        const spec = {
            $schema: "https://vega.github.io/schema/vega-lite/v6.json",
            description: "Horsepower vs MPG.",
            data: {
                values: [
                    {Horsepower: 130, Miles_per_Gallon: 18},
                    {Horsepower: 165, Miles_per_Gallon: 15},
                    {Horsepower: 95, Miles_per_Gallon: 24},
                ],
            },
            mark: "point",
            encoding: {
                x: {field: "Horsepower", type: "quantitative"},
                y: {field: "Miles_per_Gallon", type: "quantitative"},
            },
        };

        it("imports as a single point series with two linear axes", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.series).toHaveLength(1);
            expect(out.series[0]!.mark).toBe(ChartMarkKind.Point);
            expect(out.xAxis.scale).toBe(ChartScaleKind.Linear);
            expect(out.yAxis.scale).toBe(ChartScaleKind.Linear);
        });
    });

    describe("stacked bar with color split (adapted from stacked_bar_weather)", () => {
        // Adapted: removed timeUnit + aggregate (out of v1 scope); pre-aggregated rows.
        const spec = {
            $schema: "https://vega.github.io/schema/vega-lite/v6.json",
            data: {
                values: [
                    {month: "Jan", weather: "sun", count: 5},
                    {month: "Jan", weather: "rain", count: 12},
                    {month: "Jan", weather: "fog", count: 3},
                    {month: "Feb", weather: "sun", count: 7},
                    {month: "Feb", weather: "rain", count: 10},
                    {month: "Feb", weather: "fog", count: 4},
                ],
            },
            mark: "bar",
            encoding: {
                x: {field: "month", type: "ordinal"},
                y: {field: "count", type: "quantitative"},
                color: {
                    field: "weather",
                    type: "nominal",
                    scale: {
                        domain: ["sun", "fog", "rain"],
                        range: ["#e7ba52", "#c7c7c7", "#1f77b4"],
                    },
                },
            },
        };

        it("pivots color field into separate series in first-seen order", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.series.map(s => s.label)).toEqual(["sun", "rain", "fog"]);
        });

        it("applies scale.range colors by series index (sun=range[0], rain=range[1], fog=range[2])", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.series[0]!.style?.color).toBe("#e7ba52");
            expect(out.series[1]!.style?.color).toBe("#c7c7c7");
            expect(out.series[2]!.style?.color).toBe("#1f77b4");
        });

        it("auto-applies stack: zero to all bar series when a color split is present", () => {
            const out = importVegaLiteChart(spec as never);
            for (const s of out.series) {
                expect(s.stack).toBe(ChartStackMode.Zero);
            }
        });

        it("all series share x and bar mark; each gets its own pivoted y column", () => {
            const out = importVegaLiteChart(spec as never);
            const ys = new Set<string>();
            for (const s of out.series) {
                expect(s.mark).toBe(ChartMarkKind.Bar);
                expect(s.encoding.x).toBe("month");
                expect(s.encoding.y).toMatch(/^value\d+$/);
                ys.add(s.encoding.y);
            }
            // Each pivoted series gets a distinct y column.
            expect(ys.size).toBe(out.series.length);
        });

        it("pivots long-format rows into wide rows (one per x value)", () => {
            const out = importVegaLiteChart(spec as never);
            // Two distinct months → two pivoted rows.
            expect(out.data.rows).toHaveLength(2);
            // First row should have all three series values filled (5, 10, 3 sun/rain/fog for Jan).
            const jan = out.data.rows[0]!;
            expect(jan.month).toBe("Jan");
            expect(jan.value0).toBe(5);   // sun
            expect(jan.value1).toBe(12);  // rain
            expect(jan.value2).toBe(3);   // fog
        });
    });

    describe("normalized stacked bar (adapted)", () => {
        // Adapted: removed transform/calculate, pre-computed `gender`.
        const spec = {
            $schema: "https://vega.github.io/schema/vega-lite/v6.json",
            data: {
                values: [
                    {age: 20, gender: "Female", people: 100},
                    {age: 20, gender: "Male", people: 110},
                    {age: 30, gender: "Female", people: 90},
                    {age: 30, gender: "Male", people: 95},
                ],
            },
            mark: "bar",
            encoding: {
                y: {aggregate: undefined, field: "people", title: "population", stack: "normalize"},
                x: {field: "age"},
                color: {field: "gender", scale: {range: ["#675193", "#ca8861"]}},
            },
        };

        it("translates y.stack=\"normalize\" to ChartStackMode.Normalize", () => {
            const out = importVegaLiteChart(spec as never);
            for (const s of out.series) expect(s.stack).toBe(ChartStackMode.Normalize);
        });

        it("uses encoding title as axis label", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.yAxis.label).toBe("population");
        });
    });

    describe("interactive bar with selection (params)", () => {
        const spec = {
            $schema: "https://vega.github.io/schema/vega-lite/v6.json",
            description: "Hover highlight + click select",
            data: {
                values: [
                    {a: "A", b: 28}, {a: "B", b: 55}, {a: "C", b: 43},
                ],
            },
            params: [
                {name: "highlight", select: {type: "point", on: "pointerover"}},
                {name: "select", select: "point"},
            ],
            mark: {type: "bar", fill: "#4C78A8", stroke: "black"},
            encoding: {
                x: {field: "a", type: "ordinal"},
                y: {field: "b", type: "quantitative"},
            },
        };

        it("maps point-on-pointerover to a hover interaction", () => {
            const out = importVegaLiteChart(spec as never);
            const hover = out.interactions?.find(i => i.handler === "highlight");
            expect(hover).toEqual({
                target: ChartInteractionTarget.Mark,
                event: ChartInteractionEvent.Hover,
                handler: "highlight",
            });
        });

        it("maps shorthand select: \"point\" to a click interaction", () => {
            const out = importVegaLiteChart(spec as never);
            const click = out.interactions?.find(i => i.handler === "select");
            expect(click).toEqual({
                target: ChartInteractionTarget.Mark,
                event: ChartInteractionEvent.Click,
                handler: "select",
            });
        });

        it("uses mark.fill as series style color", () => {
            const out = importVegaLiteChart(spec as never);
            expect(out.series[0]!.style?.color).toBe("#4C78A8");
        });
    });

    describe("unsupported features throw clear errors", () => {
        it("data.url → throw", () => {
            const spec = {
                data: {url: "data/stocks.csv"},
                mark: "line",
                encoding: {x: {field: "date", type: "temporal"}, y: {field: "price", type: "quantitative"}},
            };
            expect(() => importVegaLiteChart(spec as never)).toThrow(/data\.url/);
        });

        it("aggregate → throw", () => {
            const spec = {
                data: {values: [{a: "A", b: 1}]},
                mark: "bar",
                encoding: {x: {field: "a", type: "ordinal"}, y: {field: "b", aggregate: "count", type: "quantitative"}},
            };
            expect(() => importVegaLiteChart(spec as never)).toThrow(/aggregate/);
        });

        it("timeUnit → throw", () => {
            const spec = {
                data: {values: [{date: "2026-01-01", v: 1}]},
                mark: "bar",
                encoding: {x: {field: "date", timeUnit: "month", type: "ordinal"}, y: {field: "v", type: "quantitative"}},
            };
            expect(() => importVegaLiteChart(spec as never)).toThrow(/timeUnit/);
        });

        it("transform → throw", () => {
            const spec = {
                data: {values: [{a: 1}]},
                transform: [{filter: "datum.a > 0"}],
                mark: "bar",
                encoding: {x: {field: "a", type: "quantitative"}, y: {field: "a", type: "quantitative"}},
            };
            expect(() => importVegaLiteChart(spec as never)).toThrow(/transforms/);
        });

        it("layer composition → throw", () => {
            const spec = {
                data: {values: [{a: 1}]},
                layer: [],
                mark: "bar",
                encoding: {x: {field: "a"}, y: {field: "a"}},
            };
            expect(() => importVegaLiteChart(spec as never)).toThrow(/layer/);
        });

        it("missing encoding field → throw", () => {
            const spec = {
                data: {values: [{a: 1}]},
                mark: "bar",
                encoding: {x: {field: "a", type: "quantitative"}, y: {type: "quantitative"}},
            };
            expect(() => importVegaLiteChart(spec as never)).toThrow(/encoding\.y\.field/);
        });
    });
});
