/**
 * The four namespaces doodles-bpmn understands natively. Anything outside this
 * set is treated as a foreign extension and passed through verbatim for
 * lossless round-trip.
 */

export const BPMN_NS = "http://www.omg.org/spec/BPMN/20100524/MODEL";
export const BPMNDI_NS = "http://www.omg.org/spec/BPMN/20100524/DI";
export const DC_NS = "http://www.omg.org/spec/DD/20100524/DC";
export const DI_NS = "http://www.omg.org/spec/DD/20100524/DI";

export const OWNED_NAMESPACES: ReadonlySet<string> = new Set([BPMN_NS, BPMNDI_NS, DC_NS, DI_NS]);
