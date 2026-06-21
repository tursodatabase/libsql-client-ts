import { expect } from "@jest/globals";
import { build } from "esbuild";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import "./helpers.js";

const forbiddenBundleTexts = [
    "XMLHttpRequest",
    "cross-fetch",
    "whatwg-fetch",
] as const;

describe("workerd bundle", () => {
    test("does not include browser fetch polyfills", async () => {
        const fixtureDir = await mkdtemp(
            join(process.cwd(), ".workerd-bundle-"),
        );
        try {
            const entryPoint = join(fixtureDir, "repro.ts");
            const outfile = join(fixtureDir, "bundle.js");
            await writeFile(
                entryPoint,
                `import { createClient } from "@libsql/client";

export const onRequest = async () => {
    const client = createClient({ url: "https://example.com" });
    await client.execute("SELECT 1");
};
`,
            );

            await build({
                entryPoints: [entryPoint],
                bundle: true,
                platform: "browser",
                conditions: ["workerd"],
                format: "esm",
                outfile,
                logLevel: "silent",
            });

            const bundled = await readFile(outfile, "utf8");
            for (const forbiddenText of forbiddenBundleTexts) {
                expect(bundled).not.toContain(forbiddenText);
            }
        } finally {
            await rm(fixtureDir, { recursive: true, force: true });
        }
    });
});
