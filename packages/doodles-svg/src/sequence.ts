import type {
    ActivationState,
    LifelineState,
    MessageState,
    SequenceDiagramState,
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
    // of the lifeline, then messages last so the arrows sit above everything.
    for (const lifeline of Object.values(diagram.lifelines)) {
        layers.push(renderLifeline(lifeline, theme));
        for (const activationId of lifeline.activations) {
            const activation = diagram.activations[activationId];
            if (activation) layers.push(renderActivation(lifeline, activation, theme));
        }
    }

    for (const message of Object.values(diagram.messages)) {
        const rendered = renderMessage(message, diagram, theme);
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
    return line + tip + label;
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

// Re-export to satisfy the unused-import warning for xmlEscape when this file
// is extended with note rendering (notes need direct text escaping outside
// richTextSvg).
void xmlEscape;
