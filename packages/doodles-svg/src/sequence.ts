import {
    type ActivationState,
    type FrameState,
    type LifelineState,
    type MessageState,
    NoteAnchor,
    type NoteState,
    type SequenceDiagramState,
} from "@benkalegin/doodles-core";
import {defaultLightTheme, type ThemeTokens} from "./theme.js";
import {xmlEscape} from "./escape.js";
import {parseRichText, richTextSvg} from "./text.js";

export interface SequenceRenderOptions {
    theme?: ThemeTokens;
    /** Extra padding around the diagram bounding box (added to viewBox). Defaults to 24. */
    padding?: number;
}

// Visual constants — picked to read at the same scale as the flowchart
// renderer (1.5px strokes, system-ui fonts inherited from the theme).
const HEAD_STROKE_WIDTH = 1.5;
const HEAD_ACCENT_FILL_OPACITY = 0.12;
const LIFELINE_STROKE_WIDTH = 1;
const LIFELINE_DASH = "5 3";
const LIFELINE_OPACITY = 0.5;
// Activation bar width — narrow enough that a horizontal break in the bar
// reads as a clean separator between sync and async call segments on the
// same lifeline (the whole reason we draw a bar at all instead of a single
// line like elk/dagre exports).
const ACTIVATION_WIDTH = 8;
const ACTIVATION_FILL_OPACITY = 0.2;
const MESSAGE_STROKE_WIDTH = 1.5;
const MESSAGE_DASH = "5 4";
const ARROW_TIP_LENGTH = 11;
const ARROW_TIP_WIDTH = 8;
const ASYNC_TIP_LENGTH = ARROW_TIP_LENGTH;
const SYNC_TIP_LENGTH = ARROW_TIP_LENGTH * 0.8;
const MESSAGE_TEXT_LIFT_PX = 6;
const HEAD_RECT_CORNER_RADIUS = 4;
// Autonumber bubble — a small filled accent circle holding the sequence
// number at the message origin. Sized to fit two-digit numbers comfortably.
const SEQUENCE_NUMBER_RADIUS = 10;
const SEQUENCE_NUMBER_FONT_SIZE = 11;
// Sticky-note geometry. Notes drawn inline at the message origin between
// preceding and following messages.
const NOTE_PADDING_X = 12;
const NOTE_PADDING_Y = 10;
const NOTE_MIN_WIDTH = 80;
const NOTE_DEFAULT_HEIGHT = 32;
const NOTE_SIDE_GAP = 14;
const NOTE_CHAR_WIDTH = 7;
// Soft yellow sticky-note fill. Host can override by setting the
// `--doodles-note-fill` and `--doodles-note-stroke` CSS variables on a
// surrounding ancestor (the values inherit through the SVG).
const NOTE_FILL = "var(--doodles-note-fill, #fff5ad)";
const NOTE_STROKE = "var(--doodles-note-stroke, #b8a200)";
const NOTE_TEXT_COLOR = "var(--doodles-note-text, #3a2f00)";
// Frame styling — thin neutral border with a small tab in the top-left
// holding the frame kind + label. Drawn behind messages so they overlay
// the edges where needed.
const FRAME_HORIZONTAL_PADDING = 16;
const FRAME_BORDER_OPACITY = 0.6;
const FRAME_TAB_HEIGHT = 22;
const FRAME_TAB_PADDING_X = 8;
const FRAME_TAB_PADDING_Y = 4;
const FRAME_TAB_FONT_SIZE = 12;
const FRAME_TAB_KIND_GAP = 6;
const FRAME_TAB_CHAR_WIDTH = 7;
const FRAME_SECTION_DIVIDER_DASH = "6 4";

/**
 * Render a SequenceDiagramState to an SVG string. v1 covers participants /
 * actors and arrow messages — the syntax clouddiagram's mermaid sequence
 * importer accepts today. Notes, loop/alt/opt frames, activate/deactivate
 * spans, and `autonumber` will land in follow-ups.
 */
export function renderSequenceSvg(
    diagram: SequenceDiagramState,
    options: SequenceRenderOptions = {},
): string {
    const theme = options.theme ?? defaultLightTheme;
    const padding = options.padding ?? 24;

    const width = diagram.display.width;
    const height = diagram.display.height;
    const viewBox = `${-padding} ${-padding} ${width + padding * 2} ${height + padding * 2}`;

    const layers: string[] = [];

    // Lifelines first (head rect + dashed vertical), then activations on top
    // of the lifeline, then frames behind messages so arrows can overlap
    // frame borders cleanly, then messages and notes on top.
    for (const lifeline of Object.values(diagram.lifelines)) {
        layers.push(renderLifeline(lifeline, theme));
        for (const activationId of lifeline.activations) {
            const activation = diagram.activations[activationId];
            if (activation) layers.push(renderActivation(lifeline, activation, theme));
        }
    }

    for (const frame of Object.values(diagram.frames)) {
        const rendered = renderFrame(frame, diagram, theme);
        if (rendered) layers.push(rendered);
    }

    for (const message of Object.values(diagram.messages)) {
        const rendered = renderMessage(message, diagram, theme);
        if (rendered) layers.push(rendered);
    }

    for (const note of Object.values(diagram.notes)) {
        const rendered = renderNote(note, diagram, theme);
        if (rendered) layers.push(rendered);
    }

    const bg = theme.colors.background !== "transparent"
        ? `<rect x="${-padding}" y="${-padding}" width="${width + padding * 2}" height="${height + padding * 2}" fill="${theme.colors.background}" />`
        : "";

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="${width + padding * 2}" height="${height + padding * 2}">${bg}${layers.join("")}</svg>`;
}

function renderLifeline(lifeline: LifelineState, theme: ThemeTokens): string {
    const {headBounds, lifelineEnd} = lifeline.placement;
    const headStroke = theme.colors.accentStroke ?? lifeline.colorSchema.strokeColor ?? theme.colors.nodeStroke;
    const headFillRaw = theme.colors.accentFill ?? lifeline.colorSchema.fillColor ?? theme.colors.nodeFill;
    const headText = theme.colors.accentText ?? lifeline.colorSchema.textColor ?? theme.colors.nodeText;
    const lifelineStroke = lifeline.colorSchema.strokeColor || theme.colors.nodeStroke;

    // Accent fill is rendered as a tint over the host background so the
    // accent stroke remains the dominant visual element — matches mermaid's
    // default header treatment where the head reads as a colored outline
    // around a barely-tinted surface.
    const headFillAttrs = headFillRaw === "transparent"
        ? `fill="${headStroke}" fill-opacity="${HEAD_ACCENT_FILL_OPACITY}"`
        : `fill="${headFillRaw}"`;
    const headRect = `<rect x="${headBounds.x}" y="${headBounds.y}" width="${headBounds.width}" height="${headBounds.height}" rx="${HEAD_RECT_CORNER_RADIUS}" ${headFillAttrs} stroke="${headStroke}" stroke-width="${HEAD_STROKE_WIDTH}" />`;

    const lines = parseRichText(lifeline.title);
    const labelText = richTextSvg(
        lines,
        headBounds.x + headBounds.width / 2,
        headBounds.y + headBounds.height / 2,
        theme.font.family,
        theme.font.size,
        theme.font.lineHeight,
        headText,
    );

    // Dashed vertical lifeline drops from the bottom of the head down to
    // lifelineEnd. Rendered at reduced opacity so the head + messages stay
    // dominant — matches the mermaid default where the lifeline is a faint
    // guide rather than a structural line.
    const lifelineX = headBounds.x + headBounds.width / 2;
    const lifelineTop = headBounds.y + headBounds.height;
    const verticalLine = `<line x1="${lifelineX}" y1="${lifelineTop}" x2="${lifelineX}" y2="${lifelineEnd}" stroke="${lifelineStroke}" stroke-opacity="${LIFELINE_OPACITY}" stroke-width="${LIFELINE_STROKE_WIDTH}" stroke-dasharray="${LIFELINE_DASH}" />`;

    return headRect + labelText + verticalLine;
}

function renderActivation(
    lifeline: LifelineState,
    activation: ActivationState,
    theme: ThemeTokens,
): string {
    const {headBounds, lifelineStart} = lifeline.placement;
    // Activation bars echo the head accent so the connection between a
    // participant's head box and its active call windows reads at a glance.
    const stroke = theme.colors.accentStroke ?? lifeline.colorSchema.strokeColor ?? theme.colors.nodeStroke;
    const tintFill = theme.colors.accentFill ?? lifeline.colorSchema.fillColor ?? theme.colors.nodeFill;

    const x = headBounds.x + headBounds.width / 2 - ACTIVATION_WIDTH / 2;
    const y = headBounds.y + headBounds.height + lifelineStart + activation.start;
    const fillAttrs = tintFill === "transparent"
        ? `fill="${stroke}" fill-opacity="${ACTIVATION_FILL_OPACITY}"`
        : `fill="${tintFill}"`;

    return `<rect x="${x}" y="${y}" width="${ACTIVATION_WIDTH}" height="${activation.length}" ${fillAttrs} stroke="${stroke}" stroke-width="${HEAD_STROKE_WIDTH}" />`;
}

interface MessageGeometry {
    fromX: number;
    toX: number;
    y: number;
    label: string;
}

function computeMessageGeometry(
    message: MessageState,
    diagram: SequenceDiagramState,
): MessageGeometry | undefined {
    const fromActivation = diagram.activations[message.activation1];
    const toActivation = diagram.activations[message.activation2];
    if (!fromActivation || !toActivation) return undefined;

    const fromLifeline = diagram.lifelines[fromActivation.lifelineId];
    const toLifeline = diagram.lifelines[toActivation.lifelineId];
    if (!fromLifeline || !toLifeline) return undefined;

    const fromCenterX = fromLifeline.placement.headBounds.x + fromLifeline.placement.headBounds.width / 2;
    const toCenterX = toLifeline.placement.headBounds.x + toLifeline.placement.headBounds.width / 2;

    // Activation bars are 12px wide centered on the lifeline. Attach the
    // arrow to the side of the bar that faces the other lifeline so the
    // tip doesn't draw on top of the activation box.
    const fromOnLeft = fromCenterX <= toCenterX;
    const fromX = fromOnLeft ? fromCenterX + ACTIVATION_WIDTH / 2 : fromCenterX - ACTIVATION_WIDTH / 2;
    const toX = fromOnLeft ? toCenterX - ACTIVATION_WIDTH / 2 : toCenterX + ACTIVATION_WIDTH / 2;

    // The importer fills `sourceActivationOffset` with the message's vertical
    // offset within the lifeline (already includes the LIFELINE_HEAD_Y +
    // lifelineStart base). Use the from-lifeline as anchor; same y for both
    // ends because messages are horizontal in v1.
    const baseY = fromLifeline.placement.headBounds.y
        + fromLifeline.placement.headBounds.height
        + fromLifeline.placement.lifelineStart
        + message.sourceActivationOffset;

    return {fromX, toX, y: baseY, label: message.text};
}

function renderMessage(
    message: MessageState,
    diagram: SequenceDiagramState,
    theme: ThemeTokens,
): string | undefined {
    const geometry = computeMessageGeometry(message, diagram);
    if (!geometry) return undefined;

    const stroke = message.lineStyle.strokeColor || theme.colors.edgeStroke;
    const fill = message.isAsync ? "none" : (message.lineStyle.fillColor || stroke);
    const dashAttr = message.isReturn ? ` stroke-dasharray="${MESSAGE_DASH}"` : "";

    const line = `<line x1="${geometry.fromX}" y1="${geometry.y}" x2="${geometry.toX}" y2="${geometry.y}" stroke="${stroke}" stroke-width="${MESSAGE_STROKE_WIDTH}"${dashAttr} />`;

    const tip = renderArrowTip(geometry, message.isAsync, stroke, fill);
    const label = renderMessageLabel(geometry, theme);
    const number = message.sequenceNumber !== undefined
        ? renderSequenceNumber(geometry, message.sequenceNumber, theme)
        : "";
    return line + tip + label + number;
}

function renderSequenceNumber(
    geometry: MessageGeometry,
    sequenceNumber: number,
    theme: ThemeTokens,
): string {
    const cx = geometry.fromX;
    const cy = geometry.y;
    const bubbleStroke = theme.colors.accentStroke ?? theme.colors.edgeStroke;
    const bubbleFill = theme.colors.accentStroke ?? theme.colors.edgeStroke;
    const labelColor = theme.colors.background !== "transparent"
        ? theme.colors.background
        : "currentColor";
    const circle = `<circle cx="${cx}" cy="${cy}" r="${SEQUENCE_NUMBER_RADIUS}" fill="${bubbleFill}" stroke="${bubbleStroke}" />`;
    const text = `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${xmlEscape(theme.font.family)}" font-size="${SEQUENCE_NUMBER_FONT_SIZE}" font-weight="bold" fill="${labelColor}">${sequenceNumber}</text>`;
    return circle + text;
}

function renderArrowTip(
    geometry: MessageGeometry,
    isAsync: boolean,
    stroke: string,
    fill: string,
): string {
    const length = isAsync ? ASYNC_TIP_LENGTH : SYNC_TIP_LENGTH;
    const dx = geometry.toX - geometry.fromX;
    const direction = dx >= 0 ? 1 : -1;
    const tipX = geometry.toX;
    const tipY = geometry.y;
    const baseX = tipX - direction * length;
    const upperY = tipY - ARROW_TIP_WIDTH / 2;
    const lowerY = tipY + ARROW_TIP_WIDTH / 2;

    if (isAsync) {
        // Open V — two strokes, no fill — matches clouddiagram's async glyph.
        return `<polyline points="${baseX},${upperY} ${tipX},${tipY} ${baseX},${lowerY}" fill="none" stroke="${stroke}" stroke-width="${MESSAGE_STROKE_WIDTH}" stroke-linejoin="round" />`;
    }
    // Filled triangle for sync (and return) messages.
    return `<polygon points="${tipX},${tipY} ${baseX},${upperY} ${baseX},${lowerY}" fill="${fill}" stroke="${stroke}" stroke-width="${MESSAGE_STROKE_WIDTH}" stroke-linejoin="round" />`;
}

function frameYBase(diagram: SequenceDiagramState): number | undefined {
    const first = Object.values(diagram.lifelines)[0];
    if (!first) return undefined;
    return first.placement.headBounds.y
        + first.placement.headBounds.height
        + first.placement.lifelineStart;
}

function renderFrame(
    frame: FrameState,
    diagram: SequenceDiagramState,
    theme: ThemeTokens,
): string {
    if (frame.lifelineIds.length === 0) return "";
    const yBase = frameYBase(diagram);
    if (yBase === undefined) return "";

    let left = Infinity;
    let right = -Infinity;
    for (const id of frame.lifelineIds) {
        const lifeline = diagram.lifelines[id];
        if (!lifeline) continue;
        const head = lifeline.placement.headBounds;
        if (head.x < left) left = head.x;
        if (head.x + head.width > right) right = head.x + head.width;
    }
    if (!Number.isFinite(left) || !Number.isFinite(right)) return "";

    const frameLeft = left - FRAME_HORIZONTAL_PADDING;
    const frameRight = right + FRAME_HORIZONTAL_PADDING;
    const frameWidth = frameRight - frameLeft;
    const frameTop = yBase + frame.startOffset;
    const frameBottom = yBase + frame.endOffset;
    const frameHeight = Math.max(0, frameBottom - frameTop);

    const stroke = theme.colors.accentStroke ?? theme.colors.edgeStroke;
    const rect = `<rect x="${frameLeft}" y="${frameTop}" width="${frameWidth}" height="${frameHeight}" fill="none" stroke="${stroke}" stroke-opacity="${FRAME_BORDER_OPACITY}" stroke-width="1" />`;

    const tab = renderFrameTab(frame, frameLeft, frameTop, stroke, theme);
    const dividers = renderFrameSectionDividers(frame, frameLeft, frameWidth, yBase, stroke, theme);
    return rect + tab + dividers;
}

function renderFrameTab(
    frame: FrameState,
    frameLeft: number,
    frameTop: number,
    stroke: string,
    theme: ThemeTokens,
): string {
    const kindLabel = frame.kind;
    const fullLabel = frame.label;
    const kindWidth = kindLabel.length * FRAME_TAB_CHAR_WIDTH + FRAME_TAB_PADDING_X * 2;
    const tabRect = `<rect x="${frameLeft}" y="${frameTop}" width="${kindWidth}" height="${FRAME_TAB_HEIGHT}" fill="${stroke}" fill-opacity="${FRAME_BORDER_OPACITY}" stroke="${stroke}" stroke-opacity="${FRAME_BORDER_OPACITY}" stroke-width="1" />`;
    const fontFamily = xmlEscape(theme.font.family);
    const kindText = `<text x="${frameLeft + kindWidth / 2}" y="${frameTop + FRAME_TAB_HEIGHT / 2 + FRAME_TAB_PADDING_Y / 2}" text-anchor="middle" dominant-baseline="central" font-family="${fontFamily}" font-size="${FRAME_TAB_FONT_SIZE}" font-weight="bold" fill="${theme.colors.background !== "transparent" ? theme.colors.background : "currentColor"}">${xmlEscape(kindLabel)}</text>`;
    const labelText = fullLabel
        ? `<text x="${frameLeft + kindWidth + FRAME_TAB_KIND_GAP}" y="${frameTop + FRAME_TAB_HEIGHT / 2 + FRAME_TAB_PADDING_Y / 2}" text-anchor="start" dominant-baseline="central" font-family="${fontFamily}" font-size="${FRAME_TAB_FONT_SIZE}" font-style="italic" fill="${theme.colors.edgeText}">[${xmlEscape(fullLabel)}]</text>`
        : "";
    return tabRect + kindText + labelText;
}

function renderFrameSectionDividers(
    frame: FrameState,
    frameLeft: number,
    frameWidth: number,
    yBase: number,
    stroke: string,
    theme: ThemeTokens,
): string {
    // The first section is the frame's primary label and shares the header
    // tab — only sections 2+ get a horizontal divider with their own label.
    if (frame.sections.length <= 1) return "";
    const parts: string[] = [];
    const fontFamily = xmlEscape(theme.font.family);
    for (let i = 1; i < frame.sections.length; i++) {
        const section = frame.sections[i]!;
        const y = yBase + section.startOffset;
        parts.push(
            `<line x1="${frameLeft}" y1="${y}" x2="${frameLeft + frameWidth}" y2="${y}" stroke="${stroke}" stroke-opacity="${FRAME_BORDER_OPACITY}" stroke-width="1" stroke-dasharray="${FRAME_SECTION_DIVIDER_DASH}" />`,
        );
        if (section.label) {
            parts.push(
                `<text x="${frameLeft + FRAME_TAB_PADDING_X}" y="${y + FRAME_TAB_HEIGHT / 2}" text-anchor="start" dominant-baseline="central" font-family="${fontFamily}" font-size="${FRAME_TAB_FONT_SIZE}" font-style="italic" fill="${theme.colors.edgeText}">[${xmlEscape(section.label)}]</text>`,
            );
        }
    }
    return parts.join("");
}

function renderNote(
    note: NoteState,
    diagram: SequenceDiagramState,
    theme: ThemeTokens,
): string {
    if (note.lifelineIds.length === 0) return "";
    const firstLifeline = diagram.lifelines[note.lifelineIds[0]!];
    if (!firstLifeline) return "";

    const baseY = firstLifeline.placement.headBounds.y
        + firstLifeline.placement.headBounds.height
        + firstLifeline.placement.lifelineStart
        + note.sourceActivationOffset
        - NOTE_DEFAULT_HEIGHT / 2;

    const lines = note.text.split(/\n|<br\s*\/?>/i);
    const longestLineChars = lines.reduce((m, l) => l.length > m ? l.length : m, 0);
    const intrinsicWidth = Math.max(NOTE_MIN_WIDTH, longestLineChars * NOTE_CHAR_WIDTH + NOTE_PADDING_X * 2);
    const height = Math.max(NOTE_DEFAULT_HEIGHT, lines.length * theme.font.lineHeight + NOTE_PADDING_Y * 2);

    const {x, width} = noteBounds(note, diagram, intrinsicWidth);
    if (width <= 0) return "";

    const rect = `<rect x="${x}" y="${baseY}" width="${width}" height="${height}" rx="2" fill="${NOTE_FILL}" stroke="${NOTE_STROKE}" stroke-width="1" />`;
    const text = richTextSvg(
        parseRichText(note.text),
        x + width / 2,
        baseY + height / 2,
        theme.font.family,
        theme.font.size,
        theme.font.lineHeight,
        NOTE_TEXT_COLOR,
    );
    return rect + text;
}

interface NoteBounds {
    x: number;
    width: number;
}

function noteBounds(
    note: NoteState,
    diagram: SequenceDiagramState,
    intrinsicWidth: number,
): NoteBounds {
    const lifeline = diagram.lifelines[note.lifelineIds[0]!];
    if (!lifeline) return {x: 0, width: 0};
    const head = lifeline.placement.headBounds;
    const lifelineCenter = head.x + head.width / 2;

    if (note.anchor === NoteAnchor.LeftOf) {
        return {x: head.x - NOTE_SIDE_GAP - intrinsicWidth, width: intrinsicWidth};
    }
    if (note.anchor === NoteAnchor.RightOf) {
        return {x: head.x + head.width + NOTE_SIDE_GAP, width: intrinsicWidth};
    }

    // Over: optionally spans two lifelines. Width grows to cover both heads
    // (plus a small overhang) so the note visually brackets the lifelines.
    if (note.lifelineIds.length === 2) {
        const second = diagram.lifelines[note.lifelineIds[1]!];
        if (second) {
            const left = Math.min(head.x, second.placement.headBounds.x);
            const right = Math.max(
                head.x + head.width,
                second.placement.headBounds.x + second.placement.headBounds.width,
            );
            const span = right - left + NOTE_PADDING_X * 2;
            const width = Math.max(intrinsicWidth, span);
            return {x: (left + right) / 2 - width / 2, width};
        }
    }
    return {x: lifelineCenter - intrinsicWidth / 2, width: intrinsicWidth};
}

function renderMessageLabel(geometry: MessageGeometry, theme: ThemeTokens): string {
    if (!geometry.label) return "";
    const cx = (geometry.fromX + geometry.toX) / 2;
    const cy = geometry.y - MESSAGE_TEXT_LIFT_PX - theme.font.lineHeight / 2;
    // `xmlEscape` is implicitly applied inside richTextSvg via the parsed
    // spans; the only direct escape we need is for the message label that
    // doesn't carry inline HTML — parseRichText handles both cases.
    return richTextSvg(
        parseRichText(geometry.label),
        cx,
        cy,
        theme.font.family,
        theme.font.size,
        theme.font.lineHeight,
        theme.colors.edgeText,
    );
}

