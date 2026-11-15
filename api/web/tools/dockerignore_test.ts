// api/deploy/Dockerfile.dockerignore mirrors the repository's .gitignore (the image must hold nothing git ignores),
// and upstream merges change .gitignore: every .gitignore pattern needs its line there.
import { assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const read = (path: string) => Deno.readTextFileSync(fromFileUrl(new URL(path, import.meta.url)));
const patterns = (text: string) => text.split("\n").map((l) => l.trim()).filter((l) => l !== "" && !l.startsWith("#"));

/** The .dockerignore line for a .gitignore pattern: a pattern without an inner slash matches at any depth. */
export function dockerLine(pattern: string): string {
  const p = pattern.replace(/\/$/, "");
  return p.includes("/") ? p.replace(/^\//, "") : `**/${p}`;
}

Deno.test("each .gitignore pattern has its line in Dockerfile.dockerignore", () => {
  const docker = new Set(patterns(read("../../deploy/Dockerfile.dockerignore")));
  const missing = patterns(read("../../../.gitignore")).filter((p) => !docker.has(dockerLine(p)));
  assertEquals(missing, []);
});

Deno.test("dockerLine: anchored and directory patterns", () => {
  assertEquals(
    [".idea/", "*.cfg", "src/poe_api_response.json", "api/web/dist/", "/x"].map(dockerLine),
    ["**/.idea", "**/*.cfg", "src/poe_api_response.json", "api/web/dist", "x"],
  );
});
