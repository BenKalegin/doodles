export interface ThemeTokens {
    colors: {
        background: string;
        nodeFill: string;
        nodeStroke: string;
        nodeText: string;
        edgeStroke: string;
        edgeText: string;
        compoundFill: string;
        compoundStroke: string;
        compoundLabel: string;
    };
    font: {
        family: string;
        size: number;
        lineHeight: number;
    };
}

// Default theme is color-free. `transparent` fills + `currentColor` strokes/text
// let the host (axonize, clouddiagram) own the palette via the surrounding
// `color:` CSS — same SVG works against light and dark backgrounds. Per-element
// `colorSchema` overrides for highlights.
const FONT = {
    family: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    size: 14,
    lineHeight: 18,
};

const NEUTRAL_COLORS = {
    background: "transparent",
    nodeFill: "transparent",
    nodeStroke: "currentColor",
    nodeText: "currentColor",
    edgeStroke: "currentColor",
    edgeText: "currentColor",
    compoundFill: "transparent",
    compoundStroke: "currentColor",
    compoundLabel: "currentColor",
};

export const defaultLightTheme: ThemeTokens = {colors: NEUTRAL_COLORS, font: FONT};
export const defaultDarkTheme: ThemeTokens = {colors: NEUTRAL_COLORS, font: FONT};
