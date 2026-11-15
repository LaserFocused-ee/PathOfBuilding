// What counts as an edit to a build. Path of Building's build code (base64url of zlib-deflated XML)
// also carries view state: the open tab (`<Build viewMode>`) and the passive tree's zoom, position and
// search text (`<TreeView>`). Switching tabs or panning the tree is not an edit, so those are removed
// before two codes are compared; the full code is still what gets written.

export async function buildContent(code: string): Promise<string> {
  return withoutViewState(await inflate(code.trim()));
}

export function withoutViewState(xml: string): string {
  return xml
    .replace(/(<Build\b[^>]*?)\s+viewMode="[^"]*"/, "$1")
    .replace(/<TreeView\b[^>]*?(\/?)>/, "<TreeView$1>");
}

async function inflate(code: string): Promise<string> {
  const binary = atob(code.replaceAll("-", "+").replaceAll("_", "/"));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate"));
  return await new Response(stream).text();
}
