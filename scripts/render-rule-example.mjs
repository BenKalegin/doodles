#!/usr/bin/env node
/**
 * Extract a fixture's rendered SVG from the golden snapshot file and write
 * it as a standalone SVG for `docs/layout-rules/images/`.
 *
 * Usage:
 *   node scripts/render-rule-example.mjs <fixture-name>
 *
 * <fixture-name> is the basename of a `.mmd` file under
 * `packages/doodles-svg/test/golden/fixtures/`. The script reads the
 * snapshot baseline (`__snapshots__/golden.test.ts.snap`) and writes the
 * rendered SVG to `docs/layout-rules/images/<fixture-name>.svg`.
 *
 * The on-disk SVG is for human eyeballing in PRs and rule docs only. CI
 * verifies the layout via DSL assertions in `golden.test.ts`; this script
 * just mirrors the snapshot that those tests already pin.
 */
import {readFileSync, writeFileSync, mkdirSync} from "node:fs";
import {dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SNAPSHOT_FILE = join(REPO_ROOT, "packages/doodles-svg/test/golden/__snapshots__/golden.test.ts.snap");
const OUTPUT_DIR = join(REPO_ROOT, "docs/layout-rules/images");

const fixture = process.argv[2];
if (!fixture) {
    console.error("Usage: node scripts/render-rule-example.mjs <fixture-name>");
    process.exit(1);
}

const snapshotText = readFileSync(SNAPSHOT_FILE, "utf8");
// Snapshot entry format:
//   exports[`golden: <fixture> > svg snapshot 1`] = `"<svg ...escaped...>"`;
// The value is a Vitest-serialized string: outer template literal wraps a
// JSON-escaped string. We need the inner string contents (the raw SVG).
const marker = `exports[\`golden: ${fixture} > svg snapshot 1\`] = \``;
const start = snapshotText.indexOf(marker);
if (start === -1) {
    console.error(`No snapshot found for fixture "${fixture}".`);
    console.error(`Run \`pnpm test\` first to generate the snapshot baseline.`);
    process.exit(1);
}
const valueStart = start + marker.length;
const valueEnd = snapshotText.indexOf("`;", valueStart);
if (valueEnd === -1) {
    console.error("Malformed snapshot entry (no closing backtick).");
    process.exit(1);
}
// Vitest wraps the string in extra quotes: `"<svg ...>"`. Strip them.
let svgText = snapshotText.slice(valueStart, valueEnd);
if (svgText.startsWith('"') && svgText.endsWith('"')) {
    svgText = svgText.slice(1, -1);
}
// Unescape the JS string literal: \" → ", \\ → \, \n → newline.
svgText = svgText.replace(/\\(["\\/])/g, "$1").replace(/\\n/g, "\n");

mkdirSync(OUTPUT_DIR, {recursive: true});
const outPath = join(OUTPUT_DIR, `${fixture}.svg`);
writeFileSync(outPath, svgText, "utf8");
console.log(`Wrote ${outPath}`);
