import {type Diagram, defaultDiagramDisplay, ElementType, type Id} from "@benkalegin/doodles-core";

/**
 * Minimal Diagram base used as input to the Mermaid importer in tests.
 * Mirrors what cd's `createDiagramForType` does but without pulling in any
 * editor state.
 */
export function createDoodleForType(type: ElementType, id: Id): Diagram {
    return {
        id,
        type,
        display: defaultDiagramDisplay,
    };
}
