import { defineConfig } from "tsup";

export default defineConfig({
    entry: ["src/api.ts", "src/config.ts", "src/uri.ts", "src/util.ts"],
    splitting: true,
    sourcemap: false,
    clean: true,
    outDir: "dist",
    dts: true,
    format: ["cjs", "esm"],
    tsconfig: "tsconfig.json",
    external: ["js-base64"],
    bundle: false,
    outExtension: ({ format }) => ({
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
    }),
});
