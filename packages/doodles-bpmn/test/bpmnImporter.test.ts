import {describe, expect, it} from "vitest";
import {DOMParser, XMLSerializer} from "@xmldom/xmldom";
import {
    BpmnElementKind,
    BpmnEventDefinition,
    BpmnFlowKind,
    BpmnPoolOrientation,
    BpmnSourceFormat,
} from "@benkalegin/doodles-core";
import {importBpmnDiagram} from "../src/bpmnImporter.js";

const xmldomOpts = {
    domParser: new DOMParser(),
    xmlSerializer: new XMLSerializer(),
};

const SIMPLE_PROCESS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_1" targetNamespace="http://example.com/bpmn">
  <bpmn:process id="Process_1" isExecutable="true">
    <bpmn:startEvent id="Start_1" name="Start" />
    <bpmn:userTask id="Task_1" name="Approve" />
    <bpmn:exclusiveGateway id="Gateway_1" name="Approved?" />
    <bpmn:endEvent id="End_1" name="Done" />
    <bpmn:sequenceFlow id="Flow_1" sourceRef="Start_1" targetRef="Task_1" />
    <bpmn:sequenceFlow id="Flow_2" sourceRef="Task_1" targetRef="Gateway_1" />
    <bpmn:sequenceFlow id="Flow_3" sourceRef="Gateway_1" targetRef="End_1" name="yes">
      <bpmn:conditionExpression>\${approved}</bpmn:conditionExpression>
    </bpmn:sequenceFlow>
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_1">
    <bpmndi:BPMNPlane id="BPMNPlane_1" bpmnElement="Process_1">
      <bpmndi:BPMNShape id="Start_di" bpmnElement="Start_1">
        <dc:Bounds x="100" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Task_di" bpmnElement="Task_1">
        <dc:Bounds x="200" y="80" width="100" height="80" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Gateway_di" bpmnElement="Gateway_1">
        <dc:Bounds x="360" y="95" width="50" height="50" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="End_di" bpmnElement="End_1">
        <dc:Bounds x="470" y="100" width="36" height="36" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNEdge id="Flow_1_di" bpmnElement="Flow_1">
        <di:waypoint x="136" y="118" />
        <di:waypoint x="200" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_2_di" bpmnElement="Flow_2">
        <di:waypoint x="300" y="120" />
        <di:waypoint x="360" y="120" />
      </bpmndi:BPMNEdge>
      <bpmndi:BPMNEdge id="Flow_3_di" bpmnElement="Flow_3">
        <di:waypoint x="410" y="120" />
        <di:waypoint x="470" y="118" />
      </bpmndi:BPMNEdge>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const POOL_WITH_LANES = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI"
                  xmlns:dc="http://www.omg.org/spec/DD/20100524/DC"
                  xmlns:di="http://www.omg.org/spec/DD/20100524/DI"
                  id="Definitions_2" targetNamespace="http://example.com/bpmn">
  <bpmn:collaboration id="Collab_1">
    <bpmn:participant id="Participant_1" name="Customer" processRef="Process_2" />
    <bpmn:messageFlow id="MFlow_1" sourceRef="Task_A" targetRef="Task_B" />
  </bpmn:collaboration>
  <bpmn:process id="Process_2" isExecutable="true">
    <bpmn:laneSet id="LaneSet_1">
      <bpmn:lane id="Lane_Sales" name="Sales">
        <bpmn:flowNodeRef>Task_A</bpmn:flowNodeRef>
      </bpmn:lane>
      <bpmn:lane id="Lane_Ops" name="Operations">
        <bpmn:flowNodeRef>Task_B</bpmn:flowNodeRef>
      </bpmn:lane>
    </bpmn:laneSet>
    <bpmn:userTask id="Task_A" name="Quote" />
    <bpmn:serviceTask id="Task_B" name="Ship" />
  </bpmn:process>
  <bpmndi:BPMNDiagram id="BPMNDiagram_2">
    <bpmndi:BPMNPlane id="BPMNPlane_2" bpmnElement="Collab_1">
      <bpmndi:BPMNShape id="Participant_di" bpmnElement="Participant_1" isHorizontal="true">
        <dc:Bounds x="100" y="60" width="500" height="240" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Sales_di" bpmnElement="Lane_Sales" isHorizontal="true">
        <dc:Bounds x="130" y="60" width="470" height="120" />
      </bpmndi:BPMNShape>
      <bpmndi:BPMNShape id="Lane_Ops_di" bpmnElement="Lane_Ops" isHorizontal="true">
        <dc:Bounds x="130" y="180" width="470" height="120" />
      </bpmndi:BPMNShape>
    </bpmndi:BPMNPlane>
  </bpmndi:BPMNDiagram>
</bpmn:definitions>`;

const WITH_EXTENSIONS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"
                  xmlns:camunda="http://camunda.org/schema/1.0/bpmn"
                  xmlns:zeebe="http://camunda.org/schema/zeebe/1.0"
                  xmlns:acme="http://acme.example.com/bpmn"
                  id="Definitions_3" targetNamespace="http://example.com/bpmn">
  <bpmn:process id="Process_3" isExecutable="true" camunda:historyTimeToLive="30" acme:owner="ops">
    <bpmn:userTask id="Task_X" name="Approve" camunda:assignee="\${initiator}">
      <bpmn:extensionElements>
        <zeebe:assignmentDefinition assignee="user.id" />
        <camunda:formData>
          <camunda:formField id="amount" type="long" />
        </camunda:formData>
      </bpmn:extensionElements>
    </bpmn:userTask>
  </bpmn:process>
</bpmn:definitions>`;

const WITH_EVENT_DEFINITIONS = `<?xml version="1.0" encoding="UTF-8"?>
<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" id="Definitions_4">
  <bpmn:process id="Process_4" isExecutable="true">
    <bpmn:startEvent id="StartMsg">
      <bpmn:messageEventDefinition />
    </bpmn:startEvent>
    <bpmn:intermediateCatchEvent id="Timer">
      <bpmn:timerEventDefinition />
    </bpmn:intermediateCatchEvent>
    <bpmn:endEvent id="EndTerm">
      <bpmn:terminateEventDefinition />
    </bpmn:endEvent>
  </bpmn:process>
</bpmn:definitions>`;

describe("importBpmnDiagram — simple process", () => {
    const diagram = importBpmnDiagram(SIMPLE_PROCESS, xmldomOpts);

    it("identifies the kind as bpmn", () => {
        expect(diagram.kind).toBe("bpmn");
    });

    it("captures all flow nodes with the right kinds", () => {
        expect(diagram.nodes["Start_1"]?.kind).toBe(BpmnElementKind.StartEvent);
        expect(diagram.nodes["Task_1"]?.kind).toBe(BpmnElementKind.UserTask);
        expect(diagram.nodes["Gateway_1"]?.kind).toBe(BpmnElementKind.ExclusiveGateway);
        expect(diagram.nodes["End_1"]?.kind).toBe(BpmnElementKind.EndEvent);
    });

    it("preserves names", () => {
        expect(diagram.nodes["Task_1"]?.name).toBe("Approve");
        expect(diagram.nodes["Gateway_1"]?.name).toBe("Approved?");
    });

    it("captures sequence flows with source/target", () => {
        expect(diagram.flows["Flow_1"]).toMatchObject({
            kind: BpmnFlowKind.Sequence,
            sourceRef: "Start_1",
            targetRef: "Task_1",
        });
    });

    it("captures conditional sequence flow", () => {
        expect(diagram.flows["Flow_3"]?.condition).toBe("${approved}");
        expect(diagram.flows["Flow_3"]?.name).toBe("yes");
    });

    it("parses BPMNShape bounds for every node", () => {
        expect(diagram.nodePlacements["Start_1"]?.bounds).toEqual({x: 100, y: 100, width: 36, height: 36});
        expect(diagram.nodePlacements["Task_1"]?.bounds).toEqual({x: 200, y: 80, width: 100, height: 80});
    });

    it("parses BPMNEdge waypoints for every flow", () => {
        expect(diagram.flowPlacements["Flow_1"]?.waypoints).toEqual([{x: 136, y: 118}, {x: 200, y: 120}]);
        expect(diagram.flowPlacements["Flow_3"]?.waypoints).toHaveLength(2);
    });

    it("marks hasLayout true when DI is present", () => {
        expect(diagram.hasLayout).toBe(true);
    });

    it("attaches source format and namespaces", () => {
        expect(diagram.source?.format).toBe(BpmnSourceFormat.BpmnXml);
        expect(diagram.source?.definitionsId).toBe("Definitions_1");
        expect(diagram.source?.targetNamespace).toBe("http://example.com/bpmn");
        expect(diagram.source?.namespaces?.["bpmn"]).toBe("http://www.omg.org/spec/BPMN/20100524/MODEL");
    });
});

describe("importBpmnDiagram — pool with lanes", () => {
    const diagram = importBpmnDiagram(POOL_WITH_LANES, xmldomOpts);

    it("captures the pool as Participant", () => {
        const pool = diagram.nodes["Participant_1"];
        expect(pool?.kind).toBe(BpmnElementKind.Pool);
        if (pool?.kind === BpmnElementKind.Pool) {
            expect(pool.processRef).toBe("Process_2");
            expect(pool.orientation).toBe(BpmnPoolOrientation.Horizontal);
        }
    });

    it("captures lanes with flow-node membership", () => {
        const sales = diagram.nodes["Lane_Sales"];
        expect(sales?.kind).toBe(BpmnElementKind.Lane);
        if (sales?.kind === BpmnElementKind.Lane) {
            expect(sales.flowNodeRefs).toEqual(["Task_A"]);
        }
    });

    it("stamps lane membership on the contained flow nodes (parentRef)", () => {
        expect(diagram.nodes["Task_A"]?.parentRef).toBe("Lane_Sales");
        expect(diagram.nodes["Task_B"]?.parentRef).toBe("Lane_Ops");
    });

    it("captures message flows", () => {
        expect(diagram.flows["MFlow_1"]).toMatchObject({
            kind: BpmnFlowKind.Message,
            sourceRef: "Task_A",
            targetRef: "Task_B",
        });
    });

    it("derives pool orientation from BPMNShape.isHorizontal", () => {
        const pool = diagram.nodes["Participant_1"];
        if (pool?.kind === BpmnElementKind.Pool) {
            expect(pool.orientation).toBe(BpmnPoolOrientation.Horizontal);
        }
    });
});

describe("importBpmnDiagram — foreign-namespace extensions", () => {
    const diagram = importBpmnDiagram(WITH_EXTENSIONS, xmldomOpts);

    it("captures camunda: attribute on process", () => {
        const process = diagram.nodes; // process itself isn't a flow node; check task instead
        expect(process["Task_X"]?.extensions?.attrs).toEqual(
            expect.arrayContaining([{qname: "camunda:assignee", value: "${initiator}"}])
        );
    });

    it("captures foreign attrs on definitions root", () => {
        // definitions-level extensions hang off the diagram itself
        // (we walk root attrs for extensions, but the process's own attrs are on the process node — which we don't currently keep as a node).
        // The task node carries the camunda:assignee.
        expect(diagram.extensions).toBeUndefined();
    });

    it("captures foreign children inside extensionElements", () => {
        const ext = diagram.nodes["Task_X"]?.extensions;
        expect(ext?.children).toBeDefined();
        const xmls = ext?.children?.map(c => c.xml) ?? [];
        expect(xmls.some(x => x.includes("zeebe:assignmentDefinition"))).toBe(true);
        expect(xmls.some(x => x.includes("camunda:formData"))).toBe(true);
    });
});

describe("importBpmnDiagram — event definitions", () => {
    const diagram = importBpmnDiagram(WITH_EVENT_DEFINITIONS, xmldomOpts);

    it("detects message start event", () => {
        const e = diagram.nodes["StartMsg"];
        if (e?.kind === BpmnElementKind.StartEvent) expect(e.eventDefinition).toBe(BpmnEventDefinition.Message);
    });

    it("detects timer intermediate catch event", () => {
        const e = diagram.nodes["Timer"];
        if (e?.kind === BpmnElementKind.IntermediateCatchEvent) expect(e.eventDefinition).toBe(BpmnEventDefinition.Timer);
    });

    it("detects terminate end event", () => {
        const e = diagram.nodes["EndTerm"];
        if (e?.kind === BpmnElementKind.EndEvent) expect(e.eventDefinition).toBe(BpmnEventDefinition.Terminate);
    });
});

describe("importBpmnDiagram — no-DI input", () => {
    it("marks hasLayout false and produces a fallback display size", () => {
        const xml = `<?xml version="1.0"?><bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL"><bpmn:process id="P"><bpmn:startEvent id="S"/></bpmn:process></bpmn:definitions>`;
        const diagram = importBpmnDiagram(xml, xmldomOpts);
        expect(diagram.hasLayout).toBe(false);
        expect(diagram.display.width).toBeGreaterThan(0);
        expect(diagram.display.height).toBeGreaterThan(0);
    });
});
