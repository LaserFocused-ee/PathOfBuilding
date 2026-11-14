// Usage: deno run --allow-read --allow-write tools/manifest.ts <packed dir> <unpacked root.zip dir> <commit> <pob-web rev> <rewrites.jsonl>
// Writes <packed dir>/pack-manifest.json: the source commit, the pob-web pin, every compound-assignment
// rewrite, and every packed file with its size and SHA-256.
const [outDir, zipDir, commit, pobWeb, rewritesFile] = Deno.args;
if (!rewritesFile) {
  throw new Error("usage: manifest.ts <packed dir> <root.zip dir> <commit> <pob-web rev> <rewrites.jsonl>");
}

async function* walk(dir: string, prefix = ""): AsyncGenerator<string> {
  const entries = [];
  for await (const entry of Deno.readDir(dir)) entries.push(entry);
  entries.sort((a, b) => a.name < b.name ? -1 : 1);
  for (const entry of entries) {
    const rel = prefix + entry.name;
    if (entry.isDirectory) yield* walk(`${dir}/${entry.name}`, `${rel}/`);
    else if (entry.isFile) yield rel;
  }
}

const files = [];
for await (const path of walk(zipDir)) {
  const bytes = await Deno.readFile(`${zipDir}/${path}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  files.push({
    path,
    bytes: bytes.byteLength,
    sha256: Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join(""),
  });
}
const rewrites = (await Deno.readTextFile(rewritesFile)).split("\n").filter(Boolean).map((l) => JSON.parse(l));
const manifest = { game: "poe1", sourceCommit: commit, pobWebCommit: pobWeb, rewrites, files };
await Deno.writeTextFile(`${outDir}/pack-manifest.json`, JSON.stringify(manifest, null, 1) + "\n");
console.log(`manifest: ${files.length} files, ${rewrites.length} rewrites`);
