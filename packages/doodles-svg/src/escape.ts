/**
 * Escape characters that have meaning in XML text/attribute context.
 * Keeps the output safe to inline into any host page.
 */
export function xmlEscape(s: string): string {
    return s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}
