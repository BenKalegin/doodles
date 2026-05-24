import {describe, expect, it} from "vitest";
import {DOMParser, XMLSerializer} from "@xmldom/xmldom";
import {
    type BpmnDiagram,
    BpmnElementKind,
    BpmnEventDefinition,
    BpmnFlowKind,
    BpmnPoolOrientation,
} from "@benkalegin/doodles-core";
import {importBpmnDiagram} from "../src/bpmnImporter.js";
import {exportBpmnDiagram} from "../src/bpmnExporter.js";

const xmldomOpts = {
    domParser: new DOMParser(),
    xmlSerializer: new XMLSerializer(),
};

function roundTrip(xml: string): BpmnDiagram {
    return importBpmnDiagram(exportBpmnDiagram(importBpmnDiagram(xml, xmldomOpts)), xmldomOpts);
}

const FLAT = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Defs_1" targetNamespace="http://example.com/bpmn">
  <bpmn:process id="P1" isExecutable="true" name="My Process">
    <bpmn:startEvent id="S" name="Start"/>
    <bpmn:userTask id="T" name="Review"/>
    <bpmn:exclusiveGateway id="G" name="OK?" gatewayDirection="Diverging"/>
    <bpmn:endEvent id="E" name="Done"/>
    <bpmn:sequenceFlow id="F1" sourceRef="S" targetRef="T"/>
    <bpmn:sequenceFlow id="F2" sourceRef="T" targetRef="G"/>
    <bpmn:sequenceFlow id="F3" sourceRef="G" targetRef="E" name="yes">
      <bpmn:conditionExpression>\${approved}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="Diag">
    <bpmndi:BPMNPlane id="Plane" bpmnElement="P1">
      <bpmndi:BPMNShape id="S_di" bpmnElement="S"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="T_di" bpmnElement="T"><dc:Bounds x="200" y="80" width="100" height="80"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="G_di" bpmnElement="G"><dc:Bounds x="360" y="95" width="50" height="50"/></bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="E_di" bpmnElement="E"><dc:Bounds x="470" y="100" width="36" height="36"/></bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="F1_di" bpmnElement="F1"><di:waypoint x="136" y="118"/><di:waypoint x="200" y="120"/></bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const POOL_WITH_LANES = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI">
  <bpmn:collaboration id="C">
    <bpmn:participant id="Pool_A" name="Customer" processRef="Proc"/>
    <bpmn:messageFlow id="MF1" sourceRef="Task_A" targetRef="Task_B"/>
  </bpmn:collaboration>
  <bpmn:process id="Proc" isExecutable="true">
    <bpmn:laneSet id="LS">
      <bpmn:lane id="Lane_S" name="Sales">
        <bpmn:flowNodeRef>Task_A</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_O" name="Ops">
        <bpmn:flowNodeRef>Task_B</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:userTask id="Task_A" name="Quote"/>
    <bpmn:serviceTask id="Task_B" name="Ship"/>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="D">
    <bpmndi:BPMNPlane id="Pl" bpmnElement="C">
      <bpmndi:BPMNShape id="Pool_A_di" bpmnElement="Pool_A" isHorizontal="true">
        <dc:Bounds x="100" y="60" width="500" height="240"/>
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const WITH_EXTENSIONS = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  xmlns:acme="http://acme.example.com/bpmn">
  <bpmn:process id="Pp" isExecutable="true" camunda:historyTimeToLive="30">
    <bpmn:userTask id="TaskX" name="Approve" camunda:assignee="\${initiator}">
      <bpmn:extensionElements>
        <zeebe:assignmentDefinition assignee="user.id" />
        <camunda:formData>
          <camunda:formField id="amount" type="long" />
        </camunda:formData>
        <acme:metadata sla="24h" />
      </bpmn:extensionElements>
    </bpmn:userTask>
  </bpmn:process>
</bpmn:definitions>`;

const WITH_EVENT_DEFINITIONS = `<?xml version="1.0"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL">
  <bpmn:process id="Pe">
    <bpmn:startEvent id="MStart"><bpmn:messageEventDefinition/></bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="TCatch"><bpmn:timerEventDefinition/></bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="TermEnd"><bpmn:terminateEventDefinition/></bpmn:endEvent>
  </bpmn:process>
</bpmn:definitions>`;

describe("BPMN round-trip: flat process", () => {
    const before = importBpmnDiagram(FLAT, xmldomOpts);
    const exported = exportBpmnDiagram(before);
    const after = importBpmnDiagram(exported, xmldomOpts);

    it("re-emits a valid XML declaration + bpmn:definitions root", () => {
        expect(exported).toMatch(/^<\?xml version="1\.0"/);
        expect(exported).toMatch(/<bpmn:definitions\b/);
    });

    it("preserves process metadata", () => {
        expect(after.processes["P1"]).toMatchObject({id: "P1", name: "My Process", isExecutable: true});
    });

    it("preserves all flow nodes with kinds + names", () => {
        expect(after.nodes["S"]?.kind).toBe(BpmnElementKind.StartEvent);
        expect(after.nodes["T"]?.kind).toBe(BpmnElementKind.UserTask);
        expect(after.nodes["G"]?.kind).toBe(BpmnElementKind.ExclusiveGateway);
        expect(after.nodes["E"]?.kind).toBe(BpmnElementKind.EndEvent);
        expect(after.nodes["T"]?.name).toBe("Review");
    });

    it("preserves conditional sequence flow", () => {
        expect(after.flows["F3"]?.condition).toBe("${approved}");
        expect(after.flows["F3"]?.name).toBe("yes");
    });

    it("preserves DI bounds and waypoints", () => {
        expect(after.nodePlacements["T"]?.bounds).toEqual({x: 200, y: 80, width: 100, height: 80});
        expect(after.flowPlacements["F1"]?.waypoints).toEqual([{x: 136, y: 118}, {x: 200, y: 120}]);
    });

    it("preserves hasLayout=true", () => {
        expect(after.hasLayout).toBe(true);
    });

    it("preserves gateway direction", () => {
        const g = after.nodes["G"];
        if (g?.kind === BpmnElementKind.ExclusiveGateway) expect(g.direction).toBe("diverging");
    });
});

describe("BPMN round-trip: pool with lanes and message flow", () => {
    const before = importBpmnDiagram(POOL_WITH_LANES, xmldomOpts);
    const after = roundTrip(POOL_WITH_LANES);

    it("preserves the pool with processRef", () => {
        const pool = after.nodes["Pool_A"];
        expect(pool?.kind).toBe(BpmnElementKind.Pool);
        if (pool?.kind === BpmnElementKind.Pool) {
            expect(pool.processRef).toBe("Proc");
            expect(pool.orientation).toBe(BpmnPoolOrientation.Horizontal);
        }
    });

    it("preserves lanes + flowNodeRefs", () => {
        const sales = after.nodes["Lane_S"];
        expect(sales?.kind).toBe(BpmnElementKind.Lane);
        if (sales?.kind === BpmnElementKind.Lane) {
            expect(sales.flowNodeRefs).toEqual(["Task_A"]);
        }
    });

    it("preserves lane membership on flow nodes", () => {
        expect(after.nodes["Task_A"]?.parentRef).toBe("Lane_S");
        expect(after.nodes["Task_B"]?.parentRef).toBe("Lane_O");
    });

    it("preserves message flow as a separate flow kind", () => {
        const mf = after.flows["MF1"];
        expect(mf?.kind).toBe(BpmnFlowKind.Message);
        expect(mf?.sourceRef).toBe("Task_A");
        expect(mf?.targetRef).toBe("Task_B");
    });

    it("starts with no laneSet-vs-flowNodes order sensitivity", () => {
        // Sanity: the input model and the after-round-trip model are structurally equivalent.
        expect(Object.keys(after.nodes).sort()).toEqual(Object.keys(before.nodes).sort());
    });
});

describe("BPMN round-trip: foreign-namespace extensions", () => {
    const after = roundTrip(WITH_EXTENSIONS);

    it("preserves foreign attribute (camunda:assignee) on task", () => {
        const ext = after.nodes["TaskX"]?.extensions;
        const found = ext?.attrs?.find(a => a.qname === "camunda:assignee");
        expect(found?.value).toBe("${initiator}");
    });

    it("preserves all three foreign-namespace children inside extensionElements", () => {
        const ext = after.nodes["TaskX"]?.extensions;
        const xmls = ext?.children?.map(c => c.xml) ?? [];
        expect(xmls.some(x => x.includes("zeebe:assignmentDefinition"))).toBe(true);
        expect(xmls.some(x => x.includes("camunda:formData"))).toBe(true);
        expect(xmls.some(x => x.includes("acme:metadata"))).toBe(true);
    });

    it("preserves the foreign attribute on process", () => {
        const found = after.processes["Pp"]?.extensions?.attrs?.find(a => a.qname === "camunda:historyTimeToLive");
        expect(found?.value).toBe("30");
    });
});

describe("BPMN round-trip: event definitions", () => {
    const after = roundTrip(WITH_EVENT_DEFINITIONS);

    it("preserves message start event", () => {
        const e = after.nodes["MStart"];
        if (e?.kind === BpmnElementKind.StartEvent) expect(e.eventDefinition).toBe(BpmnEventDefinition.Message);
    });

    it("preserves timer intermediate catch event", () => {
        const e = after.nodes["TCatch"];
        if (e?.kind === BpmnElementKind.IntermediateCatchEvent) expect(e.eventDefinition).toBe(BpmnEventDefinition.Timer);
    });

    it("preserves terminate end event", () => {
        const e = after.nodes["TermEnd"];
        if (e?.kind === BpmnElementKind.EndEvent) expect(e.eventDefinition).toBe(BpmnEventDefinition.Terminate);
    });
});

describe("BPMN round-trip: namespace prefix preservation", () => {
    it("retains custom namespace prefixes used in source", () => {
        const xml = `<?xml version="1.0"?>
<b:definitions xmlns:b="http://www.omg.org/spec/BPMN/20100524/MODEL" id="X">
  <b:process id="P"><b:startEvent id="S"/></b:process>
</b:definitions>`;
        const exported = exportBpmnDiagram(importBpmnDiagram(xml, xmldomOpts));
        // The original prefix "b" should survive round-trip in re-emitted XML.
        expect(exported).toMatch(/<b:definitions\b/);
        expect(exported).toMatch(/<b:process\b/);
        expect(exported).toMatch(/<b:startEvent\b/);
    });
});

describe("BPMN round-trip: no-DI input emits no BPMNDI section", () => {
    it("omits BPMNDiagram when hasLayout is false", () => {
        const xml = `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="P"><bpmn:startEvent id="S"/></bpmn:process></bpmn:definitions>`;
        const exported = exportBpmnDiagram(importBpmnDiagram(xml, xmldomOpts));
        expect(exported).not.toMatch(/BPMNDiagram/);
    });
});
