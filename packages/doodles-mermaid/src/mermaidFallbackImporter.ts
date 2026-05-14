import {type Diagram, ElementType, defaultColorSchema} from "@benkalegin/doodles-core";
import {createMermaidIdGenerator} from "./mermaidImportUtils.js";
import type {MermaidDiagramTypeDefinition} from "./mermaidImportTypes.js";

const STRUCTURE_LIKE_KINDS = new Set<ElementType>([
    ElementType.ClassDiagram,
    ElementType.DeploymentDiagram,
    ElementType.ErDiagram,
    ElementType.FlowchartDiagram,
    ElementType.GanttDiagram,
    ElementType.MindMapDiagram,
]);

function isStructureLikeDiagramType(type: ElementType): boolean {
    return STRUCTURE_LIKE_KINDS.has(type);
}

export function importMermaidSourceAsNote(
    baseDiagram: Diagram,
    content: string,
    type: MermaidDiagramTypeDefinition | undefined
): Diagram {
    const generateId = createMermaidIdGenerator();
    const title = type ? `${type.name} Mermaid source` : "Mermaid source";
    const noteText = `${title}\n\n${content.trim()}`;
    const noteId = generateId();

    const fallbackDiagram: any = {
        ...baseDiagram,
        notes: {
            [noteId]: {
                id: noteId,
                type: ElementType.Note,
                text: noteText,
                bounds: {x: 80, y: 80, width: 640, height: 360},
                colorSchema: defaultColorSchema
            }
        },
        selectedElements: [],
        display: {
            ...baseDiagram.display,
            width: Math.max(baseDiagram.display.width, 900),
            height: Math.max(baseDiagram.display.height, 600),
            offset: {x: 0, y: 0}
        }
    };

    if (isStructureLikeDiagramType(baseDiagram.type)) {
        fallbackDiagram.elements = {};
        fallbackDiagram.nodes = {};
        fallbackDiagram.ports = {};
        fallbackDiagram.links = {};
    }

    if (baseDiagram.type === ElementType.SequenceDiagram) {
        fallbackDiagram.lifelines = {};
        fallbackDiagram.messages = {};
        fallbackDiagram.activations = {};
    }

    return fallbackDiagram;
}
