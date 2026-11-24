import {describe, it, expect} from "vitest";
import {type Diagram, defaultDiagramDisplay, ElementType} from "@benkalegin/doodles-core";
import {parseMermaidLayoutHints, importMermaidFlowchartWithLayout} from "../src/index.js";

function base(): Diagram {
    return {id: "t", type: ElementType.FlowchartDiagram, display: defaultDiagramDisplay};
}

interface StructureLike {
    elements: {[id: string]: {id: string; type: ElementType; sourceId?: string}};
    nodes: {[id: string]: {bounds: {x: number; y: number; width: number; height: number}}};
    layoutFlow?: readonly (readonly string[])[];
}

/** Internal element id for a node by its Mermaid source id, or the cluster id itself. */
function entityId(diagram: StructureLike, mermaidId: string): string {
    for (const el of Object.values(diagram.elements)) {
        if (el.type === ElementType.ClassNode && el.sourceId === mermaidId) return el.id;
    }
    // Clusters keep the Mermaid subgraph id as their element id.
    if (diagram.elements[mermaidId]) return mermaidId;
    throw new Error(`no entity for mermaid id ${mermaidId}`);
}

function leftEdge(diagram: StructureLike, mermaidId: string): number {
    return diagram.nodes[entityId(diagram, mermaidId)]!.bounds.x;
}

// A node → cluster-member back-edge. In LR the real edge G1 --> A ranks the
// GRP cluster before A, so the natural layout places GRP left of A. The author
// wants the opposite spine (A then GRP), which only an explicit flow can force.
const GRAPH = `flowchart LR
    subgraph GRP[Group]
        G1[One]
    end
    A[Alpha]
    G1 --> A`;

const withFlow = (spine: string): string => `---\ndoodles:\n  flow: ${spine}\n---\n${GRAPH}`;

describe("parseMermaidLayoutHints — flow", () => {
    it("parses a single `flow:` spine from frontmatter into ordered ids", () => {
        const hints = parseMermaidLayoutHints(withFlow("A > GRP"));
        expect(hints.flow).toEqual([["A", "GRP"]]);
    });

    it("has no flow when the frontmatter omits it", () => {
        const hints = parseMermaidLayoutHints(GRAPH);
        expect(hints.flow).toBeUndefined();
    });
});

describe("flow spine ordering (end-to-end import + layout)", () => {
    it("baseline (no flow): the GRP cluster is ranked before A", async () => {
        const d = (await importMermaidFlowchartWithLayout(base(), GRAPH)) as unknown as StructureLike;
        expect(leftEdge(d, "GRP")).toBeLessThan(leftEdge(d, "A"));
    });

    it("flow `A > GRP` inverts the rank so A is placed before the GRP cluster", async () => {
        const d = (await importMermaidFlowchartWithLayout(base(), withFlow("A > GRP"))) as unknown as StructureLike;
        expect(leftEdge(d, "A")).toBeLessThan(leftEdge(d, "GRP"));
    });

    it("resolves the flow spine to internal element ids on diagram.layoutFlow", async () => {
        const d = (await importMermaidFlowchartWithLayout(base(), withFlow("A > GRP"))) as unknown as StructureLike;
        expect(d.layoutFlow).toEqual([[entityId(d, "A"), "GRP"]]);
    });
});
