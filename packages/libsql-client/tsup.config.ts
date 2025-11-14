import { defineConfig } from "tsup";
import pkg from "./package.json";

export default defineConfig({
    entry: [
        "src/node.ts",
        "src/http.ts",
        "src/ws.ts",
        "src/sqlite3.ts",
        "src/web.ts",
    ],
    splitting: true,
    sourcemap: false,
    clean: true,
    outDir: "dist",
    dts: true,
    format: ["cjs", "esm"],
    tsconfig: "tsconfig.json",
    external: Object.keys(pkg.dependencies),
    bundle: false,
    outExtension: ({ format }) => ({
        js: format === "cjs" ? ".cjs" : ".js",
        dts: format === "cjs" ? ".d.cts" : ".d.ts",
    }),
});
