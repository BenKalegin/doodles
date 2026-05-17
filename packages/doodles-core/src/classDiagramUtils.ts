import type {ClassMemberKind, ClassMemberState, NodeState} from "./types.js";

export const classNodeHeaderHeight = 32;
export const classNodeHeaderHeightWithAnnotation = 46;
export const classNodeMemberLineHeight = 18;
export const classNodeSectionVerticalPadding = 6;
export const classNodeHeaderTextInsets = {
    left: 8,
    top: 5,
    horizontal: 16,
    vertical: 10,
} as const;
export const classNodeMemberTextInsets = {
    left: 10,
    top: 6,
    horizontal: 20,
    vertical: 12,
} as const;
export const classNodeMemberFontSize = 13;

export interface ClassNodeSectionsLayout {
    hasMembers: boolean;
    headerHeight: number;
    fieldsHeight: number;
    methodsTop: number;
    methodsHeight: number;
}

export function createClassMember(text: string, forcedKind?: ClassMemberKind): ClassMemberState | undefined {
    const trimmed = text.trim();
    if (!trimmed) return undefined;
    return {
        kind: forcedKind ?? inferClassMemberKind(trimmed),
        text: trimmed,
    };
}

export function inferClassMemberKind(text: string): ClassMemberKind {
    return /\([^)]*\)/.test(text) ? "method" : "field";
}

export function getClassFieldsText(node: NodeState): string {
    return getClassMembersText(node, "field");
}

export function getClassMethodsText(node: NodeState): string {
    return getClassMembersText(node, "method");
}

export function getClassMembersText(node: NodeState, kind: ClassMemberKind): string {
    return (node.classMembers ?? [])
        .filter(member => member.kind === kind)
        .map(member => member.text)
        .join("\n");
}

export function replaceClassMembersText(
    existingMembers: ClassMemberState[] | undefined,
    kind: ClassMemberKind,
    text: string
): ClassMemberState[] {
    const existing = existingMembers ?? [];
    const replacement = text
        .split("\n")
        .map(line => ({
            kind,
            text: line.trim(),
        }));

    const fields = kind === "field"
        ? replacement
        : existing.filter(member => member.kind === "field");
    const methods = kind === "method"
        ? replacement
        : existing.filter(member => member.kind === "method");

    return [...fields, ...methods];
}

export function normalizeClassAnnotation(value: string): string | undefined {
    const trimmed = value.trim().replace(/^<<\s*/, "").replace(/\s*>>$/, "").trim();
    return trimmed || undefined;
}

export function classSectionHeightForMembers(memberCount: number): number {
    if (memberCount <= 0) return 0;
    return memberCount * classNodeMemberLineHeight + classNodeSectionVerticalPadding * 2;
}

export function classNodeHeaderHeightForAnnotation(annotation?: string): number {
    return annotation ? classNodeHeaderHeightWithAnnotation : classNodeHeaderHeight;
}

export function classNodeSectionsLayout(node: Pick<NodeState, "classMembers" | "classAnnotation">, nodeHeight: number): ClassNodeSectionsLayout {
    const fieldsCount = (node.classMembers ?? []).filter(member => member.kind === "field").length;
    const methodsCount = (node.classMembers ?? []).filter(member => member.kind === "method").length;
    const hasMembers = fieldsCount > 0 || methodsCount > 0;
    const headerHeight = classNodeHeaderHeightForAnnotation(node.classAnnotation);
    const fieldsHeight = classSectionHeightForMembers(fieldsCount);
    const requestedMethodsHeight = classSectionHeightForMembers(methodsCount);
    const methodsTop = headerHeight + fieldsHeight;
    const methodsHeight = Math.max(nodeHeight - methodsTop, requestedMethodsHeight);
    return {
        hasMembers,
        headerHeight,
        fieldsHeight,
        methodsTop,
        methodsHeight,
    };
}

export function minimumClassNodeHeight(node: NodeState): number {
    const fields = (node.classMembers ?? []).filter(member => member.kind === "field");
    const methods = (node.classMembers ?? []).filter(member => member.kind === "method");
    const titleLines = node.classAnnotation ? 2 : 1;
    const titleHeight = titleLines * 18 + 12;
    const fieldsHeight = classSectionHeightForMembers(fields.length);
    const methodsHeight = classSectionHeightForMembers(methods.length);
    return Math.max(60, titleHeight + fieldsHeight + methodsHeight);
}
