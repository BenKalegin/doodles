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

// Muted slate palette borrowed from filigree's reference SVGs: translucent
// fills work against any host background (light or dark), strokes/text use
// slate tones with enough contrast on both.
const FONT = {
    family: "system-ui, -apple-system, 'Segoe UI', sans-serif",
    size: 14,
    lineHeight: 18,
};

export const defaultLightTheme: ThemeTokens = {
    colors: {
        background: "transparent",
        nodeFill: "#64748b14",
        nodeStroke: "#64748b",
        nodeText: "#475569",
        edgeStroke: "#94a3b8",
        edgeText: "#64748b",
        compoundFill: "transparent",
        compoundStroke: "#64748b",
        compoundLabel: "#475569",
    },
    font: FONT,
};

export const defaultDarkTheme: ThemeTokens = {
    colors: {
        background: "transparent",
        nodeFill: "#64748b14",
        nodeStroke: "#64748b",
        nodeText: "#94a3b8",
        edgeStroke: "#94a3b8",
        edgeText: "#94a3b8",
        compoundFill: "transparent",
        compoundStroke: "#64748b",
        compoundLabel: "#cbd5e1",
    },
    font: FONT,
};
