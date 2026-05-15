import type {Diagram} from "@benkalegin/doodles-core";
import {canRelayoutStructure, relayoutStructure} from "@benkalegin/doodles-layout";
import {importMermaidFlowchartDiagram} from "./mermaidStructureImporter.js";
import {parseMermaidLayoutHints} from "./mermaidImportUtils.js";

/**
 * One-shot Mermaid flowchart import + polished layout. Use this when you want
 * a render-ready diagram from a Mermaid source — both the initial graph layout
 * and the filigree polish pass (port-alignment, cluster sizing, edge routing
 * hints) are applied. Callers who need to interleave their own post-import
 * transforms (e.g. AWS icon swapping in clouddiagram's deployment importer)
 * should keep using `importMermaidFlowchartDiagram` + `relayoutStructure`
 * directly so they can splice work between the two.
 */
export async function importMermaidFlowchartWithLayout<T extends Diagram>(
    baseDiagram: T,
    content: string,
): Promise<T> {
    const imported = await importMermaidFlowchartDiagram(baseDiagram, content) as T;
    if (!canRelayoutStructure(imported)) return imported;
    return relayoutStructure(imported, parseMermaidLayoutHints(content));
}
