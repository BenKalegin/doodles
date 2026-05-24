import {describe, expect, it} from "vitest";
import {DOMParser, XMLSerializer} from "@xmldom/xmldom";
import {BpmnElementKind} from "@benkalegin/doodles-core";
import {importBpmnDiagram} from "@benkalegin/doodles-bpmn";
import {applyBpmnLayout} from "../src/bpmnLayout.js";

const xmldomOpts = {
    domParser: new DOMParser(),
    xmlSerializer: new XMLSerializer(),
};

const FLAT_NO_DI = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="P" isExecutable="true">
    <bpmn:startEvent id="S" name="Start"/>
    <bpmn:userTask id="T1" name="Review"/>
    <bpmn:exclusiveGateway id="G" name="OK?"/>
    <bpmn:endEvent id="E" name="Done"/>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1"/>
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="G"/>
    <bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="E"/>
  </bpmn:process>
</bpmn:definitions>`;

const POOL_TWO_LANES_NO_DI = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:collaboration id="C">
    <bpmn:participant id="Pool_A" name="Customer" processRef="Proc"/>
  </bpmn:collaboration>
  <bpmn:process id="Proc">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Lane_S" name="Sales">
        <bpmn:flowNodeRef>S</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>T1</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_O" name="Ops">
        <bpmn:flowNodeRef>T2</bpmn:flowNodeRef>
        <bpmn:flowNodeRef>E</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:startEvent id="S"/>
    <bpmn:userTask id="T1" name="Quote"/>
    <bpmn:serviceTask id="T2" name="Ship"/>
    <bpmn:endEvent id="E"/>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T1"/>
    <bpmn:sequenceFlow id="F2" sourceRef="T1" targetRef="T2"/>
    <bpmn:sequenceFlow id="F3" sourceRef="T2" targetRef="E"/>
  </bpmn:process>
</bpmn:definitions>`;

describe("applyBpmnLayout — passthrough", () => {
    it("returns unchanged when hasLayout is already true", () => {
        const xml = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC">
  <bpmn:process id="P"><bpmn:startEvent id="S"/></bpmn:process>
  <bpmn:BPMNDiagram xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/DI"/>
  <bpmndi:BPMNDiagram id="D"><bpmndi:BPMNPlane id="Pl" bpmnElement="P">
    <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="50" y="50" width="36" height="36"/></bpmndi:BPMNShape>
  </bpmndi:BPMNPlane></bpmndi:BPMNDiagram>
</bpmn:definitions>`;
        const parsed = importBpmnDiagram(xml, xmldomOpts);
        const out = applyBpmnLayout(parsed);
        expect(out).toBe(parsed); // identity — same object returned
    });
});

describe("applyBpmnLayout — flat process with no DI", () => {
    const parsed = importBpmnDiagram(FLAT_NO_DI, xmldomOpts);
    expect(parsed.hasLayout).toBe(false);
    const laid = applyBpmnLayout(parsed);

    it("flips hasLayout to true", () => {
        expect(laid.hasLayout).toBe(true);
    });

    it("places every flow node", () => {
        expect(laid.nodePlacements["S"]).toBeDefined();
        expect(laid.nodePlacements["T1"]).toBeDefined();
        expect(laid.nodePlacements["G"]).toBeDefined();
        expect(laid.nodePlacements["E"]).toBeDefined();
    });

    it("orders nodes left-to-right following the sequence flow", () => {
        const sx = laid.nodePlacements["S"]!.bounds.x;
        const tx = laid.nodePlacements["T1"]!.bounds.x;
        const gx = laid.nodePlacements["G"]!.bounds.x;
        const ex = laid.nodePlacements["E"]!.bounds.x;
        expect(sx).toBeLessThan(tx);
        expect(tx).toBeLessThan(gx);
        expect(gx).toBeLessThan(ex);
    });

    it("vertically centers all nodes on the same baseline (within a lane)", () => {
        const centers = ["S", "T1", "G", "E"].map(id => {
            const b = laid.nodePlacements[id]!.bounds;
            return b.y + b.height / 2;
        });
        for (const c of centers) expect(c).toBe(centers[0]);
    });

    it("routes every sequence flow", () => {
        expect(laid.flowPlacements["F1"]?.waypoints.length).toBeGreaterThanOrEqual(2);
        expect(laid.flowPlacements["F2"]?.waypoints.length).toBeGreaterThanOrEqual(2);
        expect(laid.flowPlacements["F3"]?.waypoints.length).toBeGreaterThanOrEqual(2);
    });

    it("first waypoint sits on the source's right edge for left-to-right flow", () => {
        const sBounds = laid.nodePlacements["S"]!.bounds;
        const first = laid.flowPlacements["F1"]!.waypoints[0]!;
        expect(first.x).toBe(sBounds.x + sBounds.width);
    });

    it("last waypoint sits on the target's left edge", () => {
        const tBounds = laid.nodePlacements["T1"]!.bounds;
        const wps = laid.flowPlacements["F1"]!.waypoints;
        const last = wps[wps.length - 1]!;
        expect(last.x).toBe(tBounds.x);
    });

    it("produces non-zero display dimensions", () => {
        expect(laid.display.width).toBeGreaterThan(0);
        expect(laid.display.height).toBeGreaterThan(0);
    });
});

describe("applyBpmnLayout — pool with two lanes", () => {
    const parsed = importBpmnDiagram(POOL_TWO_LANES_NO_DI, xmldomOpts);
    const laid = applyBpmnLayout(parsed);

    it("places the pool", () => {
        const pool = laid.nodePlacements["Pool_A"];
        expect(pool).toBeDefined();
        expect(pool!.bounds.width).toBeGreaterThan(0);
        expect(pool!.bounds.height).toBeGreaterThan(0);
    });

    it("places both lanes inside the pool's vertical extent", () => {
        const pool = laid.nodePlacements["Pool_A"]!.bounds;
        const sales = laid.nodePlacements["Lane_S"]!.bounds;
        const ops = laid.nodePlacements["Lane_O"]!.bounds;
        expect(sales.y).toBeGreaterThanOrEqual(pool.y);
        expect(ops.y + ops.height).toBeLessThanOrEqual(pool.y + pool.height);
    });

    it("stacks Lane_O below Lane_S without overlap", () => {
        const sales = laid.nodePlacements["Lane_S"]!.bounds;
        const ops = laid.nodePlacements["Lane_O"]!.bounds;
        expect(ops.y).toBeGreaterThanOrEqual(sales.y + sales.height - 1);
    });

    it("places each task within its lane's vertical band", () => {
        const sales = laid.nodePlacements["Lane_S"]!.bounds;
        const t1 = laid.nodePlacements["T1"]!.bounds;
        const t1Center = t1.y + t1.height / 2;
        expect(t1Center).toBeGreaterThanOrEqual(sales.y);
        expect(t1Center).toBeLessThanOrEqual(sales.y + sales.height);

        const ops = laid.nodePlacements["Lane_O"]!.bounds;
        const t2 = laid.nodePlacements["T2"]!.bounds;
        const t2Center = t2.y + t2.height / 2;
        expect(t2Center).toBeGreaterThanOrEqual(ops.y);
        expect(t2Center).toBeLessThanOrEqual(ops.y + ops.height);
    });

    it("orders flow nodes left-to-right across lanes by sequence flow", () => {
        const sx = laid.nodePlacements["S"]!.bounds.x;
        const t1x = laid.nodePlacements["T1"]!.bounds.x;
        const t2x = laid.nodePlacements["T2"]!.bounds.x;
        const ex = laid.nodePlacements["E"]!.bounds.x;
        // Each lane runs its own topo order; we don't enforce cross-lane x ordering here.
        expect(sx).toBeLessThan(t1x);
        expect(t2x).toBeLessThan(ex);
    });

    it("classifies the pool as a Pool node kind", () => {
        const pool = parsed.nodes["Pool_A"];
        expect(pool?.kind).toBe(BpmnElementKind.Pool);
    });
});

describe("applyBpmnLayout — gateway alternate branch avoids primary chain", () => {
    // Order placed → Review → Approve? → Ship → Done
    //                              └────── no ────→ Rejected
    // The "no" branch must end up at the same X as Ship (same layer) but a
    // different Y, so the flow can route around without crossing Ship.
    const xml = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="P">
    <bpmn:startEvent id="Start" name="Order placed"/>
    <bpmn:userTask id="Review" name="Review order"/>
    <bpmn:exclusiveGateway id="Decide" name="Approve?"/>
    <bpmn:serviceTask id="Ship" name="Ship order"/>
    <bpmn:endEvent id="Done" name="Order shipped"/>
    <bpmn:endEvent id="Rejected" name="Order rejected"/>
    <bpmn:sequenceFlow id="F1" sourceRef="Start" targetRef="Review"/>
    <bpmn:sequenceFlow id="F2" sourceRef="Review" targetRef="Decide"/>
    <bpmn:sequenceFlow id="F3" sourceRef="Decide" targetRef="Ship"/>
    <bpmn:sequenceFlow id="F4" sourceRef="Ship" targetRef="Done"/>
    <bpmn:sequenceFlow id="F5" sourceRef="Decide" targetRef="Rejected"/>
  </bpmn:process>
</bpmn:definitions>`;
    const laid = applyBpmnLayout(importBpmnDiagram(xml, xmldomOpts));

    it("places Ship and Rejected at the same X (same layer)", () => {
        const shipX = laid.nodePlacements["Ship"]!.bounds.x;
        const rejectedX = laid.nodePlacements["Rejected"]!.bounds.x;
        // Centers should be equal (centered on the layer's max-width-column).
        const shipCx = shipX + laid.nodePlacements["Ship"]!.bounds.width / 2;
        const rejectedCx = rejectedX + laid.nodePlacements["Rejected"]!.bounds.width / 2;
        expect(shipCx).toBe(rejectedCx);
    });

    it("places Ship and Rejected at different Y (vertically stacked in the layer)", () => {
        const shipCy = laid.nodePlacements["Ship"]!.bounds.y + laid.nodePlacements["Ship"]!.bounds.height / 2;
        const rejectedCy = laid.nodePlacements["Rejected"]!.bounds.y + laid.nodePlacements["Rejected"]!.bounds.height / 2;
        expect(shipCy).not.toBe(rejectedCy);
    });

    it("places Done in a later layer than Ship/Rejected", () => {
        const shipX = laid.nodePlacements["Ship"]!.bounds.x;
        const doneX = laid.nodePlacements["Done"]!.bounds.x;
        expect(doneX).toBeGreaterThan(shipX);
    });

    it("Decide gateway sits in a layer before both Ship and Rejected", () => {
        const decideRight = laid.nodePlacements["Decide"]!.bounds.x + laid.nodePlacements["Decide"]!.bounds.width;
        const shipLeft = laid.nodePlacements["Ship"]!.bounds.x;
        const rejectedLeft = laid.nodePlacements["Rejected"]!.bounds.x;
        expect(decideRight).toBeLessThanOrEqual(shipLeft);
        expect(decideRight).toBeLessThanOrEqual(rejectedLeft);
    });
});

describe("applyBpmnLayout — disconnected nodes still placed", () => {
    const xml = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="P">
    <bpmn:userTask id="Orphan" name="Lonely"/>
    <bpmn:startEvent id="S"/>
    <bpmn:endEvent id="E"/>
    <bpmn:sequenceFlow id="F" sourceRef="S" targetRef="E"/>
  </bpmn:process>
</bpmn:definitions>`;
    const laid = applyBpmnLayout(importBpmnDiagram(xml, xmldomOpts));

    it("places every node, even disconnected ones", () => {
        expect(laid.nodePlacements["Orphan"]).toBeDefined();
        expect(laid.nodePlacements["S"]).toBeDefined();
        expect(laid.nodePlacements["E"]).toBeDefined();
    });
});
