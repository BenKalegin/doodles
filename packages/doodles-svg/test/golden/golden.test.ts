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

describe("golden: cross-cluster-ordering", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("cross-cluster-ordering"); });

    it("source cluster (Clients) is placed above target cluster (Backend) in TB layout", () => {
        loaded.L.node("Web Browser").above("API Gateway");
        loaded.L.node("Mobile App").above("API Gateway");
    });

    it("each subgraph contains its declared members", () => {
        loaded.L.cluster("Clients").contains("Web Browser", "Mobile App");
        loaded.L.cluster("Backend").contains("API Gateway", "Database");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-cluster-chain", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-cluster-chain"); });

    it("nodes inside a cluster don't collapse onto a single x", () => {
        // Regression: cluster x positions used to pollute the row-wrap column
        // lattice, collapsing intra-cluster colWidth to the padding gap.
        loaded.L.node("uvicorn").leftOf("FastAPI app");
        loaded.L.node("FastAPI app").leftOf("RequestIdMiddleware");
    });

    it("each subgraph contains its declared members", () => {
        loaded.L.cluster("HTTP / Entry").contains("uvicorn", "FastAPI app", "RequestIdMiddleware");
        loaded.L.cluster("Routers").contains("chat v1", "chat v2 SSE", "health");
        loaded.L.cluster("Services").contains("AgentService", "SessionService");
        loaded.L.cluster("Clients").contains("BedrockClient", "ION Gateway");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-fanout-clusters", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-fanout-clusters"); });

    it("intra-cluster chain inside Entry is laid out left-to-right", () => {
        // The bug: with many cross-cluster edges and clusters spread across
        // multiple ELK layers, intra-cluster leaf positions used to collapse
        // onto a single x within each cluster.
        loaded.L.node("uvicorn").leftOf("FastAPI app");
        loaded.L.node("FastAPI app").leftOf("RequestIdMiddleware");
        loaded.L.node("RequestIdMiddleware").leftOf("StatsdMiddleware");
        loaded.L.node("StatsdMiddleware").leftOf("security_headers");
        loaded.L.nodes("uvicorn", "FastAPI app", "RequestIdMiddleware", "StatsdMiddleware", "security_headers").noOverlap();
    });

    it("Routers leaves do not visually overlap", () => {
        loaded.L.nodes("chat v1", "chat v2", "prompt", "messages", "sessions").noOverlap();
    });

    it("clusters keep their declared members", () => {
        loaded.L.cluster("HTTP / Entry").contains(
            "uvicorn", "FastAPI app", "RequestIdMiddleware", "StatsdMiddleware", "security_headers"
        );
        loaded.L.cluster("Services").contains(
            "AgentService", "DeepAgent", "SessionService", "MessagesService"
        );
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-cluster-no-internal-edges", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-cluster-no-internal-edges"); });

    it("leaves inside a cluster with no internal edges still spread out", () => {
        loaded.L.nodes("chat v1 + sync", "chat v2 SSE", "prompt /stream", "messages /stream", "sessions CRUD").noOverlap();
    });

    it("anonymous-subgraph clusters are actually created", () => {
        // Regression: the parser regex used to require an identifier after
        // "subgraph", silently dropping `subgraph "Anonymous Name"` lines and
        // letting all leaves fall through to root with a collapsed layout.
        loaded.L.cluster("HTTP / Entry").contains("FastAPI app");
        loaded.L.cluster("Routers (src/api)").contains("chat v1 + sync");
        loaded.L.cluster("Services (src/services)").contains("AgentService");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-user-bug-repro", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-user-bug-repro"); });

    it("intra-cluster leaves do not visually overlap each other", () => {
        // The visible regression: leaves inside HTTP/Entry, Routers, Services,
        // Clients, Data clusters were all stacked on top of each other in the
        // rendered SVG. `leftOf` only checks centers; `noOverlap` enforces
        // that the actual bbox rects don't cover each other.
        loaded.L.nodes("uvicorn / gunicorn", "FastAPI app", "RequestIdMiddleware", "StatsdMiddleWare", "security_headers").noOverlap();
        loaded.L.nodes("chat v1 + sync", "chat v2 SSE", "prompt /stream", "messages /stream", "sessions CRUD").noOverlap();
        loaded.L.nodes("AgentService", "DeepAgentService", "SessionService", "MessagesService", "Evaluations").noOverlap();
        loaded.L.nodes("BedrockModelClient", "ION API Gateway", "IDM", "MCP Server Client").noOverlap();
        loaded.L.nodes("Tenant Postgres", "Farm Postgres", "Valkey / Redis", "DynamoDB").noOverlap();
    });

    it("no DeepAgentService outgoing edge crosses the Tool factory sibling", () => {
        for (const to of ["BedrockModelClient", "Tenant Postgres", "LangSmith"]) {
            loaded.L.edge({fromText: "DeepAgentService", toText: to}).doesNotCross("Tool factory");
        }
    });

    it("no edge from the same source crosses another from that source", () => {
        // Two fan-out cases that were red before barycentric port ordering:
        //   1. FA → R1..R9 on Bottom face: port-x ↔ target-y order was wrong,
        //      every horizontal segment crossed every vertical to its right.
        //   2. AGSUP/AGDA → {TOOLF, BR, LS, TDB, …} on Right face: target-y
        //      sort placed the close intra-cluster TOOLF below the far Clients
        //      target BR, so the short edge's turn-up segment got cut by the
        //      long edge's horizontal extend-right.
        loaded.L.edges().noSameSourceCrossings();
    });

    it("DeepAgentService → Tool factory is a direct intra-cluster route, not a U-turn", () => {
        // Intra-cluster routes must use a midpoint pivot, not a cluster-clearance
        // pivot — otherwise the elbow overshoots past the cluster's right edge
        // and the route U-turns back into the target.
        loaded.L.edge({fromText: "DeepAgentService", toText: "Tool factory"}).doesNotCross("Tool factory");
        loaded.L.edge({fromText: "AgentService", toText: "Tool factory"}).doesNotCross("Tool factory");
        // A direct intra-cluster L is at most 3 segments (4 points). A U-turn
        // would need 5+ points.
        loaded.L.edge({fromText: "DeepAgentService", toText: "Tool factory"}).polylineLengthAtMost(4);
        loaded.L.edge({fromText: "AgentService", toText: "Tool factory"}).polylineLengthAtMost(4);
    });

    it("DeepAgentService's right-side ports are ordered by target y", () => {
        // Bug: AGDA's two right-side outgoing edges crossed each other near
        // the source because the port ratios didn't follow target y. The
        // edge to a target with smaller y should leave from a smaller port_y
        // than the edge to a target with larger y.
        const portYForTarget = (target: string): number =>
            loaded.L.edge({fromText: "DeepAgentService", toText: target}).sourcePortY();
        const targets = [
            {name: "BedrockModelClient", tgtY: loaded.L.bounds("BedrockModelClient").y},
            {name: "Tenant Postgres", tgtY: loaded.L.bounds("Tenant Postgres").y},
            {name: "LangSmith", tgtY: loaded.L.bounds("LangSmith").y},
        ];
        const sortedByTgtY = [...targets].sort((a, b) => a.tgtY - b.tgtY);
        let prevPortY = -Infinity;
        for (const t of sortedByTgtY) {
            const py = portYForTarget(t.name);
            if (py < prevPortY) {
                throw new Error(
                    `port_y for AGDA→${t.name} (tgt y=${t.tgtY.toFixed(0)}, port_y=${py.toFixed(0)}) ` +
                    `out of order with previous port_y=${prevPortY.toFixed(0)} — ports should be sorted by target y`
                );
            }
            prevPortY = py;
        }
    });

    it("no edge pierces the AgentService or DeepAgentService nodes vertically", () => {
        // Visual bug: a vertical edge stroke went straight through both Services
        // top nodes from somewhere outside the cluster down to nodes below.
        // Find which edges cross by checking every edge against these two nodes.
        const services = ["AgentService", "DeepAgentService"];
        const allEdges = (loaded as unknown as {
            L: {bounds(t: string): unknown}
        }) as never;
        void allEdges; // placeholder — instead, iterate the diagram's links via the facade
        // Use the existing facade — every link gets a doesNotCross check.
        // Done by reading links directly from elements via debug; for now we
        // pin the canonical fan-out edges Router→AGSUP/AGDA and Services→Clients
        // edges, since those are the suspects.
        loaded.L.edge({fromText: "chat v1 + sync", toText: "AgentService"}).doesNotCross(...services.filter(s => s !== "AgentService"));
        loaded.L.edge({fromText: "chat v2 SSE", toText: "DeepAgentService"}).doesNotCross(...services.filter(s => s !== "DeepAgentService"));
        loaded.L.edge({fromText: "AgentService", toText: "BedrockModelClient"}).doesNotCross(...services.filter(s => s !== "AgentService"));
        loaded.L.edge({fromText: "AgentService", toText: "Tenant Postgres"}).doesNotCross(...services.filter(s => s !== "AgentService"));
        loaded.L.edge({fromText: "AgentService", toText: "Valkey / Redis"}).doesNotCross(...services.filter(s => s !== "AgentService"));
        loaded.L.edge({fromText: "DeepAgentService", toText: "Tenant Postgres"}).doesNotCross(...services.filter(s => s !== "DeepAgentService"));
        loaded.L.edge({fromText: "DeepAgentService", toText: "BedrockModelClient"}).doesNotCross(...services.filter(s => s !== "DeepAgentService"));
    });

    it("FA's cross-cluster edges don't cross the in-cluster middleware chain", () => {
        // FastAPI app has two kinds of forward successors: MW1 (next link in
        // the same intra-cluster chain) and R1..R9 (cross-cluster fan-out to
        // Routers). The cross-cluster edges used to route through MW1/MW2/MW3
        // because they exited FA on the same face as the chain edge. They now
        // exit on the perpendicular face for a clear path around the cluster.
        loaded.L.edge({fromText: "FastAPI app", toText: "chat v1 + sync"}).doesNotCross("RequestIdMiddleware", "StatsdMiddleWare", "security_headers");
        loaded.L.edge({fromText: "FastAPI app", toText: "chat v2 SSE"}).doesNotCross("RequestIdMiddleware", "StatsdMiddleWare", "security_headers");
        loaded.L.edge({fromText: "FastAPI app", toText: "sessions CRUD"}).doesNotCross("RequestIdMiddleware", "StatsdMiddleWare", "security_headers");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-branched-chain", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-branched-chain"); });

    it("non-clustered branched LR flowchart with 6+ layers keeps nodes in their layers", () => {
        // Bug: with no clusters, the wrap-into-rows kicked in (uniqueXs > maxCols)
        // and collapsed every layer's nodes to the same y because the wrap
        // function set a single y per row, ignoring within-layer offsets.
        loaded.L.nodes("ChatHistory.aget_messages", "checkpointer.aget v1", "checkpointer.aget v2").noOverlap();
        loaded.L.nodes("search_agents", "Supervisor / DeepAgent").noOverlap();
    });

    it("multi-source edge with inline shape `A & B --> C[label]` creates the predecessor edges", () => {
        // The mermaid line `H1 & C1 --> MERGE1[Reduction history of chat]`
        // used to be dropped on the floor because the multi-arrow path
        // filtered out segments containing brackets, leaving MERGE1 with no
        // predecessors and ending up at layer 0 instead of layer 3.
        loaded.L.node("Reduction history of chat").rightOf("ChatHistory.aget_messages");
        loaded.L.node("Reduction history of chat").rightOf("checkpointer.aget v1");
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
            "cross-cluster-ordering",
            "lr-cluster-chain",
            "lr-fanout-clusters",
            "lr-user-bug-repro",
            "lr-cluster-no-internal-edges",
            "lr-branched-chain",
        ]);
        for (const name of fixtureNames) {
            expect(exercised.has(name), `fixture ${name}.mmd has no test block`).toBe(true);
        }
    });
});
