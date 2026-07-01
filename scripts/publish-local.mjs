#!/usr/bin/env node
/**
 * Build and publish a Tiovivo release from your own machine — no GitHub Actions.
 *
 * This is the DEFAULT release path: it builds the Windows (NSIS) installer locally
 * and publishes a GitHub Release for the matching tag. To also ship a macOS build,
 * push a "vX.Y.Z+mac" tag instead and let .github/workflows/build.yml do both.
 *
 * Usage:
 *   npm run publish:local                 # build Windows + publish release vX.Y.Z
 *   npm run publish:local -- --tag v0.5.3 # override the tag (default: v<package.json version>)
 *   npm run publish:local -- --skip-build # publish an existing build in release/
 *   npm run publish:local -- --draft      # create the release as a draft
 *   npm run publish:local -- --notes "…"  # release notes (default: auto)
 *   npm run publish:local -- --repo owner/name   # target repo (default: the `gh` origin)
 *   npm run publish:local -- --dry-run
 *
 * Requirements:
 *   - gh CLI authenticated with write access to the target repo.
 *   - A .env with VITE_GIPHY_API_KEY (vite bakes it into the build), same as `npm run dev`.
 */

import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);

const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : null;
};

const dryRun = has("--dry-run");
const skipBuild = has("--skip-build");
const draft = has("--draft");
const repo = valueOf("--repo"); // null -> gh uses the repo's origin remote
const notesArg = valueOf("--notes");

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const version = pkg.version;
const tag = valueOf("--tag") || `v${version}`;
const releaseDir = join(root, "release");

const run = (cmd, cmdArgs, opts = {}) => {
  console.log(`$ ${cmd} ${cmdArgs.join(" ")}`);
  if (dryRun) return "";
  return execFileSync(cmd, cmdArgs, { stdio: "inherit", cwd: root, ...opts });
};

console.log(`Tiovivo local publish → ${repo ? repo : "(origin)"} tag ${tag}${dryRun ? "  [dry-run]" : ""}`);

// 1) Build the Windows installer locally.
if (!skipBuild) {
  console.log("\n== Building (npm run dist) ==");
  if (dryRun) {
    console.log("$ npm run dist");
  } else {
    execSync("npm run dist", { stdio: "inherit", cwd: root });
  }
} else {
  console.log("\n== Skipping build (--skip-build) ==");
}

// 2) Collect Windows release artifacts.
const wanted = (name) =>
  /\.exe$/i.test(name) || /\.blockmap$/i.test(name) || /^latest.*\.yml$/i.test(name);
const assets = existsSync(releaseDir)
  ? readdirSync(releaseDir).filter(wanted).map((f) => join(releaseDir, f))
  : [];

if (!dryRun && assets.length === 0) {
  console.error(`\nNo Windows artifacts found in ${releaseDir}. Run without --skip-build first.`);
  process.exit(1);
}
console.log(`\n== Assets ==\n${assets.map((a) => "  " + a).join("\n") || "  (none — dry run)"}`);

// 3) Create or update the GitHub release and upload assets.
const notes =
  notesArg ||
  `Tiovivo ${tag}\n\nWindows installer below. For a macOS build, push the "${tag}+mac" tag (CI builds both).`;

const repoArgs = repo ? ["-R", repo] : [];
const exists = (() => {
  if (dryRun) return false;
  try {
    execFileSync("gh", ["release", "view", tag, ...repoArgs], { cwd: root, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
})();

console.log("\n== Publishing ==");
if (exists) {
  run("gh", ["release", "upload", tag, ...assets, ...repoArgs, "--clobber"]);
} else {
  run("gh", [
    "release",
    "create",
    tag,
    ...assets,
    ...repoArgs,
    "--title",
    `Tiovivo ${tag}`,
    "--notes",
    notes,
    ...(draft ? ["--draft"] : []),
  ]);
}

console.log(`\nDone${dryRun ? " (dry run — nothing published)" : ""}.`);
