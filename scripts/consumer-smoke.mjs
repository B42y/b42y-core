import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const work = mkdtempSync(join(tmpdir(), "b42y-consumer-"));
const npmCli =
  process.env.npm_execpath ||
  resolve(dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
function run(args, cwd = process.cwd()) {
  const executable = existsSync(npmCli) ? process.execPath : "npm";
  const invocation = existsSync(npmCli) ? [npmCli, ...args] : args;
  const result = spawnSync(executable, invocation, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, npm_config_cache: resolve(".tmp/npm-cache") },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  return result.stdout;
}
const packed = JSON.parse(run(["pack", "--json", "--pack-destination", work]));
const filename = Array.isArray(packed)
  ? packed[0]?.filename
  : packed["@b42y/core"]?.filename;
if (typeof filename !== "string")
  throw new Error("npm pack returned no archive");
run(
  [
    "install",
    "--offline",
    "--ignore-scripts",
    "--no-save",
    resolve(work, filename),
  ],
  work,
);
const consumer = await import(
  pathToFileURL(resolve(work, "node_modules/@b42y/core/dist/index.js")).href
);
if (
  consumer.parseEgp("1.00") !== 100 ||
  typeof consumer.createCoreService !== "function"
)
  throw new Error("packed consumer import failed");

const tscCli =
  process.env.B42Y_TSC_CLI || resolve("node_modules/typescript/lib/tsc.js");
if (!existsSync(tscCli))
  throw new Error("TypeScript compiler unavailable for consumer smoke test");
const typeSample = resolve(work, "consumer.ts");
writeFileSync(
  typeSample,
  `import { createCoreService, parseEgp } from '@b42y/core';
import type { LedgerStore, Clock, IdGenerator } from '@b42y/core';
declare const store: LedgerStore; declare const clock: Clock; declare const ids: IdGenerator;
const core = createCoreService({ store, clock, ids });
const amount: number = parseEgp('1.00');
void core; void amount;
`,
);
const typeResult = spawnSync(
  process.execPath,
  [
    tscCli,
    "--noEmit",
    "--strict",
    "--moduleResolution",
    "bundler",
    "--module",
    "esnext",
    "--target",
    "ES2022",
    "--skipLibCheck",
    typeSample,
  ],
  { cwd: work, encoding: "utf8" },
);
if (typeResult.status !== 0)
  throw new Error(typeResult.stderr || typeResult.stdout);
