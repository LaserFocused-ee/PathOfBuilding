// Rewrites LuaJIT compound assignment (`x += 1`, `url ..= s`) into plain Lua 5.2 assignment,
// because the browser VM (pob-web's Lua 5.2 fork) does not parse it. Upstream files are never
// edited: this runs on the staged copy that is packed. The pack fails afterwards if any file still
// does not parse under the browser VM (tools/parse-check.c), so a form this regex misses cannot ship.

export interface Rewrite {
  line: number;
  before: string;
  after: string;
}

// ponytail: line-based; one statement per line, target is a name, field path or a single index.
// A form outside that (trailing comment, two statements on a line) fails the parse check instead.
const COMPOUND = /^(\s*)([A-Za-z_][\w.]*(?:\[[^\]\n]*\])?)\s*(\.\.|\+|-|\*|\/\/|\/|%|\^)=\s*(\S.*?)\s*$/;

export function rewriteCompound(source: string): { text: string; rewrites: Rewrite[] } {
  const rewrites: Rewrite[] = [];
  const lines = source.split("\n");
  let longString = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip lines inside long strings or long comments ([[ ... ]], [=[ ... ]=]).
    const opens = (line.match(/\[=*\[/g) ?? []).length;
    const closes = (line.match(/\]=*\]/g) ?? []).length;
    const inside = longString;
    if (opens !== closes) longString = opens > closes;
    if (inside) continue;
    const m = COMPOUND.exec(line.replace(/\r$/, ""));
    if (!m) continue;
    const [, indent, target, op, expr] = m;
    const after = `${indent}${target} = ${target} ${op} (${expr})${line.endsWith("\r") ? "\r" : ""}`;
    rewrites.push({ line: i + 1, before: line.trim(), after: after.trim() });
    lines[i] = after;
  }
  return { text: lines.join("\n"), rewrites };
}
