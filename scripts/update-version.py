#!/usr/bin/env python3
"""Update the version of all workspace packages and tag the release.

This bumps the version in every package.json, the ``@libsql/core`` dependency
ranges that point at the bumped core package, and the matching entries in
package-lock.json. It then creates the release commit and the ``v<version>``
tag.

It never pushes anything -- pushing is left to you:

    git push origin main && git push origin v<version>
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# Workspace packages, in dependency order.
PACKAGES = [
    "packages/libsql-core",
    "packages/libsql-client",
    "packages/libsql-client-wasm",
]

# Dependencies that are workspace packages and therefore follow the same
# version as everything else.
INTERNAL_DEPS = ["@libsql/core"]

DEP_SECTIONS = ["dependencies", "devDependencies", "peerDependencies"]

VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$")


def read_json(path):
    return json.loads(path.read_text())


def write_json(path, data):
    path.write_text(json.dumps(data, indent=4, ensure_ascii=False) + "\n")


def bump_deps(node, version):
    """Rewrite internal dependency ranges of a package.json-shaped dict."""
    for section in DEP_SECTIONS:
        deps = node.get(section)
        if not isinstance(deps, dict):
            continue
        for name in INTERNAL_DEPS:
            if name in deps:
                deps[name] = f"^{version}"


def update_package_json(pkg_dir, version):
    path = ROOT / pkg_dir / "package.json"
    data = read_json(path)
    data["version"] = version
    bump_deps(data, version)
    write_json(path, data)
    return path


def update_lockfile(version):
    path = ROOT / "package-lock.json"
    data = read_json(path)
    packages = data.get("packages", {})
    for pkg_dir in PACKAGES:
        node = packages.get(pkg_dir)
        if node is None:
            sys.exit(f"error: {path.name} has no entry for {pkg_dir}")
        node["version"] = version
        bump_deps(node, version)
    write_json(path, data)
    return path


def git(*args, capture=False):
    return subprocess.run(
        ["git", *args],
        cwd=ROOT,
        check=True,
        text=True,
        capture_output=capture,
    ).stdout


def main():
    parser = argparse.ArgumentParser(
        description="Bump all workspace packages to <version> and tag the release."
    )
    parser.add_argument("version", help="new version, without the 'v' prefix")
    parser.add_argument(
        "--no-commit",
        action="store_true",
        help="only edit the files, don't commit or tag",
    )
    parser.add_argument(
        "--no-tag",
        action="store_true",
        help="create the release commit but no tag",
    )
    args = parser.parse_args()

    version = args.version.lstrip("v")
    if not VERSION_RE.match(version):
        sys.exit(f"error: '{args.version}' is not a valid version")

    tag = f"v{version}"
    if not args.no_commit and not args.no_tag:
        existing = git("tag", "--list", tag, capture=True).strip()
        if existing:
            sys.exit(f"error: tag {tag} already exists")

    touched = [update_package_json(pkg, version) for pkg in PACKAGES]
    touched.append(update_lockfile(version))

    for path in touched:
        print(f"updated {path.relative_to(ROOT)} -> {version}")

    if args.no_commit:
        print("\nnothing committed (--no-commit); nothing pushed.")
        return

    paths = [str(p.relative_to(ROOT)) for p in touched]
    git("commit", "-m", version, "--", *paths)
    print(f"\ncommitted {version}")

    if args.no_tag:
        print("no tag created (--no-tag); nothing pushed.")
        return

    git("tag", tag)
    print(f"tagged {tag}")
    print(f"\nNothing was pushed. To publish:\n    git push origin HEAD && git push origin {tag}")


if __name__ == "__main__":
    main()
