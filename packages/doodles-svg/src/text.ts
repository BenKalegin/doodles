import {xmlEscape} from "./escape.js";

interface RichSpan {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
}

interface RichLine {
    spans: RichSpan[];
}

/**
 * Parse a label string carrying inline HTML-ish tags `<b>`, `<strong>`,
 * `<i>`, `<em>`, `<u>`, `<br>` and explicit newlines into a list of lines,
 * each with styled spans. Unknown tags are stripped.
 */
export function parseRichText(text: string): RichLine[] {
    const normalized = text.replace(/<br\s*\/?>/gi, "\n");
    const lines: RichLine[] = [];
    for (const lineSrc of normalized.split("\n")) {
        lines.push(parseLine(lineSrc));
    }
    return lines;
}

function parseLine(line: string): RichLine {
    const spans: RichSpan[] = [];
    let i = 0;
    let bold = false;
    let italic = false;
    let underline = false;
    let buf = "";

    const flush = (): void => {
        if (buf.length === 0) return;
        spans.push({text: buf, bold, italic, underline});
        buf = "";
    };

    while (i < line.length) {
        if (line[i] === "<") {
            const close = line.indexOf(">", i);
            if (close < 0) {
                buf += line.slice(i);
                break;
            }
            const tag = line.slice(i + 1, close).trim().toLowerCase();
            switch (tag) {
                case "b": case "strong":
                    flush(); bold = true; break;
                case "/b": case "/strong":
                    flush(); bold = false; break;
                case "i": case "em":
                    flush(); italic = true; break;
                case "/i": case "/em":
                    flush(); italic = false; break;
                case "u":
                    flush(); underline = true; break;
                case "/u":
                    flush(); underline = false; break;
                default:
                    // unknown tag — strip
                    break;
            }
            i = close + 1;
        } else {
            buf += line[i]!;
            i++;
        }
    }
    flush();
    if (spans.length === 0) spans.push({text: "", bold: false, italic: false, underline: false});
    return {spans};
}

/**
 * Render a parsed rich-text block as a `<text>` element centered at (`cx`, `cy`)
 * with the given font + line-height. Multi-line text grows symmetrically
 * around `cy`.
 */
export function richTextSvg(
    lines: RichLine[],
    cx: number,
    cy: number,
    fontFamily: string,
    fontSize: number,
    lineHeight: number,
    color: string
): string {
    if (lines.length === 0 || (lines.length === 1 && lines[0]!.spans.every(s => s.text === ""))) {
        return "";
    }
    const totalHeight = (lines.length - 1) * lineHeight;
    const firstBaselineDy = -totalHeight / 2;

    const tspans = lines.map((line, idx) => {
        const dy = idx === 0 ? firstBaselineDy : lineHeight;
        const spans = line.spans.map(span => {
            const attrs: string[] = [];
            if (span.bold) attrs.push(`font-weight="bold"`);
            if (span.italic) attrs.push(`font-style="italic"`);
            if (span.underline) attrs.push(`text-decoration="underline"`);
            const attrStr = attrs.length ? ` ${attrs.join(" ")}` : "";
            return `<tspan${attrStr}>${xmlEscape(span.text)}</tspan>`;
        }).join("");
        return `<tspan x="${cx}" dy="${dy}">${spans}</tspan>`;
    }).join("");

    return `<text x="${cx}" y="${cy}" text-anchor="middle" dominant-baseline="central" font-family="${xmlEscape(fontFamily)}" font-size="${fontSize}" fill="${color}">${tspans}</text>`;
}
