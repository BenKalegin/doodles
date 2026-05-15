import type {ColorSchema, LineStyle} from "./types.js";

/**
 * Color-free schema. SVG accepts these as paint values: `transparent` for fill
 * (the host background shows through), `currentColor` for stroke/text (the host
 * controls color via the surrounding `color:` CSS). Use this when importing
 * un-styled sources (e.g. plain Mermaid) so renders don't impose a palette.
 */
export const neutralColorSchema: ColorSchema = {
    strokeColor: "currentColor",
    fillColor: "transparent",
    textColor: "currentColor",
};

export const defaultColorSchema: ColorSchema = {
    strokeColor: "#deb887",
    fillColor: "#FFF8DC",
    textColor: "#000000",
};

const pinkColorSchema: ColorSchema = {
    strokeColor: "#F08080",
    fillColor: "#FFE4E1",
    textColor: "#000000",
};

const leafColorSchema: ColorSchema = {
    strokeColor: "#9EBD5D",
    fillColor: "#F4F7EC",
    textColor: "#000000",
};

const steelColorSchema: ColorSchema = {
    strokeColor: "#AEBFD1",
    fillColor: "#F0F5FF",
    textColor: "#000000",
};

const darkForest1Colors: ColorSchema = {
    strokeColor: "#A57777",
    fillColor: "#EAD3D3",
    textColor: "#000000",
};

const darkForest2Colors: ColorSchema = {
    strokeColor: "#82a3b7",
    fillColor: "#bcd9ef",
    textColor: "#000000",
};

export const colorSchemaList: ColorSchema[] = [
    defaultColorSchema,
    pinkColorSchema,
    leafColorSchema,
    steelColorSchema,
    darkForest1Colors,
    darkForest2Colors,
];

export const lineStyleList: LineStyle[] = colorSchemaList.map((s) => ({
    fillColor: s.fillColor,
    strokeColor: s.strokeColor,
    width: 2,
}));

export const defaultLineStyle: LineStyle = lineStyleList[0]!;
