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

export const defaultLightTheme: ThemeTokens = {
    colors: {
        background: "transparent",
        nodeFill: "#FFF8DC",
        nodeStroke: "#deb887",
        nodeText: "#000000",
        edgeStroke: "#666",
        edgeText: "#444",
        compoundFill: "transparent",
        compoundStroke: "#9ca3af",
        compoundLabel: "#374151",
    },
    font: {
        family: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        size: 14,
        lineHeight: 18,
    },
};

export const defaultDarkTheme: ThemeTokens = {
    colors: {
        background: "transparent",
        nodeFill: "#1f2937",
        nodeStroke: "#6b7280",
        nodeText: "#f3f4f6",
        edgeStroke: "#9ca3af",
        edgeText: "#d1d5db",
        compoundFill: "transparent",
        compoundStroke: "#4b5563",
        compoundLabel: "#e5e7eb",
    },
    font: {
        family: "system-ui, -apple-system, 'Segoe UI', sans-serif",
        size: 14,
        lineHeight: 18,
    },
};
