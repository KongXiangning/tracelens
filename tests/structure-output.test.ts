import { afterEach, expect, it } from "vitest";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";

const temporary: string[] = [];
afterEach(async () => {
  for (const root of temporary.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function tree(root: string): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  async function visit(directory: string) {
    for (const e of await readdir(directory, { withFileTypes: true })) {
      const p = path.join(directory, e.name),
        name = path.relative(root, p);
      if (e.isDirectory()) {
        result[name] = "directory";
        await visit(p);
      } else if (e.isSymbolicLink())
        result[name] = `symlink:${await readlink(p)}`;
      else
        result[name] = createHash("sha256")
          .update(await readFile(p))
          .digest("hex");
    }
  }
  await visit(root);
  return result;
}
async function setup() {
  const root = await mkdtemp(
    path.join(os.tmpdir(), "tracelens-structure-output-"),
  );
  temporary.push(root);
  const inputs = [1, 2, 3].map((n) => ({
    name: `input-${n}`,
    kind: "isolated-output-guard",
    root: path.join(root, `input-${n}`),
  }));
  for (const input of inputs)
    await cp(path.resolve("examples/product-scoped"), input.root, {
      recursive: true,
    });
  const file = path.join(root, "inputs.json");
  await writeFile(file, JSON.stringify(inputs));
  const run = (output: string) =>
    spawnSync(process.execPath, [path.resolve("tests/structure-browser.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30000,
      env: {
        ...process.env,
        TRACELENS_STRUCTURE_INPUTS: file,
        TRACELENS_STRUCTURE_OUTPUT: output,
        TRACELENS_BROWSER_EXECUTABLE: path.join(
          root,
          "browser-intentionally-absent",
        ),
      },
    });
  return { root, inputs, run };
}

it.each([2, 3])(
  "rejects output inside input %i before any output, registry or snapshot write",
  async (n) => {
    const f = await setup(),
      output = path.join(f.inputs[n - 1].root, "new-output", "nested");
    if (n === 3) await mkdir(output, { recursive: true });
    const before = await tree(f.root),
      result = f.run(output);
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(
      "must be outside every observed input root",
    );
    expect(await tree(f.root)).toEqual(before);
  },
);

it("rejects a linked output ancestor before writing through its alias", async () => {
  const f = await setup(),
    alias = path.join(f.root, "output-alias");
  await symlink(
    f.inputs[1].root,
    alias,
    process.platform === "win32" ? "junction" : "dir",
  );
  const before = await tree(f.root),
    result = f.run(path.join(alias, "new-output"));
  expect(result.error).toBeUndefined();
  expect(result.status).not.toBe(0);
  expect(result.stderr).toContain("跳过符号链接或目录联接");
  expect(await tree(f.root)).toEqual(before);
});

it("allows a sibling whose name merely shares an input path prefix", async () => {
  const f = await setup(),
    before = await Promise.all(f.inputs.map((i) => tree(i.root)));
  const output = `${f.inputs[1].root}-evidence`,
    result = f.run(output);
  expect(result.error).toBeUndefined();
  // Deliberately stop at browser launch, after the safe output and three reads;
  // this is path isolation verification, not a browser acceptance result.
  expect(result.stderr).toContain("browser-intentionally-absent");
  expect(result.stderr).not.toContain(
    "must be outside every observed input root",
  );
  expect(await readdir(output)).toHaveLength(1);
  expect(await Promise.all(f.inputs.map((i) => tree(i.root)))).toEqual(before);
});

it.skipIf(process.platform !== "win32")(
  "rejects case-varied Windows output inside the third input without writes",
  async () => {
    const f = await setup(),
      before = await tree(f.root);
    const output = path.join(f.inputs[2].root.toUpperCase(), "new-output"),
      result = f.run(output);
    expect(result.error).toBeUndefined();
    expect(result.stderr).toContain(
      "must be outside every observed input root",
    );
    expect(await tree(f.root)).toEqual(before);
  },
);
