import {defineConfig} from "vitest/config";

// Config for the on-demand layout-quality scorer (`pnpm score`). Kept separate
// from the default suite so the metrics dump doesn't run on every `pnpm test`.
export default defineConfig({
    test: {
        include: ["packages/doodles-svg/test/golden/layout-score.ts"],
    },
});
