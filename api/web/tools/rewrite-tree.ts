// Usage: deno run --allow-read --allow-write tools/rewrite-tree.ts <staged tree>
// Rewrites compound assignment in every .lua file of the staged tree in place and prints the
// rewrites as JSON lines ({file, line, before, after}) for the pack manifest.
import { rewriteCompound } from "./transform.ts";

async function* luaFiles(dir: string): AsyncGenerator<string> {
  for await (const entry of Deno.readDir(dir)) {
    const path = `${dir}/${entry.name}`;
    if (entry.isDirectory) yield* luaFiles(path);
    else if (entry.isFile && entry.name.endsWith(".lua")) yield path;
  }
}

const root = Deno.args[0];
if (!root) throw new Error("usage: rewrite-tree.ts <staged tree>");
for await (const file of luaFiles(root)) {
  // fatal: a file that is not UTF-8 stops the pack instead of being re-encoded with replacement characters.
  const source = new TextDecoder("utf-8", { fatal: true }).decode(await Deno.readFile(file));
  const { text, rewrites } = rewriteCompound(source);
  if (rewrites.length === 0) continue;
  await Deno.writeTextFile(file, text);
  for (const r of rewrites) console.log(JSON.stringify({ file: file.slice(root.length + 1), ...r }));
}
