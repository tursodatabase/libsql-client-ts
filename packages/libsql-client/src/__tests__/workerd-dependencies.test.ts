import { expect } from "@jest/globals";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

type PackageLock = {
    packages: Record<string, PackageMetadata | undefined>;
};

type PackageMetadata = {
    dependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
};

const clientPackagePath = "packages/libsql-client";
const forbiddenDependencies = ["cross-fetch", "whatwg-fetch"] as const;

function dependencyPackagePath(packageName: string): string {
    return `node_modules/${packageName}`;
}

function findRootLockfile(): string {
    const candidates = [
        join(process.cwd(), "package-lock.json"),
        join(process.cwd(), "..", "..", "package-lock.json"),
    ];
    const path = candidates.find((candidate) => existsSync(candidate));
    if (path === undefined) {
        throw new Error("Could not find root package-lock.json");
    }
    return path;
}

function getDependencyNames(metadata: PackageMetadata | undefined): string[] {
    return [
        ...Object.keys(metadata?.dependencies ?? {}),
        ...Object.keys(metadata?.optionalDependencies ?? {}),
    ];
}

function collectTransitiveDependencies(
    lockfile: PackageLock,
    packagePath: string,
): Set<string> {
    const seen = new Set<string>();
    const queue = getDependencyNames(lockfile.packages[packagePath]);
    for (let index = 0; index < queue.length; index += 1) {
        const packageName = queue[index];
        if (seen.has(packageName)) {
            continue;
        }
        seen.add(packageName);
        queue.push(
            ...getDependencyNames(
                lockfile.packages[dependencyPackagePath(packageName)],
            ),
        );
    }
    return seen;
}

describe("workerd dependencies", () => {
    test("do not include browser fetch polyfills", async () => {
        const lockfile = JSON.parse(
            await readFile(findRootLockfile(), "utf8"),
        ) as PackageLock;
        const dependencies = collectTransitiveDependencies(
            lockfile,
            clientPackagePath,
        );
        for (const forbiddenDependency of forbiddenDependencies) {
            expect(dependencies).not.toContain(forbiddenDependency);
        }
    });
});
