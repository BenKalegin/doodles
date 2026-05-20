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
export type NoteId = Id;
export type FrameId = Id;

/**
 * Anchor describing where a sticky note attaches to the lifeline grid.
 *   over            — centered over the listed lifelines (one or two)
 *   leftOf          — to the left of a single lifeline's head
 *   rightOf         — to the right of a single lifeline's head
 */
export const NoteAnchor = {
    Over: "over",
    LeftOf: "leftOf",
    RightOf: "rightOf",
} as const;
export type NoteAnchor = (typeof NoteAnchor)[keyof typeof NoteAnchor];

export interface NoteState extends DiagramElement {
    anchor: NoteAnchor;
    /** Lifelines the note attaches to (1 entry for leftOf/rightOf; 1-2 for over). */
    lifelineIds: LifelineId[];
    text: string;
    /** Vertical offset (px) of the note from the lifeline head top — same axis as messages. */
    sourceActivationOffset: number;
}

/**
 * Frame kinds Mermaid renders as labeled enclosing rectangles around message
 * groups. v1 covers the four canonical ones; rect/critical/break can land
 * later by adding new kinds without changing the renderer's contract.
 */
export const FrameKind = {
    Alt: "alt",
    Opt: "opt",
    Loop: "loop",
    Par: "par",
} as const;
export type FrameKind = (typeof FrameKind)[keyof typeof FrameKind];

export interface FrameSection {
    /** Label for this section — first section uses the frame's main label; subsequent are else/and labels. */
    label: string;
    /** Vertical offset (px, on the message axis) where this section begins. */
    startOffset: number;
}

export interface FrameState extends DiagramElement {
    kind: FrameKind;
    /** First section's label (the one declared on the opening keyword). */
    label: string;
    /** Sections in declaration order — always at least one (the primary). */
    sections: FrameSection[];
    /** Vertical offset (px) where the frame opens, relative to the lifeline top. */
    startOffset: number;
    /** Vertical offset (px) where the frame closes. */
    endOffset: number;
    /** Lifeline ids whose horizontal positions determine the frame's left/right edges. */
    lifelineIds: LifelineId[];
}

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
    /**
     * Display number for this message when Mermaid `autonumber` is active.
     * Renderers draw it as a filled circle at the message origin. Undefined
     * for messages that fall under an `autonumber off` window.
     */
    sequenceNumber?: number;
}

/**
 * The render-ready shape of a sequence diagram. Importers emit this; the
 * sequence layout pass refines size; doodles-svg consumes it.
 */
export interface SequenceDiagramState extends Diagram {
    lifelines: {[id: LifelineId]: LifelineState};
    messages: {[id: MessageId]: MessageState};
    activations: {[id: ActivationId]: ActivationState};
    notes: {[id: NoteId]: NoteState};
    frames: {[id: FrameId]: FrameState};
}
