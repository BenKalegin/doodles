import {describe, expect, it} from "vitest";
import {DOMParser, XMLSerializer} from "@xmldom/xmldom";
import {importBpmnDiagram} from "@benkalegin/doodles-bpmn";
import {renderBpmnSvg} from "../src/bpmn.js";

const xmldomOpts = {
    domParser: new DOMParser(),
    xmlSerializer: new XMLSerializer(),
};

const SIMPLE_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:startEvent id="S" name="Begin" />
    <bpmn:userTask id="T" name="Approve" />
    <bpmn:exclusiveGateway id="G" name="OK?" />
    <bpmn:endEvent id="E" name="Done" />
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T" />
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="G" />
    <bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="E" name="yes" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag_1">
    <bpmndi:BPMNPlane id="Plane_1" bpmnElement="P">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="T_di" bpmnElement="T"><dc:Bounds x="200" y="80" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="G_di" bpmnElement="G"><dc:Bounds x="360" y="95" width="50" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="470" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="136" y="118"/><di:waypoint x="200" y="120"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="F2_di" bpmnElement="F2"><di:waypoint x="300" y="120"/><di:waypoint x="360" y="120"/></bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="F3_di" bpmnElement="F3"><di:waypoint x="410" y="120"/><di:waypoint x="470" y="118"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const POOL_BPMN = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmn:collaboration id="C">
    <bpmn:participant id="Pool_A" name="Customer" processRef="Proc_A"/>
    <bpmn:messageFlow id="MF1" sourceRef="X" targetRef="Y"/>
  </bpmn:collaboration>
  <bpmn:process id="Proc_A">
    <bpmn:task id="X" name="Send"/>
    <bpmn:task id="Y" name="Receive"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="C">
      <bpmndi:BPMNShape id="Pool_A_di" bpmnElement="Pool_A" isHorizontal="true">
        <dc:Bounds x="100" y="60" width="400" height="200"/>
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="X_di" bpmnElement="X"><dc:Bounds x="160" y="100" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Y_di" bpmnElement="Y"><dc:Bounds x="320" y="100" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="MF1_di" bpmnElement="MF1"><di:waypoint x="260" y="140"/><di:waypoint x="320" y="140"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

describe("renderBpmnSvg — simple linear process", () => {
    const diagram = importBpmnDiagram(SIMPLE_BPMN, xmldomOpts);
    const svg = renderBpmnSvg(diagram);

    it("emits a single <svg> root", () => {
        expect(svg.startsWith("<svg")).toBe(true);
        expect(svg.endsWith("</svg>")).toBe(true);
    });

    it("tags the root with the bpmn class", () => {
        expect(svg).toMatch(/class="doodles-svg doodles-svg-bpmn"/);
    });

    it("emits one <g data-doodles-bpmn-event> per event", () => {
        expect((svg.match(/data-doodles-bpmn-event="/g) ?? []).length).toBe(2);
    });

    it("emits one <g data-doodles-bpmn-activity> per task", () => {
        expect((svg.match(/data-doodles-bpmn-activity="/g) ?? []).length).toBe(1);
    });

    it("emits one <g data-doodles-bpmn-gateway> per gateway", () => {
        expect((svg.match(/data-doodles-bpmn-gateway="/g) ?? []).length).toBe(1);
    });

    it("emits one <g data-doodles-bpmn-flow> per sequence flow", () => {
        expect((svg.match(/data-doodles-bpmn-flow="/g) ?? []).length).toBe(3);
    });

    it("draws a diamond path for the exclusive gateway", () => {
        expect(svg).toMatch(/<path d="M\d+ \d+ L\d+ \d+ L\d+ \d+ L\d+ \d+ Z"[^>]+stroke/);
    });

    it("draws an X-shaped marker inside the exclusive gateway", () => {
        const gatewayBlock = svg.match(/data-doodles-bpmn-gateway="G"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        const lineCount = (gatewayBlock.match(/<line\b/g) ?? []).length;
        expect(lineCount).toBeGreaterThanOrEqual(2);
    });

    it("renders the end event with a thicker stroke than the start event", () => {
        const startBlock = svg.match(/data-doodles-bpmn-event="S"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        const endBlock = svg.match(/data-doodles-bpmn-event="E"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        const startStroke = parseFloat(startBlock.match(/stroke-width="([\d.]+)"/)?.[1] ?? "0");
        const endStroke = parseFloat(endBlock.match(/stroke-width="([\d.]+)"/)?.[1] ?? "0");
        expect(endStroke).toBeGreaterThan(startStroke);
    });

    it("places the named flow label", () => {
        expect(svg).toContain(">yes<");
    });
});

describe("renderBpmnSvg — pool with message flow", () => {
    const diagram = importBpmnDiagram(POOL_BPMN, xmldomOpts);
    const svg = renderBpmnSvg(diagram);

    it("emits a <g data-doodles-bpmn-pool> for the participant", () => {
        expect(svg).toContain('data-doodles-bpmn-pool="Pool_A"');
    });

    it("renders the pool label", () => {
        expect(svg).toContain(">Customer<");
    });

    it("draws message flow with dashed stroke", () => {
        const flowBlock = svg.match(/data-doodles-bpmn-flow="MF1"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        expect(flowBlock).toMatch(/stroke-dasharray="\d+\s+\d+"/);
    });

    it("draws an open circle at the source of message flow", () => {
        const flowBlock = svg.match(/data-doodles-bpmn-flow="MF1"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        expect(flowBlock).toMatch(/<circle\b/);
    });

    it("draws an open (unfilled) arrowhead for message flow", () => {
        const flowBlock = svg.match(/data-doodles-bpmn-flow="MF1"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        // The arrowhead polygon for message flow has fill="none"
        expect(flowBlock).toMatch(/<polygon[^>]*fill="none"/);
    });
});

describe("renderBpmnSvg — event definitions", () => {
    const xml = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
  <bpmn:process id="P">
    <bpmn:startEvent id="M"><bpmn:messageEventDefinition/></bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="K"><bpmn:timerEventDefinition/></bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="Z"><bpmn:terminateEventDefinition/></bpmn:endEvent>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Pl" bpmnElement="P">
      <bpmndi:BPMNShape id="M_di" bpmnElement="M"><dc:Bounds x="0" y="0" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="K_di" bpmnElement="K"><dc:Bounds x="100" y="0" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Z_di" bpmnElement="Z"><dc:Bounds x="200" y="0" width="36" height="36"/></bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;
    const svg = renderBpmnSvg(importBpmnDiagram(xml, xmldomOpts));

    it("draws an envelope (rect + flap path) inside the message start event", () => {
        const block = svg.match(/data-doodles-bpmn-event="M"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        // Outer circle + inner glyph rect + flap path
        expect((block.match(/<rect\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
        expect((block.match(/<path\b/g) ?? []).length).toBeGreaterThanOrEqual(1);
    });

    it("draws a clock (circle + two lines) inside the timer event", () => {
        const block = svg.match(/data-doodles-bpmn-event="K"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        // Outer ring + inner ring (intermediate) + clock face circle + 2 hands
        expect((block.match(/<circle\b/g) ?? []).length).toBeGreaterThanOrEqual(3);
        expect((block.match(/<line\b/g) ?? []).length).toBeGreaterThanOrEqual(2);
    });

    it("draws a filled inner circle for the terminate end event", () => {
        const block = svg.match(/data-doodles-bpmn-event="Z"[^>]*>[\s\S]*?<\/g>/)?.[0] ?? "";
        // Outer ring (currentColor stroke) + inner filled glyph (currentColor fill).
        expect(block).toMatch(/<circle[^>]*fill="currentColor"/);
    });
});
