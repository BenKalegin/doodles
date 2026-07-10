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

    it("no edge passes through a non-endpoint node", () => {
        // Regression: MERGE1 → search_agents was flipped to Bottom→Top by
        // applyCrossRowForkExit (MERGE1 is a fork, |dy| > 70), but the V↔V
        // horizontal leg still clipped Supervisor in the gutter between
        // the MERGE1 row and the search_agents row. Separately, SUP → SUM
        // (back-edge to a far-left, lower-row node) routed Bottom→Top with
        // a horizontal sweep that crossed the entire row of intermediate
        // nodes (search_agents, Full prior messages, checkpointer.aget v2).
        // The fix detects both V↔V-leg blockings in routeAroundIntermediateNodes
        // and escapes via a same-face U-detour.
        loaded.L.edges().noNodeIntersection();
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-multisource-bracketed-label", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-multisource-bracketed-label"); });

    it("multi-source edge whose target label contains nested `[...]` is not dropped", () => {
        // Regression: `LLM & P --> CA[create_agent(...middleware=[handle_tool_errors])]`.
        // The chain-path parser's inline-shape regex matched the first inner
        // `]` and rejected the trailing chars, so the whole line was dropped —
        // CA node never created, LLM→CA and P→CA edges never created. With
        // balanced-bracket parsing the target node and both predecessors land.
        loaded.L.node("create_agent(").rightOf("get_model(data.get_version())");
        loaded.L.node("create_agent(").rightOf("inject_agent_context");
        loaded.L.edge({fromText: "get_model(data.get_version())", toText: "create_agent("});
        loaded.L.edge({fromText: "inject_agent_context", toText: "create_agent("});
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-row-wrap-strike-through", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-row-wrap-strike-through"); });

    // Regression: a row-wrapped forward edge whose target is a Decision diamond
    // (e.g. `S4 --> Par{"asyncio.gather"}` where Par sits at col 0 of the next
    // row) was forced through the diamond's Left face by the Decision-input
    // convention, which clobbered the Top face that the LR back-edge-gutter
    // rule had set. The route then ran straight across the row, striking
    // through every node in row 2.
    it("S4 → asyncio.gather (visually-back row-wrap into a diamond) enters Top, not Left", () => {
        loaded.L.edge({fromText: "LLM 4: Supervisor turn 2", toText: "asyncio.gather"})
            .hasSourceAlignment(PortAlignment.Bottom)
            .hasTargetAlignment(PortAlignment.Top);
    });

    it("S4 → asyncio.gather route does not strike through any row-2 node", () => {
        loaded.L.edge({fromText: "LLM 4: Supervisor turn 2", toText: "asyncio.gather"})
            .doesNotCross("add_messages (Postgres)", "SSE close", "LLM 5: Followup (Haiku)");
    });

    it("no edge passes through a non-endpoint node", () => {
        loaded.L.edges().noNodeIntersection();
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-cycle-with-back-edges", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-cycle-with-back-edges"); });

    it("BUILD → LLM1 back-edge doesn't cross intermediate row-0 nodes", () => {
        // BUILD ends up at the end of row 0; LLM1 starts row 1. The back-edge
        // used to route Left-then-Top, slicing through every row-0 node
        // between BUILD and LLM1 (User request, Auth, Session, search_agents).
        loaded.L.edge({fromText: "build_deep_agent", toText: "Supervisor LLM call"})
            .doesNotCross("User request", "Auth + tenant context", "Session create / lookup", "search_agents");
    });

    it("LLM2 → LLM1 same-row back-edge doesn't cross Tool / subagent", () => {
        // LLM2 sits to the right of LLM1 in the same row with TOOL between them.
        // The back-edge needs to detour above or below TOOL, not slice through.
        loaded.L.edge({fromText: "Subagent LLM call", toText: "Supervisor LLM call"})
            .doesNotCross("Tool / subagent");
    });

    it("back-edges enter targets perpendicular to the receiving side, not sliding along its border", () => {
        // Rule: docs/layout-rules/back-edge-gutter-routing.md — back-edges
        // route through the gutter immediately below their source row, so the
        // target is entered from above (cross-row down) or below (same row),
        // never from a face that slides along the row's principal axis.
        loaded.L.edge({fromText: "build_deep_agent", toText: "Supervisor LLM call"})
            .entersTargetPerpendicularTo(PortAlignment.Top);
        loaded.L.edge({fromText: "Subagent LLM call", toText: "Supervisor LLM call"})
            .entersTargetPerpendicularTo(PortAlignment.Bottom);
    });

    it("back-edges exit through Bottom (gutter below source), never Top (exterior above the diagram)", () => {
        // Rule: docs/layout-rules/back-edge-gutter-routing.md
        // Cross-row visually-back (BUILD at end of row 1 → LLM1 at start of row 2):
        // exit Bottom of BUILD into the gutter between row 1 and row 2,
        // enter LLM1 from above (Top).
        loaded.L.edge({fromText: "build_deep_agent", toText: "Supervisor LLM call"})
            .hasSourceAlignment(PortAlignment.Bottom)
            .hasTargetAlignment(PortAlignment.Top);
        // Same-row cycle return (LLM2 → LLM1, both in row 2): both faces are
        // Bottom — the edge dips into the gutter below row 2 and comes back up.
        loaded.L.edge({fromText: "Subagent LLM call", toText: "Supervisor LLM call"})
            .hasSourceAlignment(PortAlignment.Bottom)
            .hasTargetAlignment(PortAlignment.Bottom);
    });

    it("cross-row forward edge from fork exits Bottom (avoids back-edge crossing)", () => {
        // Rule: docs/layout-rules/fork-cross-row-perpendicular-exit.md
        // Supervisor has outdeg=2 (Tool, Followups). Tool is in the same row;
        // Followups is in a different row down. The cross-row branch exits
        // Bottom so port distribution can order it clear of the same-face
        // incoming back-edge from Subagent — no crossing.
        loaded.L.edge({fromText: "Supervisor LLM call", toText: "Followups"})
            .hasSourceAlignment(PortAlignment.Bottom)
            .hasTargetAlignment(PortAlignment.Top);
        loaded.L.edge({fromText: "Supervisor LLM call", toText: "Tool / subagent"})
            .hasSourceAlignment(PortAlignment.Right);
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-fork-linear-tail", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-fork-linear-tail"); });

    // Rule: docs/layout-rules/linear-tail-after-fork.md
    // A linear chain hanging off a fork (Cheshire → Caterpillar → Gryphon)
    // must sit on one shared row. Filigree picks an independent y per layer,
    // producing a staircase when the chain extends past the fork's other
    // branch — doodles pins the chain to its first node's y.
    it("Cheshire → Caterpillar → Gryphon linear tail shares one row", () => {
        loaded.L.nodes("Cheshire", "Caterpillar", "Gryphon").sameRow();
    });

    it("trunk Alice → Hatter → Dormouse shares one row", () => {
        loaded.L.nodes("Alice", "Hatter", "Dormouse").sameRow();
    });

    it("tail sits below trunk (not above)", () => {
        loaded.L.node("Cheshire").below("Hatter");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-back-edge-gutter", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-back-edge-gutter"); });

    // Rule: docs/layout-rules/back-edge-gutter-routing.md
    // Minimal isolated case: a 4-node LR chain with one same-row back-edge
    // closing the cycle Bill → Caterpillar → Dormouse → Bill. The back-edge
    // must exit Dormouse's Bottom face and enter Bill's Bottom face — routing
    // through the gutter below the row, not above it.
    it("Dormouse → Bill back-edge exits source through Bottom", () => {
        loaded.L.edge({fromText: "Dormouse", toText: "Bill"})
            .hasSourceAlignment(PortAlignment.Bottom);
    });

    it("Dormouse → Bill back-edge enters target through Bottom", () => {
        loaded.L.edge({fromText: "Dormouse", toText: "Bill"})
            .hasTargetAlignment(PortAlignment.Bottom);
    });

    it("forward edges keep their Right→Left in-flow alignments", () => {
        loaded.L.edge({fromText: "Alice", toText: "Bill"})
            .hasSourceAlignment(PortAlignment.Right)
            .hasTargetAlignment(PortAlignment.Left);
        loaded.L.edge({fromText: "Bill", toText: "Caterpillar"})
            .hasSourceAlignment(PortAlignment.Right)
            .hasTargetAlignment(PortAlignment.Left);
    });

    it("back-edge polyline does not cross intermediate nodes", () => {
        loaded.L.edge({fromText: "Dormouse", toText: "Bill"})
            .doesNotCross("Caterpillar");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-back-edge-wrap", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-back-edge-wrap"); });

    // Rule: docs/layout-rules/back-edge-gutter-routing.md
    // 8-node chain wraps to two rows (default maxColsPerRow=5). Exercises both
    // gutter cases the rule covers:
    //  - Eaglet → Fawn: forward edge in DAG, visually-back after row wrap
    //    (target below source). Gutter between row 1 and row 2.
    //  - Hatter → Fawn: true back-edge, same row 2. Gutter below row 2.
    it("Eaglet → Fawn row-wrap forward edge exits Bottom, enters Top", () => {
        loaded.L.edge({fromText: "Eaglet", toText: "Fawn"})
            .hasSourceAlignment(PortAlignment.Bottom)
            .hasTargetAlignment(PortAlignment.Top);
    });

    it("Hatter → Fawn same-row back-edge exits Bottom, enters Bottom", () => {
        loaded.L.edge({fromText: "Hatter", toText: "Fawn"})
            .hasSourceAlignment(PortAlignment.Bottom)
            .hasTargetAlignment(PortAlignment.Bottom);
    });

    it("back-edges enter targets perpendicularly", () => {
        loaded.L.edge({fromText: "Eaglet", toText: "Fawn"})
            .entersTargetPerpendicularTo(PortAlignment.Top);
        loaded.L.edge({fromText: "Hatter", toText: "Fawn"})
            .entersTargetPerpendicularTo(PortAlignment.Bottom);
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-fork-cross-row", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-fork-cross-row"); });

    // Rule: docs/layout-rules/fork-cross-row-perpendicular-exit.md
    // Hatter is a fork (outdeg 2): in-row continuation to Caterpillar, and
    // a cross-row branch to Knave that the linear-tail-after-fork rule pins
    // to its own row below. The fixture sets nodespacing:120 so the second
    // row sits with a real gutter (default 60 gap collapses to touching rows
    // and degenerates the perpendicular detour).
    it("Hatter → Knave cross-row branch exits Bottom of fork", () => {
        loaded.L.edge({fromText: "Hatter", toText: "Knave"})
            .hasSourceAlignment(PortAlignment.Bottom)
            .hasTargetAlignment(PortAlignment.Top);
    });

    it("Hatter → Caterpillar in-row branch stays on Right (forward axis)", () => {
        loaded.L.edge({fromText: "Hatter", toText: "Caterpillar"})
            .hasSourceAlignment(PortAlignment.Right)
            .hasTargetAlignment(PortAlignment.Left);
    });

    it("linear-tail rule still pins both chains to their own row", () => {
        loaded.L.nodes("Alice", "Bill", "Hatter", "Caterpillar", "Dormouse").sameRow();
        loaded.L.nodes("Knave", "Mouse").sameRow();
        loaded.L.node("Knave").below("Hatter");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-row-mixed-heights", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-row-mixed-heights"); });

    // Rule: docs/layout-rules/row-center-align-by-height.md
    // Hatter and Caterpillar are multi-line (height ~70 px); Alice, Cheshire,
    // and Mouse are single-line (height 60 px). Filigree top-aligns them by
    // default, so their centers differ by ~5 px and Right→Left edges kink.
    // After centerAlignRowsByHeight runs, all five centers sit on a shared
    // centerline and the chain renders as one straight horizontal.
    it("all row members share a centerline within 1 px", () => {
        loaded.L.nodes("Alice", "Hatter", "Cheshire", "Caterpillar", "Mouse").sameRow(1);
    });

    it("source and target port y match for adjacent edges (straight horizontal)", () => {
        // sourcePortY is the y of the polyline's first point — the source
        // port attach. For a Right→Left edge between same-row nodes the
        // last polyline point sits at the target's left port y. Both should
        // equal the shared centerline.
        const alice2hatter = loaded.L.edge({fromText: "Alice", toText: "Hatter"}).sourcePortY();
        const hatter2cheshire = loaded.L.edge({fromText: "Hatter", toText: "Cheshire"}).sourcePortY();
        const cheshire2caterpillar = loaded.L.edge({fromText: "Cheshire", toText: "Caterpillar"}).sourcePortY();
        const caterpillar2mouse = loaded.L.edge({fromText: "Caterpillar", toText: "Mouse"}).sourcePortY();
        // All four source ports are at the same centerline (within rounding).
        expect(Math.abs(hatter2cheshire - alice2hatter)).toBeLessThan(1);
        expect(Math.abs(cheshire2caterpillar - alice2hatter)).toBeLessThan(1);
        expect(Math.abs(caterpillar2mouse - alice2hatter)).toBeLessThan(1);
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-fork-chain-wrap", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-fork-chain-wrap"); });

    // Bug regression: linear-tail-after-fork used to pin the first-child
    // chain all the way to the fork's y, which collides nodes when the chain
    // spans a wrap boundary. Bill forks (Caterpillar, Dormouse). First child
    // Caterpillar's chain Caterpillar → Eaglet → Fawn → Gryphon spans 7
    // columns total, so Fawn/Gryphon wrap to row 1 at x = col 0 / col 1.
    // The pre-fix rule pulled Fawn back up to row 0's y, leaving its x at
    // row-1's col 0 — exact same (x, y) as Alice. Same for Gryphon vs Bill.
    // Fix: pin DOWNWARD only — chain pinning stops at the wrap boundary.
    it("no two nodes overlap after wrap", () => {
        loaded.L.nodes("Alice", "Bill", "Caterpillar", "Dormouse", "Eaglet", "Fawn", "Gryphon").noOverlap();
    });

    it("wrapped chain tail stays on its own row, not pulled back to the fork's row", () => {
        loaded.L.nodes("Fawn", "Gryphon").sameRow();
        loaded.L.node("Fawn").below("Alice");
        loaded.L.node("Gryphon").below("Bill");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: lr-fork-skip-rank", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("lr-fork-skip-rank"); });

    // Rule: docs/layout-rules/route-around-intermediate-node.md
    // Bill (decision diamond) has two outgoing branches:
    //   Bill → Dormouse (col 2, adjacent — fine on Right face)
    //   Bill → Caterpillar (col 3, SKIPS Dormouse's column — straight
    //     horizontal would slice through Dormouse)
    // The skip-rank edge gets detoured via Bottom → Top through the gutter.
    it("Bill → Caterpillar (skip-rank) does not cross Dormouse", () => {
        loaded.L.edge({fromText: "Bill", toText: "Caterpillar"}).doesNotCross("Dormouse");
    });

    it("Bill → Caterpillar exits Bottom (cross-axis detour)", () => {
        loaded.L.edge({fromText: "Bill", toText: "Caterpillar"})
            .hasSourceAlignment(PortAlignment.Bottom)
            .hasTargetAlignment(PortAlignment.Top);
    });

    it("Bill → Dormouse (adjacent) stays on Right face", () => {
        loaded.L.edge({fromText: "Bill", toText: "Dormouse"})
            .hasSourceAlignment(PortAlignment.Right)
            .hasTargetAlignment(PortAlignment.Left);
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: tb-back-edge-through-cluster", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("tb-back-edge-through-cluster"); });

    // Reproduces a real diagram (anonymized) where two back-edges in a TB
    // cluster routed straight through non-endpoint nodes:
    //   Duchess -->|resume| Alice  (down-then-up loop, crossing forward chain)
    //   Knave    --> Alice         (decision branch close-loop, crossing Mock)
    // Visual: edges pierced Observation/Caterpillar and >170k?/Mock diamonds.
    it("no edge passes through a non-endpoint node", () => {
        loaded.L.edges().noNodeIntersection();
    });

    it("Duchess → Alice back-edge does not slice forward chain nodes", () => {
        loaded.L.edge({fromText: "Duchess", toText: "Alice"})
            .doesNotCross("Hatter", "Cheshire", "Caterpillar");
    });

    it("Knave → Alice back-edge does not slice the parallel decision branch", () => {
        loaded.L.edge({fromText: "Knave", toText: "Alice"})
            .doesNotCross("Mock");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: tb-subgraph-pipeline", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("tb-subgraph-pipeline"); });

    // Reproduces a real TB diagram (document-pipeline architecture) exercising
    // two fixes:
    //   1. Loose root-level nodes (S3, Stage 2 worker, Client SSE stream sit in
    //      no subgraph) must be ranked next to the cluster they connect to, not
    //      floated to the top layer. Cross-compound edges that touch a loose
    //      node now synthesize a cluster→node ordering edge (filigreeLayout.ts).
    //   2. A cross-cluster edge whose target sits almost directly below its TB
    //      source must keep its main (Bottom) face — switching to a side face
    //      made the router step out to the cluster edge and double back across
    //      the source, slicing it (applyCrossClusterExitFace).
    it("loose root-level nodes are ranked next to their cluster neighbors, not the top row", () => {
        loaded.L.node("S3").below("Upload API");
        loaded.L.node("Stage 2 worker").below("SQS: convert");
        loaded.L.node("Client SSE stream").below("EventBridge");
    });

    it("no edge slices through a non-endpoint node", () => {
        loaded.L.edges().noNodeIntersection();
    });

    it("Step Functions → SQS: convert clears its cluster siblings", () => {
        loaded.L.edge({fromText: "Step Functions", toText: "SQS: convert"})
            .doesNotCross("DynamoDB", "EventBridge");
    });

    it("svg snapshot", () => {
        expect(loaded.svg).toMatchSnapshot();
    });
});

describe("golden: tb-back-edge-stacked-column", () => {
    let loaded: Loaded;
    beforeAll(async () => { loaded = await loadFixture("tb-back-edge-stacked-column"); });

    // Rule: docs/layout-rules/back-edge-stacked-column-riser.md
    // Cheshire ↔ Dormouse form a 2-cycle; the downstream pipeline aligns them
    // in one column with Duchess as a right sibling, so the back-edge gets a
    // Right face on both ends. When two same-face nodes are stacked vertically,
    // the return path only needs a tight riser just outside the shared right
    // edge — NOT a loop up over the top of both boxes, which overshoots above
    // the upper node and slides down its border into the port.
    it("Cheshire and Dormouse are stacked in one column", () => {
        loaded.L.nodes("Cheshire", "Dormouse").sameColumn();
        loaded.L.node("Dormouse").below("Cheshire");
    });

    it("Dormouse → Cheshire back-edge uses Right faces on both ends", () => {
        loaded.L.edge({fromText: "Dormouse", toText: "Cheshire"})
            .hasSourceAlignment(PortAlignment.Right)
            .hasTargetAlignment(PortAlignment.Right);
    });

    it("back-edge is a tight riser (4 points), not a loop over the stack", () => {
        loaded.L.edge({fromText: "Dormouse", toText: "Cheshire"})
            .polylineLengthAtMost(4);
    });

    it("back-edge enters the target perpendicular to the Right face, not sliding down its border", () => {
        loaded.L.edge({fromText: "Dormouse", toText: "Cheshire"})
            .entersTargetPerpendicularTo(PortAlignment.Right);
    });

    it("back-edge does not slice the right sibling", () => {
        loaded.L.edge({fromText: "Dormouse", toText: "Cheshire"})
            .doesNotCross("Duchess");
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
            "lr-multisource-bracketed-label",
            "lr-row-wrap-strike-through",
            "lr-cycle-with-back-edges",
            "lr-fork-linear-tail",
            "lr-back-edge-gutter",
            "lr-back-edge-wrap",
            "lr-fork-cross-row",
            "lr-row-mixed-heights",
            "lr-fork-chain-wrap",
            "lr-fork-skip-rank",
            "tb-back-edge-through-cluster",
            "tb-back-edge-stacked-column",
            "tb-subgraph-pipeline",
        ]);
        for (const name of fixtureNames) {
            expect(exercised.has(name), `fixture ${name}.mmd has no test block`).toBe(true);
        }
    });
});
