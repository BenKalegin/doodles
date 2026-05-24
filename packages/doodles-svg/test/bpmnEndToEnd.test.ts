import {describe, expect, it} from "vitest";
import {DOMParser, XMLSerializer} from "@xmldom/xmldom";
import {importBpmnDiagram} from "@benkalegin/doodles-bpmn";
import {applyBpmnLayout} from "@benkalegin/doodles-layout";
import {renderBpmnSvg} from "../src/bpmn.js";

const xmldomOpts = {
    domParser: new DOMParser(),
    xmlSerializer: new XMLSerializer(),
};

const LLM_STYLE_BPMN = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:startEvent id="Start" name="Order placed"/>
    <bpmn:userTask id="Review" name="Review order"/>
    <bpmn:exclusiveGateway id="Decide" name="Approve?"/>
    <bpmn:serviceTask id="Ship" name="Ship order"/>
    <bpmn:endEvent id="End" name="Complete"/>
    <bpmn:endEvent id="Rejected" name="Rejected"/>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Review"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Review" targetRef="Decide"/>
    <bpmn:sequenceFlow id="F3" sourceRef="Decide" targetRef="Ship" name="yes"/>
    <bpmn:sequenceFlow id="F4" sourceRef="Ship" targetRef="End"/>
    <bpmn:sequenceFlow id="F5" sourceRef="Decide" targetRef="Rejected" name="no"/>
  </bpmn:process>
</bpmn:definitions>`;

describe("BPMN end-to-end: parse → layout → render", () => {
    const parsed = importBpmnDiagram(LLM_STYLE_BPMN, xmldomOpts);
    const laid = applyBpmnLayout(parsed);
    const svg = renderBpmnSvg(laid);

    it("the parsed diagram lacks layout, the laid-out one has it", () => {
        expect(parsed.hasLayout).toBe(false);
        expect(laid.hasLayout).toBe(true);
    });

    it("renders all six flow nodes", () => {
        expect((svg.match(/data-doodles-bpmn-event="/g) ?? []).length).toBe(3);
        expect((svg.match(/data-doodles-bpmn-activity="/g) ?? []).length).toBe(2);
        expect((svg.match(/data-doodles-bpmn-gateway="/g) ?? []).length).toBe(1);
    });

    it("renders all five sequence flows", () => {
        expect((svg.match(/data-doodles-bpmn-flow="/g) ?? []).length).toBe(5);
    });

    it("emits gateway branch labels (yes/no)", () => {
        expect(svg).toContain(">yes<");
        expect(svg).toContain(">no<");
    });

    it("produces sane viewBox dimensions", () => {
        const viewBox = svg.match(/viewBox="(-?\d+)\s+(-?\d+)\s+(\d+)\s+(\d+)"/);
        expect(viewBox).not.toBeNull();
        const width = parseInt(viewBox![3] ?? "0", 10);
        const height = parseInt(viewBox![4] ?? "0", 10);
        expect(width).toBeGreaterThan(400);
        expect(height).toBeGreaterThan(60);
    });
});

describe("BPMN end-to-end: idempotent layout (no-DI input twice)", () => {
    it("running applyBpmnLayout twice yields the same placements as once", () => {
        const parsed = importBpmnDiagram(LLM_STYLE_BPMN, xmldomOpts);
        const once = applyBpmnLayout(parsed);
        const twice = applyBpmnLayout(once);
        expect(twice).toBe(once); // second call short-circuits via hasLayout
    });
});
