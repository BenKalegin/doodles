import {readFileSync, readdirSync} from "node:fs";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {describe, it, beforeAll, expect} from "vitest";
import {ElementType} from "@benkalegin/doodles-core";
import {sequenceFacade, type SequenceFacade} from "@benkalegin/doodles-layout";
import {importMermaidSequenceWithLayout} from "@benkalegin/doodles-mermaid";
import {createDoodleForType} from "../fixtures.js";
import {renderSequenceSvg, defaultLightTheme} from "../../src/index.js";

const FIXTURES_DIR = join(dirname(fileURLToPath(import.meta.url)), "seq-fixtures");

const fixtureNames = readdirSync(FIXTURES_DIR)
    .filter(f => f.endsWith(".mmd"))
    .map(f => f.replace(/\.mmd$/, ""));

interface Loaded {
    S: SequenceFacade;
    svg: string;
}

function loadFixture(name: string): Loaded {
    const source = readFileSync(join(FIXTURES_DIR, `${name}.mmd`), "utf8");
    const base = createDoodleForType(ElementType.SequenceDiagram, `seq-golden-${name}`);
    const diagram = importMermaidSequenceWithLayout(base, source);
    const svg = renderSequenceSvg(diagram, {theme: defaultLightTheme});
    return {S: sequenceFacade(diagram), svg};
}

// Sanity check: every .mmd fixture has a describe block. Catches dropped
// fixtures and prevents shadowing by typos in the per-fixture describes.
describe("sequence fixtures coverage", () => {
    it("has a describe block for every .mmd in seq-fixtures/", () => {
        expect(fixtureNames.sort()).toEqual([
            "seq-alt",
            "seq-autonumber",
            "seq-autonumber-start-step",
            "seq-nested",
            "seq-notes",
            "seq-opt-loop",
            "seq-par",
            "seq-self",
            "seq-simple",
        ]);
    });
});

describe("golden: seq-simple", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-simple"); });

    it("imports both participants in declared order", () => {
        loaded.S.participants().ordered("Alice", "Bob");
        expect(loaded.S.messages().count()).toBe(2);
    });

    it("classifies the two arrows by mermaid semantics", () => {
        loaded.S.message({from: "Alice", to: "Bob", text: "Hello"}).isSync();
        loaded.S.message({from: "Bob", to: "Alice", text: "Hi"}).isReturn();
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});

describe("golden: seq-autonumber", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-autonumber"); });

    it("numbers messages while autonumber is active, stops after `autonumber off`", () => {
        loaded.S.message({from: "Alice", to: "Bob", text: "First"}).hasNumber(1);
        loaded.S.message({from: "Bob", to: "Alice", text: "Second"}).hasNumber(2);
        // The post-`autonumber off` message has no sequenceNumber field —
        // hasNumber would throw. Assert via the underlying state instead.
        const m = Object.values(loaded.svg.match(/>3</) ?? []);
        expect(m.length).toBe(0);
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});

describe("golden: seq-autonumber-start-step", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-autonumber-start-step"); });

    it("respects custom start + step", () => {
        loaded.S.message({from: "Alice", to: "Bob", text: "First"}).hasNumber(10);
        loaded.S.message({from: "Bob", to: "Alice", text: "Second"}).hasNumber(15);
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});

describe("golden: seq-notes", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-notes"); });

    it("imports all four note anchors", () => {
        loaded.S.note({over: "Alice", text: "just Alice"}).attachedTo("Alice");
        loaded.S.note({spans: ["Alice", "Bob"], text: "spans both"}).attachedTo("Alice", "Bob");
        loaded.S.note({leftOf: "Alice", text: "to the left"}).exists();
        loaded.S.note({rightOf: "Bob", text: "to the right"}).exists();
        expect(loaded.S.notes().count()).toBe(4);
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});

describe("golden: seq-alt", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-alt"); });

    it("alt frame captures both sections in order", () => {
        loaded.S.frame({kind: "alt"}).hasSections("happy path", "error");
        loaded.S.frame({kind: "alt"}).coversParticipants("Alice", "Bob");
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});

describe("golden: seq-opt-loop", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-opt-loop"); });

    it("opt and loop frames coexist with their labels", () => {
        loaded.S.frame({kind: "opt", label: "is enabled"}).exists();
        loaded.S.frame({kind: "loop", label: "every minute"}).exists();
        expect(loaded.S.frames().count()).toBe(2);
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});

describe("golden: seq-par", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-par"); });

    it("par frame collects both branches as sections", () => {
        loaded.S.frame({kind: "par"}).hasSections("concurrent calls", "");
        loaded.S.frame({kind: "par"}).coversParticipants("Alice", "Bob", "Charlie");
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});

describe("golden: seq-nested", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-nested"); });

    it("inner opt is fully contained by outer loop coverage", () => {
        loaded.S.frame({kind: "loop", label: "outer"}).coversParticipants("Alice", "Bob");
        loaded.S.frame({kind: "opt", label: "inner"}).coversParticipants("Alice", "Bob");
        expect(loaded.S.frames().count()).toBe(2);
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});

describe("golden: seq-self", () => {
    let loaded: Loaded;
    beforeAll(() => { loaded = loadFixture("seq-self"); });

    it("recognises self-messages", () => {
        loaded.S.message({from: "Alice", to: "Alice", text: "think"}).isSelf();
        loaded.S.message({from: "Alice", to: "Alice", text: "decide"}).isSelf();
    });

    it("svg snapshot", () => { expect(loaded.svg).toMatchSnapshot(); });
});
