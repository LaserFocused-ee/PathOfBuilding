import { assertEquals, assertNotEquals } from "@std/assert";
import { buildContent } from "./content.ts";

// Encodes XML the way Path of Building does: zlib deflate, base64 with "-" and "_".
async function encode(xml: string): Promise<string> {
  const stream = new Blob([xml]).stream().pipeThrough(new CompressionStream("deflate"));
  const bytes = new Uint8Array(await new Response(stream).arrayBuffer());
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_");
}

const build = (viewMode: string, zoom: string, level: string) =>
  `<?xml version="1.0"?><PathOfBuilding><Build level="${level}" viewMode="${viewMode}" className="Witch"/>` +
  `<TreeView searchStr="life" zoomLevel="${zoom}" zoomX="1" zoomY="2" showStatDifferences="true"/>` +
  `<Tree activeSpec="1"/></PathOfBuilding>`;

Deno.test("switching tab or moving the tree is not an edit", async () => {
  assertEquals(
    await buildContent(await encode(build("TREE", "3", "90"))),
    await buildContent(await encode(build("ITEMS", "5", "90"))),
  );
});

Deno.test("a real change still differs", async () => {
  assertNotEquals(
    await buildContent(await encode(build("TREE", "3", "90"))),
    await buildContent(await encode(build("TREE", "3", "91"))),
  );
});
