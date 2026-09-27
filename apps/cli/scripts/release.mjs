// Builds the publishable npm package in apps/cli/release: one bundled entrypoint (workspace
// packages inlined), the dashboard, the capture skill, and a generated manifest. Only the native
// Keychain binding stays an installed dependency.
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { build } from "esbuild";

// The bare npm name `wist` belongs to someone else; the command is still `wist`.
const PACKAGE_NAME = process.env.PACKAGE_NAME ?? "wist-cli";

const VERSION = process.env.PACKAGE_VERSION ?? "0.1.0";

const cli = join(dirname(fileURLToPath(import.meta.url)), "..");

const root = join(cli, "..", "..");

const out = join(cli, "release");

const manifest = JSON.parse(await readFile(join(cli, "package.json"), "utf8"));

const dashboard = join(root, "apps", "web", "dist");

await readFile(join(dashboard, "index.html")).catch(() => {
  throw new Error("Build the dashboard first: pnpm --filter @wist/web build");
});

await rm(out, { recursive: true, force: true });

await mkdir(join(out, "dist"), { recursive: true });

const result = await build({
  metafile: true,
  absWorkingDir: cli,
  entryPoints: [join(cli, "src", "main.ts")],
  outfile: join(out, "dist", "main.js"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["@napi-rs/keyring"],
  // Bundled CommonJS dependencies still call require().
  banner: {
    js: [
      'import { createRequire as __createRequire } from "node:module";',
      "const require = __createRequire(import.meta.url);",
    ].join("\n"),
  },
  legalComments: "linked",
  logLevel: "warning",
});

// The entrypoint keeps its plain hashbang; the package silences Node's SQLite experimental warning.
const entry = join(out, "dist", "main.js");

const bundled = await readFile(entry, "utf8");

await writeFile(
  entry,
  bundled.replace(/^#!.*\n/, "#!/usr/bin/env -S node --disable-warning=ExperimentalWarning\n"),
);

await writeFile(join(out, "dist", "THIRD_PARTY_LICENSES.txt"), await notices(result.metafile));

await cp(dashboard, join(out, "dist", "web"), { recursive: true });

await cp(join(cli, "skills"), join(out, "skills"), { recursive: true });

await cp(join(root, "LICENSE"), join(out, "LICENSE"));

await cp(join(cli, "README.md"), join(out, "README.md"));

await writeFile(
  join(out, "package.json"),
  `${JSON.stringify(
    {
      name: PACKAGE_NAME,
      version: VERSION,
      description:
        "Hand off your coding agent's work to your personal assistant, with your approval.",
      license: "Apache-2.0",
      repository: { type: "git", url: "git+https://github.com/AbdulsaboorS/agent-passport.git" },
      type: "module",
      bin: { wist: "./dist/main.js" },
      files: ["dist", "skills"],
      engines: { node: ">=24.0.0" },
      os: ["darwin"],
      dependencies: { "@napi-rs/keyring": manifest.dependencies["@napi-rs/keyring"] },
    },
    null,
    2,
  )}\n`,
);

process.stdout.write(`Built ${PACKAGE_NAME}@${VERSION} in ${out}\n`);

/** Collects the license text of every npm package the bundle inlines. */
async function notices(metafile) {
  const packages = new Map();

  for (const input of Object.keys(metafile.inputs)) {
    const path = input.replaceAll("\\", "/");
    const start = path.lastIndexOf("node_modules/");

    if (start === -1) continue;

    const rest = path.slice(start + "node_modules/".length).split("/");
    const name = rest[0]?.startsWith("@") ? `${rest[0]}/${rest[1]}` : rest[0];

    if (name !== undefined) {
      packages.set(name, join(cli, path.slice(0, start), "node_modules", name));
    }
  }

  const sections = [];

  for (const [name, directory] of [...packages].toSorted(([left], [right]) =>
    left.localeCompare(right),
  )) {
    const info = JSON.parse(await readFile(join(directory, "package.json"), "utf8"));
    const file = (await readdir(directory)).find((entry) => /^(licen[cs]e|copying)/i.test(entry));

    const text =
      file === undefined
        ? `License: ${info.license}`
        : await readFile(join(directory, file), "utf8");

    sections.push(`${name}@${info.version} (${info.license})\n\n${text.trim()}`);
  }

  return `This package bundles the following open-source software.\n\n${sections.join(`\n\n${"-".repeat(72)}\n\n`)}\n`;
}
