import {readFileSync, readdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, it, beforeAll, expect} from "vitest";
import {ElementType, PortAlignment} from "@benkalegin/doodles-core";
import {layoutFor, type LayoutFacade} from "@benkalegin/doodles-layout";
import {importMermaidFlowchartWithLayout} from "@benkalegin/doodles-mermaid";
import {createDoodleForType} from "../fixtures.js";
import {renderSvg, routeEdges, defaultLightTheme} from "../../src/index.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

const fixtureNames = readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith(".mmd"))
    .map(f => f.replace(/\.mmd$/, ""));

/**
 * One describe block per fixture. Each fixture has:
 *   - relational layout assertions (engine-agnostic; describe what a human
 *     would expect to see)
 *   - an SVG snapshot (commit-as-golden; any drift surfaces in a PR diff)
 *
 * Adding a new fixture: drop a .mmd into ./fixtures/ and add a describe
 * block here with the relational expectations for that diagram.
 */

interface Loaded {
    L: LayoutFacade;
    svg: string;
}

async function loadFixture(name: string): Promise<Loaded> {
    const source = readFileSync(join(FIXTURES_DIR, `${name}.mmd`), "utf8");
    const base = createDoodleForType(ElementType.FlowchartDiagram, `golden-${name}`);
    const diagram = await importMermaidFlowchartWithLayout(base, source);
    const routes = routeEdges(diagram as never, defaultLightTheme);
    const L = layoutFor(diagram as never, {routes});
    const svg = renderSvg(diagram as never);
    return {L, svg};
}

describe("golden: simple-flowchart", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("simple-flowchart"); });

    it("decision diamond branches both reach the same terminator", () => {
        loaded.L.nodes("Start", "Approved?", "Done").orderedTopToBottom();
        loaded.L.node("Process Order").below("Approved?");
        loaded.L.node("Send Rejection").below("Approved?");
        loaded.L.node("Done").below("Process Order", "Send Rejection");
    });

    it("edge labels rendered without quotes", () => {
        loaded.L.edge({fromText: "Approved?", toText: "Process Order"}).hasLabel("yes");
        loaded.L.edge({fromText: "Approved?", toText: "Send Rejection"}).hasLabel("no");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: chained-arrows", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("chained-arrows"); });

    it("five-node chain stacks vertically with all edges", () => {
        loaded.L.nodes("Upload", "Parse", "Chunk", "Embed", "Store").orderedTopToBottom();
        loaded.L.nodes("Upload", "Parse", "Chunk", "Embed", "Store").sameColumn();
        loaded.L.edges().count(4);
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: erp-ui-surfaces", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("erp-ui-surfaces"); });

    it("three-branch decision keeps left-to-right source order", () => {
        loaded.L.nodes("Operating screens", "Middle band", "Long tail").orderedLeftToRight();
    });

    it("descendant leaves preserve the parent column order", () => {
        loaded.L.nodes(
            "Hand-crafted, dense, fast",
            "Templated generation",
            "Generated on demand"
        ).orderedLeftToRight();
    });

    it("edge labels stripped of surrounding quotes", () => {
        loaded.L.edge({fromText: "Usage frequency", toText: "Operating screens"}).hasLabel("Daily, hours per user");
        loaded.L.edge({fromText: "Usage frequency", toText: "Middle band"}).hasLabel("Weekly, few users");
        loaded.L.edge({fromText: "Usage frequency", toText: "Long tail"}).hasLabel("Rare, edge-case");
    });

    // ── Render-quality regressions (currently red — track filigree/doodles fixes) ──

    it("no edge passes through a non-endpoint node", () => {
        loaded.L.edges().noNodeIntersection();
    });

    it("no two edge labels overlap", () => {
        loaded.L.edges().noLabelOverlap();
    });

    it("ancestor chain is centered over the three children", () => {
        const branches = ["Operating screens", "Middle band", "Long tail"];
        loaded.L.node("All ERP UI surfaces").centeredOver(branches);
        loaded.L.node("Usage frequency").centeredOver(branches);
    });

    it("all three diamond branches leave from the bottom face", () => {
        loaded.L.node("Usage frequency").outgoingFromSide(PortAlignment.Bottom);
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: rag-pipelines", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("rag-pipelines"); });

    it("Ingestion chain stacks vertically", () => {
        loaded.L.nodes(
            "Document Upload", "Document Parser", "Text Chunker", "Embedding", "Vector Store - docs"
        ).orderedTopToBottom();
    });

    it("Query chain stacks vertically", () => {
        loaded.L.nodes(
            "User Query", "Query Condenser", "Preflight Analyzer", "Plan Generator", "DurableAgent", "Vector Store - queries"
        ).orderedTopToBottom();
    });

    it("wider-text node aligns center with its narrower chain neighbors", () => {
        loaded.L.node("Query Condenser").centeredHorizontallyWith("Preflight Analyzer");
        loaded.L.node("Preflight Analyzer").centeredHorizontallyWith("Plan Generator");
    });

    it("each subgraph contains its declared members", () => {
        loaded.L.cluster("Ingestion Pipeline").contains(
            "Document Upload", "Document Parser", "Text Chunker", "Embedding", "Vector Store - docs"
        );
        loaded.L.cluster("Query Pipeline").contains(
            "User Query", "Query Condenser", "Preflight Analyzer", "Plan Generator", "DurableAgent", "Vector Store - queries"
        );
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: fixture inventory", () => {
    it("every .mmd fixture is exercised by a describe block", () => {
        const exercised = new Set([
            "simple-flowchart",
            "chained-arrows",
            "erp-ui-surfaces",
            "rag-pipelines",
        ]);
        for (const name of fixtureNames) {
            expect(exercised.has(name), `fixture ${name}.mmd has no test block`).toBe(true);
        }
    });
});
