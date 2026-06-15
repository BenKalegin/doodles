/*
 * Layout-quality scorer — a metrics dashboard + correctness gate over every
 * golden flowchart fixture. Not part of the default `pnpm test` run (it lives
 * outside the `*.test.ts` include); invoke it with `pnpm score` from the repo
 * root.
 *
 * For each fixture it imports → lays out → routes the diagram and reports:
 *   - len    total Manhattan edge length (lower = tighter routing)
 *   - bends  total polyline vertices beyond the endpoints
 *   - area   node bounding-box area in 1000s of px² (lower = more compact)
 *   - cross  edge-segment ↔ edge-segment crossings
 *   - hits   edge segments entering a non-endpoint node's interior (strike-throughs)
 *
 * len/bends/area/cross are *quality* signals — printed for before/after
 * comparison when tuning layout, never asserted (a "worse" number may be a
 * deliberate trade-off). `hits` is *correctness*: an edge slicing through a
 * node is always a bug, so the run fails if any fixture has a strike-through.
 *
 * Use it when changing layout (filigree placement, doodles routing): capture
 * the totals before, make the change, and compare.
 */
import {readFileSync, readdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {it, expect} from "vitest";
import {ElementType, segmentEntersRect, insetBounds, type Bounds, type Coordinate} from "@benkalegin/doodles-core";
import {importMermaidFlowchartWithLayout} from "@benkalegin/doodles-mermaid";
import {createDoodleForType} from "../fixtures.js";
import {routeEdges, defaultLightTheme} from "../../src/index.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
// Matches the renderer hairline / layoutTesting inset: grazing a perimeter
// attach point is legal, entering the inset interior is a strike-through.
const NODE_INTERIOR_INSET_PX = 0.5;

interface DiagramShape {
    elements: Record<string, {type?: ElementType; id: string} | undefined>;
    nodes: Record<string, {bounds: Bounds} | undefined>;
}

interface FixtureScore {
    name: string;
    length: number;
    bends: number;
    area: number;
    crossings: number;
    hits: number;
}

/** Proper segment-segment crossing (shared endpoints / collinear touches don't count). */
function segmentsCross(a1: Coordinate, a2: Coordinate, b1: Coordinate, b2: Coordinate): boolean {
    const side = (p: Coordinate, q: Coordinate, r: Coordinate): number =>
        (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    const d1 = side(b1, b2, a1);
    const d2 = side(b1, b2, a2);
    const d3 = side(a1, a2, b1);
    const d4 = side(a1, a2, b2);
    return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

function nodeInteriors(diagram: DiagramShape): Bounds[] {
    const interiors: Bounds[] = [];
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.ClassNode) continue;
        const b = diagram.nodes[el.id]?.bounds;
        if (!b) continue;
        const inset = insetBounds(b, NODE_INTERIOR_INSET_PX);
        if (inset.width > 0 && inset.height > 0) interiors.push(inset);
    }
    return interiors;
}

async function scoreFixture(name: string): Promise<FixtureScore> {
    const source = readFileSync(join(FIXTURES_DIR, `${name}.mmd`), "utf8");
    const base = createDoodleForType(ElementType.FlowchartDiagram, name);
    const diagram = await importMermaidFlowchartWithLayout(base, source) as unknown as DiagramShape;
    const routes = routeEdges(diagram as never, defaultLightTheme);

    const segments: [Coordinate, Coordinate][] = [];
    let length = 0;
    let bends = 0;
    for (const route of routes) {
        for (let i = 1; i < route.polyline.length; i++) {
            const p = route.polyline[i - 1]!;
            const q = route.polyline[i]!;
            length += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
            segments.push([p, q]);
        }
        bends += Math.max(0, route.polyline.length - 2);
    }

    const interiors = nodeInteriors(diagram);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of Object.values(diagram.elements)) {
        if (el?.type !== ElementType.ClassNode) continue;
        const b = diagram.nodes[el.id]?.bounds;
        if (!b) continue;
        minX = Math.min(minX, b.x);
        minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.width);
        maxY = Math.max(maxY, b.y + b.height);
    }
    const area = (maxX - minX) * (maxY - minY);

    let crossings = 0;
    for (let i = 0; i < segments.length; i++) {
        for (let j = i + 1; j < segments.length; j++) {
            if (segmentsCross(segments[i]![0], segments[i]![1], segments[j]![0], segments[j]![1])) crossings++;
        }
    }

    let hits = 0;
    for (const [p, q] of segments) {
        for (const rect of interiors) {
            if (segmentEntersRect(p, q, rect)) hits++;
        }
    }

    return {name, length, bends, area, crossings, hits};
}

it("layout-quality score across all golden fixtures (fails on any node strike-through)", async () => {
    const names = readdirSync(FIXTURES_DIR)
        .filter((f) => f.endsWith(".mmd"))
        .map((f) => f.replace(/\.mmd$/, ""))
        .sort();

    const scores: FixtureScore[] = [];
    for (const name of names) scores.push(await scoreFixture(name));

    const rows = scores.map((s) =>
        `${s.name.padEnd(34)} len=${String(Math.round(s.length)).padStart(7)} ` +
        `bends=${String(s.bends).padStart(4)} area=${String(Math.round(s.area / 1000)).padStart(7)}k ` +
        `cross=${String(s.crossings).padStart(3)} hits=${String(s.hits).padStart(3)}`,
    );
    const total = scores.reduce(
        (acc, s) => ({
            length: acc.length + s.length,
            bends: acc.bends + s.bends,
            area: acc.area + s.area,
            crossings: acc.crossings + s.crossings,
            hits: acc.hits + s.hits,
        }),
        {length: 0, bends: 0, area: 0, crossings: 0, hits: 0},
    );
    // eslint-disable-next-line no-console
    console.log(
        "\n" + rows.join("\n") + "\n" + "-".repeat(80) + "\n" +
        `TOTALS  len=${Math.round(total.length)} bends=${total.bends} ` +
        `area=${Math.round(total.area / 1000)}k cross=${total.crossings} hits=${total.hits}`,
    );

    const offenders = scores.filter((s) => s.hits > 0).map((s) => s.name);
    expect(offenders, `fixtures with edge strike-throughs: ${offenders.join(", ")}`).toEqual([]);
});
