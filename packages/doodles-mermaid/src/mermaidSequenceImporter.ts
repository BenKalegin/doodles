import {
    type ActivationState,
    type Diagram,
    ElementType,
    FrameKind,
    type FrameState,
    type LifelineState,
    type MessageState,
    NoteAnchor,
    type NoteState,
    type SequenceDiagramState,
    defaultColorSchema,
    defaultLineStyle,
    neutralColorSchema,
} from "@benkalegin/doodles-core";
import {createMermaidIdGenerator, mermaidSourceLines} from "./mermaidImportUtils.js";

// Geometry constants — picked to match clouddiagram's editor defaults so the
// inline preview and the visual-edit modal show comparable proportions.
const LIFELINE_HEAD_Y = 30;
const LIFELINE_HEAD_MIN_WIDTH = 100;
const LIFELINE_HEAD_MAX_WIDTH = 260;
const LIFELINE_HEAD_HEIGHT = 50;
// Per-glyph width estimate for sizing the head rect. Matches the flowchart
// importer's heuristic — close enough at 14px system-ui that long identifiers
// fit with light padding without measuring text.
const LIFELINE_LABEL_CHAR_WIDTH = 8;
const LIFELINE_LABEL_PADDING = 24;
const LIFELINE_HORIZONTAL_GAP = 40;
const LIFELINE_LEFT_MARGIN = 50;
const LIFELINE_START_OFFSET = 30;
const MESSAGE_VERTICAL_SPACING = 40;
const DEFAULT_DIAGRAM_HEIGHT = 300;
const FOOTER_PADDING_BELOW_LAST_MESSAGE = 100;
const DIAGRAM_BOTTOM_PADDING = 200;

function estimateHeadWidth(label: string): number {
    const pixels = label.length * LIFELINE_LABEL_CHAR_WIDTH + LIFELINE_LABEL_PADDING;
    return Math.min(LIFELINE_HEAD_MAX_WIDTH, Math.max(LIFELINE_HEAD_MIN_WIDTH, pixels));
}

const HEADER_RE = /^sequencediagram/i;
const PARTICIPANT_RE = /^participant\s+(\S+)(?:\s+as\s+(.+))?$/i;
const ACTOR_RE = /^actor\s+(\S+)(?:\s+as\s+(.+))?$/i;
// Capture both arrow tokens and message text. Supports:
//   A->B: msg      sync solid
//   A->>B: msg     sync solid (mermaid canonical)
//   A-->B: msg     return / dashed
//   A-->>B: msg    async dashed
//   A-)B: msg      async-open
const MESSAGE_RE = /^(\S+?)\s*(--?>>?|--?\)|--?>)\s*(\S+?)\s*:\s*(.*)$/;
// Mermaid autonumber forms:
//   autonumber            → start=1, step=1
//   autonumber 5          → start=5, step=1
//   autonumber 10 100     → start=10, step=100
//   autonumber off        → disable subsequent message numbering
const AUTONUMBER_OFF_RE = /^autonumber\s+off\s*$/i;
const AUTONUMBER_RE = /^autonumber(?:\s+(\d+))?(?:\s+(\d+))?\s*$/i;
const AUTONUMBER_DEFAULT_START = 1;
const AUTONUMBER_DEFAULT_STEP = 1;

// Mermaid note forms:
//   Note over A: text
//   Note over A,B: text
//   Note left of A: text
//   Note right of A: text
const NOTE_OVER_RE = /^note\s+over\s+([^:]+?)\s*:\s*(.*)$/i;
const NOTE_LEFT_RE = /^note\s+left\s+of\s+([^:]+?)\s*:\s*(.*)$/i;
const NOTE_RIGHT_RE = /^note\s+right\s+of\s+([^:]+?)\s*:\s*(.*)$/i;
const NOTE_VERTICAL_SLOT = 50;

// Mermaid frame block forms. The opening keyword captures the rest of the
// line as the frame's first-section label. `else` / `and` introduce
// subsequent sections; `end` closes the innermost frame.
const FRAME_OPEN_RE = /^(alt|opt|loop|par)\b\s*(.*)$/i;
const FRAME_ELSE_RE = /^else\b\s*(.*)$/i;
const FRAME_AND_RE = /^and\b\s*(.*)$/i;
const FRAME_END_RE = /^end\s*$/i;
const FRAME_HEADER_GAP = 30;
const FRAME_FOOTER_GAP = 20;
const FRAME_SECTION_GAP = 10;

/**
 * Import a Mermaid sequence diagram source into a SequenceDiagramState. Lines
 * we don't recognize (autonumber, loop/alt/opt, notes, activate/deactivate)
 * are silently skipped — v1 only handles the syntax the clouddiagram importer
 * accepts. The follow-up that adds `autonumber` lands at the TODO marker
 * below.
 */
export function importMermaidSequenceDiagram(
    baseDiagram: Diagram,
    content: string,
): SequenceDiagramState {
    const generateId = createMermaidIdGenerator();
    const lines = mermaidSourceLines(content);

    const headerLine = lines.find(l => HEADER_RE.test(l));
    if (!headerLine) {
        throw new Error("Not a valid Mermaid sequence diagram");
    }

    const lifelines: {[id: string]: LifelineState} = {};
    const messages: {[id: string]: MessageState} = {};
    const activations: {[id: string]: ActivationState} = {};
    const notes: {[id: string]: NoteState} = {};
    const frames: {[id: string]: FrameState} = {};
    const participantIdByName: {[name: string]: string} = {};
    const aliasToDisplayName: {[alias: string]: string} = {};
    let lifelineIndex = 0;
    let nextLifelineX = LIFELINE_LEFT_MARGIN;
    let messageOffset = 0;
    let autonumberCounter: number | null = null;
    let autonumberStep = AUTONUMBER_DEFAULT_STEP;

    // Track frame nesting. Each entry collects the set of lifelines its
    // children touch so we can size the rect to cover exactly the involved
    // participants when the frame closes.
    const frameStack: Array<{frameId: string; lifelineIds: Set<string>}> = [];
    function noteLifelineInFrames(lifelineId: string): void {
        for (const entry of frameStack) entry.lifelineIds.add(lifelineId);
    }

    function addNote(anchor: NoteAnchor, names: string[], text: string): void {
        const lifelineIds = names.map(name => getOrCreateLifeline(name));
        for (const id of lifelineIds) noteLifelineInFrames(id);
        const noteId = generateId();
        notes[noteId] = {
            id: noteId,
            type: ElementType.Note,
            anchor,
            lifelineIds,
            text: text.trim(),
            sourceActivationOffset: MESSAGE_VERTICAL_SPACING + messageOffset,
        };
        messageOffset += NOTE_VERTICAL_SLOT;
    }

    function openFrame(kind: FrameKind, label: string): void {
        // Carve out space for the header strip so the first section's
        // contents don't collide with the frame label.
        messageOffset += FRAME_HEADER_GAP;
        const frameId = generateId();
        frames[frameId] = {
            id: frameId,
            type: ElementType.Cluster,
            kind,
            label,
            sections: [{label, startOffset: messageOffset}],
            startOffset: messageOffset - FRAME_HEADER_GAP,
            endOffset: messageOffset,
            lifelineIds: [],
        };
        frameStack.push({frameId, lifelineIds: new Set<string>()});
    }

    function addFrameSection(label: string): void {
        const current = frameStack[frameStack.length - 1];
        if (!current) return;
        messageOffset += FRAME_SECTION_GAP;
        frames[current.frameId]!.sections.push({label, startOffset: messageOffset});
    }

    function closeFrame(): void {
        const current = frameStack.pop();
        if (!current) return;
        const frame = frames[current.frameId]!;
        messageOffset += FRAME_FOOTER_GAP;
        frame.endOffset = messageOffset;
        frame.lifelineIds = [...current.lifelineIds];
        // Bubble up: nested frames' lifelines must extend the parent's set so
        // an outer frame still covers participants only touched by inner blocks.
        const parent = frameStack[frameStack.length - 1];
        if (parent) {
            for (const id of frame.lifelineIds) parent.lifelineIds.add(id);
        }
    }

    function getOrCreateLifeline(name: string): string {
        const normalizedName = name.trim();

        const displayName = aliasToDisplayName[normalizedName];
        if (displayName) {
            return participantIdByName[displayName]!;
        }

        const existingId = participantIdByName[normalizedName];
        if (existingId) {
            return existingId;
        }

        const lifelineId = generateId();
        const activationId = generateId();
        const headWidth = estimateHeadWidth(normalizedName);

        const headBounds = {
            x: nextLifelineX,
            y: LIFELINE_HEAD_Y,
            width: headWidth,
            height: LIFELINE_HEAD_HEIGHT,
        };
        nextLifelineX += headWidth + LIFELINE_HORIZONTAL_GAP;

        lifelines[lifelineId] = {
            id: lifelineId,
            type: ElementType.SequenceLifeLine,
            title: normalizedName,
            activations: [activationId],
            placement: {
                headBounds,
                lifelineStart: LIFELINE_START_OFFSET,
                lifelineEnd: DEFAULT_DIAGRAM_HEIGHT,
            },
            // Match flowchart import: neutral schema so the host CSS palette
            // drives stroke/text. Mermaid's stylesheet directives for sequence
            // diagrams aren't parsed yet — when they are, swap to a parsed
            // schema like the flowchart importer does.
            colorSchema: neutralColorSchema,
        };

        activations[activationId] = {
            id: activationId,
            type: ElementType.SequenceActivation,
            lifelineId: lifelineId,
            start: 0,
            length: DEFAULT_DIAGRAM_HEIGHT,
        };

        participantIdByName[normalizedName] = lifelineId;
        lifelineIndex++;
        return lifelineId;
    }

    function getActivationForLifeline(lifelineId: string): string {
        return lifelines[lifelineId]!.activations[0]!;
    }

    for (const line of lines) {
        if (HEADER_RE.test(line)) continue;

        // Frame block keywords are checked before autonumber/notes/messages
        // because they prefix the line and affect the offset bookkeeping
        // every other branch reads from.
        if (FRAME_END_RE.test(line)) {
            closeFrame();
            continue;
        }
        const elseMatch = line.match(FRAME_ELSE_RE);
        if (elseMatch) {
            addFrameSection(elseMatch[1]!.trim());
            continue;
        }
        const andMatch = line.match(FRAME_AND_RE);
        if (andMatch) {
            addFrameSection(andMatch[1]!.trim());
            continue;
        }
        const frameOpenMatch = line.match(FRAME_OPEN_RE);
        if (frameOpenMatch) {
            const kind = frameOpenMatch[1]!.toLowerCase() as FrameKind;
            openFrame(kind, frameOpenMatch[2]!.trim());
            continue;
        }

        if (AUTONUMBER_OFF_RE.test(line)) {
            autonumberCounter = null;
            continue;
        }
        const autonumberMatch = line.match(AUTONUMBER_RE);
        if (autonumberMatch) {
            const start = autonumberMatch[1] ? Number(autonumberMatch[1]) : AUTONUMBER_DEFAULT_START;
            const step = autonumberMatch[2] ? Number(autonumberMatch[2]) : AUTONUMBER_DEFAULT_STEP;
            autonumberCounter = start;
            autonumberStep = step;
            continue;
        }

        const noteOverMatch = line.match(NOTE_OVER_RE);
        if (noteOverMatch) {
            const names = noteOverMatch[1]!.split(",").map(n => n.trim()).filter(Boolean);
            if (names.length >= 1 && names.length <= 2) {
                addNote(NoteAnchor.Over, names, noteOverMatch[2]!);
            }
            continue;
        }
        const noteLeftMatch = line.match(NOTE_LEFT_RE);
        if (noteLeftMatch) {
            addNote(NoteAnchor.LeftOf, [noteLeftMatch[1]!.trim()], noteLeftMatch[2]!);
            continue;
        }
        const noteRightMatch = line.match(NOTE_RIGHT_RE);
        if (noteRightMatch) {
            addNote(NoteAnchor.RightOf, [noteRightMatch[1]!.trim()], noteRightMatch[2]!);
            continue;
        }

        const participantMatch = line.match(PARTICIPANT_RE);
        if (participantMatch) {
            const identifier = participantMatch[1]!;
            const displayName = participantMatch[2]?.replace(/["']/g, "") || identifier;
            getOrCreateLifeline(displayName);
            if (identifier !== displayName) {
                aliasToDisplayName[identifier] = displayName;
            }
            continue;
        }

        const actorMatch = line.match(ACTOR_RE);
        if (actorMatch) {
            const identifier = actorMatch[1]!;
            const displayName = actorMatch[2]?.replace(/["']/g, "") || identifier;
            getOrCreateLifeline(displayName);
            if (identifier !== displayName) {
                aliasToDisplayName[identifier] = displayName;
            }
            continue;
        }

        const messageMatch = line.match(MESSAGE_RE);
        if (messageMatch) {
            const [, from, arrow, to, text] = messageMatch;
            const fromLifelineId = getOrCreateLifeline(from!);
            const toLifelineId = getOrCreateLifeline(to!);
            noteLifelineInFrames(fromLifelineId);
            noteLifelineInFrames(toLifelineId);

            const messageId = generateId();
            const message: MessageState = {
                id: messageId,
                type: ElementType.SequenceMessage,
                activation1: getActivationForLifeline(fromLifelineId),
                activation2: getActivationForLifeline(toLifelineId),
                text: text!.trim(),
                // Mermaid sequence arrow semantics:
                //   `-->` / `-->>` / `--)` → dashed line (return-style)
                //   `-)` / `--)`           → open V tip (async)
                // The clouddiagram importer this is ported from had these swapped
                // (it mapped `)` → isReturn and `--` → isAsync), which produced
                // solid arrows for `-->>` and dashed open-V arrows for `-)`. Map
                // them correctly here so renderers downstream get the visual the
                // mermaid author intended.
                isReturn: arrow!.includes("--"),
                isAsync: arrow!.includes(")"),
                sourceActivationOffset: MESSAGE_VERTICAL_SPACING + messageOffset,
                // defaultLineStyle gives a visible 2px line that respects the
                // host palette via colorSchema downstream. defaultColorSchema is
                // only referenced for future styling hooks; remove if it stays
                // unused after the next pass.
                lineStyle: defaultLineStyle,
            };
            if (autonumberCounter !== null) {
                message.sequenceNumber = autonumberCounter;
                autonumberCounter += autonumberStep;
            }
            messages[messageId] = message;
            messageOffset += MESSAGE_VERTICAL_SPACING;
            continue;
        }
    }

    // Suppress unused-import warning for defaultColorSchema until the styling
    // hook is wired up. Keeping the import documents the intent.
    void defaultColorSchema;

    const totalHeight = messageOffset + FOOTER_PADDING_BELOW_LAST_MESSAGE;
    for (const lifeline of Object.values(lifelines)) {
        lifeline.placement.lifelineEnd = totalHeight;
    }
    for (const activation of Object.values(activations)) {
        activation.length = totalHeight - LIFELINE_START_OFFSET;
    }

    // `nextLifelineX` already includes the trailing gap from the last lifeline,
    // so subtract it once and add a right-side margin equal to the left.
    const displayWidth = Math.max(
        nextLifelineX - LIFELINE_HORIZONTAL_GAP + LIFELINE_LEFT_MARGIN,
        LIFELINE_LEFT_MARGIN * 2 + LIFELINE_HEAD_MIN_WIDTH,
    );

    return {
        ...baseDiagram,
        id: baseDiagram.id,
        type: ElementType.SequenceDiagram,
        display: {
            ...baseDiagram.display,
            width: Math.max(displayWidth, baseDiagram.display.width),
            height: totalHeight + DIAGRAM_BOTTOM_PADDING,
            offset: {x: 0, y: 0},
        },
        lifelines,
        messages,
        activations,
        notes,
        frames,
    };
}
