import type {Bounds} from "./bounds.js";
import type {Diagram} from "./diagram.js";
import type {Id} from "./element.js";
import type {ColorSchema, DiagramElement, LineStyle} from "./types.js";

/**
 * Sequence-diagram state read by doodles-layout and doodles-svg. Mirrors the
 * shape clouddiagram's editor uses so the same importers and SVG renderer can
 * serve both an interactive editor and a static SVG embed.
 */

export type LifelineId = Id;
export type MessageId = Id;
export type ActivationId = Id;

export interface LifelinePlacement {
    /** Top rectangle ("head") that displays the participant title. */
    headBounds: Bounds;
    /** Top offset (px) of the dashed vertical lifeline relative to the head bottom. */
    lifelineStart: number;
    /** Bottom y (px) the dashed vertical lifeline extends to, in diagram coords. */
    lifelineEnd: number;
}

export interface LifelineState extends DiagramElement {
    title: string;
    activations: ActivationId[];
    placement: LifelinePlacement;
    colorSchema: ColorSchema;
}

export interface ActivationState extends DiagramElement {
    lifelineId: LifelineId;
    /** Top offset (px) along the parent lifeline's vertical line. */
    start: number;
    /** Vertical length (px) of the activation bar. */
    length: number;
}

export interface MessageState extends DiagramElement {
    /** Source activation id (the one drawing the arrow). */
    activation1: ActivationId;
    /** Target activation id (the one receiving the arrow). */
    activation2: ActivationId;
    text: string;
    /** Dashed-line return message (`-->>` / `-->`). */
    isReturn: boolean;
    /** Open V-tip arrow (`->>`/`-->>`); when false, draw a solid filled triangle. */
    isAsync: boolean;
    /** Vertical offset (px) of this message from the previous message / lifeline top. */
    sourceActivationOffset: number;
    lineStyle: LineStyle;
}

/**
 * The render-ready shape of a sequence diagram. Importers emit this; the
 * sequence layout pass refines size; doodles-svg consumes it.
 */
export interface SequenceDiagramState extends Diagram {
    lifelines: {[id: LifelineId]: LifelineState};
    messages: {[id: MessageId]: MessageState};
    activations: {[id: ActivationId]: ActivationState};
}
