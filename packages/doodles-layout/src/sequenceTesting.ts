import type {
    FrameKind,
    FrameState,
    LifelineState,
    MessageState,
    NoteState,
    SequenceDiagramState,
} from "@benkalegin/doodles-core";

/**
 * DSL for asserting against a SequenceDiagramState. Mirrors the spirit of
 * the flowchart LayoutFacade but is much smaller — sequence semantics are
 * mostly "did this thing import correctly with the right anchor/kind", not
 * geometric overlap checks.
 *
 * Usage:
 *   const S = sequenceFacade(diagram)
 *   S.participants().ordered("Alice", "Bob")
 *   S.message({from: "Alice", to: "Bob", text: "Hi"}).isSync()
 *   S.note({over: "Alice", text: "watch"}).exists()
 *   S.frame({kind: "alt"}).hasSections("happy", "sad")
 */

export interface SequenceFacade {
    participants(): ParticipantsAssert;
    message(query: MessageQuery): MessageAssert;
    messages(): {count(): number};
    note(query: NoteQuery): NoteAssert;
    notes(): {count(): number};
    frame(query: FrameQuery): FrameAssert;
    frames(): {count(): number};
}

export interface ParticipantsAssert {
    count(): number;
    ordered(...titles: string[]): void;
    exists(title: string): boolean;
}

export interface MessageQuery {
    from: string;
    to: string;
    /** Optional substring of the message text — disambiguates duplicate from→to. */
    text?: string;
}

export interface MessageAssert {
    /** The message exists. Throws if missing. */
    exists(): void;
    /** Sync arrow (closed filled triangle, solid line). */
    isSync(): void;
    /** Async arrow (open V tip). */
    isAsync(): void;
    /** Return-style arrow (dashed line). */
    isReturn(): void;
    /** Autonumber-active message: number assigned. */
    hasNumber(expected: number): void;
    /** Source and target are the same lifeline (U-shape). */
    isSelf(): void;
}

export interface NoteQuery {
    over?: string;
    leftOf?: string;
    rightOf?: string;
    /** For Note over A,B — list the two lifeline titles. */
    spans?: [string, string];
    /** Optional substring of the note text. */
    text?: string;
}

export interface NoteAssert {
    exists(): void;
    /** Title list of lifelines the note attaches to, in declaration order. */
    attachedTo(...titles: string[]): void;
}

export interface FrameQuery {
    kind: FrameKind;
    /** Optional primary label match (exact). */
    label?: string;
}

export interface FrameAssert {
    exists(): void;
    /** Assert section labels in declaration order (first is the primary label). */
    hasSections(...labels: string[]): void;
    /** Assert which lifelines the frame brackets, by title. */
    coversParticipants(...titles: string[]): void;
}

export function sequenceFacade(diagram: SequenceDiagramState): SequenceFacade {
    const lifelinesByTitle = new Map<string, LifelineState>();
    const lifelineTitlesById = new Map<string, string>();
    for (const lifeline of Object.values(diagram.lifelines)) {
        lifelinesByTitle.set(lifeline.title, lifeline);
        lifelineTitlesById.set(lifeline.id, lifeline.title);
    }

    function activationLifelineTitle(activationId: string): string {
        const activation = diagram.activations[activationId];
        if (!activation) throw new Error(`Activation "${activationId}" missing`);
        const title = lifelineTitlesById.get(activation.lifelineId);
        if (!title) throw new Error(`Lifeline for activation "${activationId}" missing`);
        return title;
    }

    function findMessage(query: MessageQuery): MessageState | undefined {
        return Object.values(diagram.messages).find(m => {
            const fromTitle = activationLifelineTitle(m.activation1);
            const toTitle = activationLifelineTitle(m.activation2);
            if (fromTitle !== query.from || toTitle !== query.to) return false;
            if (query.text !== undefined && !m.text.includes(query.text)) return false;
            return true;
        });
    }

    function requireMessage(query: MessageQuery): MessageState {
        const message = findMessage(query);
        if (!message) {
            throw new Error(`Message ${query.from} → ${query.to}${query.text ? ` (text "${query.text}")` : ""} not found`);
        }
        return message;
    }

    function findNote(query: NoteQuery): NoteState | undefined {
        return Object.values(diagram.notes).find(note => {
            if (query.text !== undefined && !note.text.includes(query.text)) return false;
            const titles = note.lifelineIds.map(id => lifelineTitlesById.get(id) ?? "");
            if (query.over !== undefined) {
                return note.anchor === "over" && titles.length === 1 && titles[0] === query.over;
            }
            if (query.leftOf !== undefined) {
                return note.anchor === "leftOf" && titles[0] === query.leftOf;
            }
            if (query.rightOf !== undefined) {
                return note.anchor === "rightOf" && titles[0] === query.rightOf;
            }
            if (query.spans) {
                return note.anchor === "over"
                    && titles.length === 2
                    && titles[0] === query.spans[0]
                    && titles[1] === query.spans[1];
            }
            return true;
        });
    }

    function requireNote(query: NoteQuery): NoteState {
        const note = findNote(query);
        if (!note) throw new Error(`Note ${JSON.stringify(query)} not found`);
        return note;
    }

    function findFrame(query: FrameQuery): FrameState | undefined {
        return Object.values(diagram.frames).find(frame => {
            if (frame.kind !== query.kind) return false;
            if (query.label !== undefined && frame.label !== query.label) return false;
            return true;
        });
    }

    function requireFrame(query: FrameQuery): FrameState {
        const frame = findFrame(query);
        if (!frame) throw new Error(`Frame ${JSON.stringify(query)} not found`);
        return frame;
    }

    return {
        participants(): ParticipantsAssert {
            const lifelines = Object.values(diagram.lifelines);
            return {
                count: () => lifelines.length,
                ordered(...titles): void {
                    const actualOrder = [...lifelines]
                        .sort((a, b) => a.placement.headBounds.x - b.placement.headBounds.x)
                        .map(l => l.title);
                    if (actualOrder.length !== titles.length || actualOrder.some((t, i) => t !== titles[i])) {
                        throw new Error(`Participant order mismatch.\n  expected: ${titles.join(", ")}\n  actual:   ${actualOrder.join(", ")}`);
                    }
                },
                exists: (title) => lifelinesByTitle.has(title),
            };
        },

        message(query): MessageAssert {
            return {
                exists: () => { requireMessage(query); },
                isSync(): void {
                    const m = requireMessage(query);
                    if (m.isAsync) throw new Error(`Message ${query.from} → ${query.to} expected sync but is async`);
                    if (m.isReturn) throw new Error(`Message ${query.from} → ${query.to} expected sync but is return (dashed)`);
                },
                isAsync(): void {
                    const m = requireMessage(query);
                    if (!m.isAsync) throw new Error(`Message ${query.from} → ${query.to} expected async`);
                },
                isReturn(): void {
                    const m = requireMessage(query);
                    if (!m.isReturn) throw new Error(`Message ${query.from} → ${query.to} expected return (dashed)`);
                },
                hasNumber(expected): void {
                    const m = requireMessage(query);
                    if (m.sequenceNumber !== expected) {
                        throw new Error(`Message ${query.from} → ${query.to} expected #${expected}, got ${m.sequenceNumber}`);
                    }
                },
                isSelf(): void {
                    const m = requireMessage(query);
                    const from = activationLifelineTitle(m.activation1);
                    const to = activationLifelineTitle(m.activation2);
                    if (from !== to) throw new Error(`Message ${from} → ${to} expected self-message`);
                },
            };
        },

        messages: () => ({count: () => Object.keys(diagram.messages).length}),

        note(query): NoteAssert {
            return {
                exists: () => { requireNote(query); },
                attachedTo(...titles): void {
                    const note = requireNote(query);
                    const actual = note.lifelineIds.map(id => lifelineTitlesById.get(id) ?? "<missing>");
                    if (actual.length !== titles.length || actual.some((t, i) => t !== titles[i])) {
                        throw new Error(`Note attachment mismatch.\n  expected: ${titles.join(", ")}\n  actual:   ${actual.join(", ")}`);
                    }
                },
            };
        },

        notes: () => ({count: () => Object.keys(diagram.notes).length}),

        frame(query): FrameAssert {
            return {
                exists: () => { requireFrame(query); },
                hasSections(...labels): void {
                    const frame = requireFrame(query);
                    const actual = frame.sections.map(s => s.label);
                    if (actual.length !== labels.length || actual.some((l, i) => l !== labels[i])) {
                        throw new Error(`Frame sections mismatch for ${query.kind}.\n  expected: ${labels.join(", ")}\n  actual:   ${actual.join(", ")}`);
                    }
                },
                coversParticipants(...titles): void {
                    const frame = requireFrame(query);
                    const titlesById = frame.lifelineIds.map(id => lifelineTitlesById.get(id) ?? "<missing>");
                    const expectedSet = new Set(titles);
                    const actualSet = new Set(titlesById);
                    if (expectedSet.size !== actualSet.size || [...expectedSet].some(t => !actualSet.has(t))) {
                        throw new Error(`Frame coverage mismatch for ${query.kind}.\n  expected: ${titles.join(", ")}\n  actual:   ${titlesById.join(", ")}`);
                    }
                },
            };
        },

        frames: () => ({count: () => Object.keys(diagram.frames).length}),
    };
}
