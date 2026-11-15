// esbuild lowers `x?.(a)` to `x.call(this, a)`: `(n=this.f)==null||n.call(this,a)` as a statement,
// `(n=this.f)==null?void 0:n.call(this,a)` when the result is used. Both are caught here.
const LOWERED = /==null(?:\|\||\?void 0:)[A-Za-z_$][A-Za-z0-9_$]*\.call\(this\b/;

export function hasLoweredCall(text: string): boolean {
  return LOWERED.test(text);
}

/** Every .js file under `dir`, subdirectories included, that holds a lowered call. */
export function loweredFiles(dir: string): string[] {
  const bad: string[] = [];
  for (const e of Deno.readDirSync(dir)) {
    const path = `${dir}/${e.name}`;
    if (e.isDirectory) bad.push(...loweredFiles(path));
    else if (e.isFile && e.name.endsWith(".js") && hasLoweredCall(Deno.readTextFileSync(path))) bad.push(path);
  }
  return bad;
}

if (import.meta.main) {
  const dir = Deno.args[0];
  if (!dir) {
    console.error("usage: lowered-calls.ts <dir>");
    Deno.exit(2);
  }
  const bad = loweredFiles(dir);
  if (bad.length) {
    console.error(`output contains lowered optional calls (check build.target): ${bad.join(", ")}`);
    Deno.exit(1);
  }
}
