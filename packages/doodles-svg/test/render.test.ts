import {describe, it, expect} from "vitest";
import {ElementType} from "@benkalegin/doodles-core";
import {createDoodleForType} from "./fixtures.js";
import {importMermaidFlowchartDiagram} from "@benkalegin/doodles-mermaid";
import {renderSvg} from "../src/index.js";

describe("renderSvg", () => {
    it("emits a single <svg> root with viewBox sized to the diagram", async () => {
        const base = createDoodleForType(ElementType.FlowchartDiagram, "t");
        const d = await importMermaidFlowchartDiagram(base, "flowchart TB\nA[Alpha] --> B[Beta]");
        const svg = renderSvg(d as any);
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg.endsWith("</svg>")).toBe(true);
        expect(svg).toMatch(/viewBox="-?\d+ -?\d+ \d+ \d+"/);
    });

    it("renders a rect for each flowchart Process node", async () => {
        const base = createDoodleForType(ElementType.FlowchartDiagram, "t");
        const d = await importMermaidFlowchartDiagram(base, "flowchart TB\nA[Alpha] --> B[Beta]");
        const svg = renderSvg(d as any);
        const rects = (svg.match(/<rect\b/g) ?? []).length;
        // 2 nodes; clusters absent
        expect(rects).toBe(2);
    });

    it("renders a diamond polygon for Decision nodes", async () => {
        const base = createDoodleForType(ElementType.FlowchartDiagram, "t");
        const d = await importMermaidFlowchartDiagram(base, "flowchart TB\nA --> B{Choose}\nB --> C");
        const svg = renderSvg(d as any);
        expect(svg).toMatch(/<polygon\b/);
    });

    it("emits an arrow marker definition and uses it on edges", async () => {
        const base = createDoodleForType(ElementType.FlowchartDiagram, "t");
        const d = await importMermaidFlowchartDiagram(base, "flowchart TB\nA --> B --> C");
        const svg = renderSvg(d as any);
        expect(svg).toMatch(/<marker id="arrow"/);
        expect(svg).toMatch(/marker-end="url\(#arrow\)"/);
    });

    it("emits a path per edge", async () => {
        const base = createDoodleForType(ElementType.FlowchartDiagram, "t");
        const d = await importMermaidFlowchartDiagram(base, "flowchart TB\nA --> B\nB --> C\nA --> C");
        const svg = renderSvg(d as any);
        const paths = (svg.match(/<path\b/g) ?? []).length;
        // 3 edges + 1 path inside the arrow marker = 4
        expect(paths).toBe(4);
    });

    it("renders subgraph as a rect with label", async () => {
        const base = createDoodleForType(ElementType.FlowchartDiagram, "t");
        const d = await importMermaidFlowchartDiagram(base, `flowchart TB
            subgraph Ingestion["Ingestion Pipeline"]
                A[Upload] --> B[Parse]
            end`);
        const svg = renderSvg(d as any);
        expect(svg).toContain("Ingestion Pipeline");
    });

    it("escapes XML special characters in labels", async () => {
        const base = createDoodleForType(ElementType.FlowchartDiagram, "t");
        const d = await importMermaidFlowchartDiagram(base, 'flowchart TB\nA["a & b < c"] --> B');
        const svg = renderSvg(d as any);
        expect(svg).toContain("a &amp; b &lt; c");
        expect(svg).not.toContain("a & b < c");
    });

    it("renders edge labels", async () => {
        const base = createDoodleForType(ElementType.FlowchartDiagram, "t");
        const d = await importMermaidFlowchartDiagram(base, 'flowchart TB\nA -->|hello| B');
        const svg = renderSvg(d as any);
        expect(svg).toContain("hello");
    });
});
