import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

function sourceFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return SOURCE_EXTENSIONS.has(extname(entry.name)) ? [path] : [];
  });
}

function importSpecifiers(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [
    ...source.matchAll(/\bimport\b(?:[\s\S]*?\bfrom\s*)?["']([^"']+)["']/g),
    ...source.matchAll(/\bexport\b[\s\S]*?\bfrom\s*["']([^"']+)["']/g),
  ].map((match) => match[1]);
}

function expectNoImports(
  files: readonly string[],
  forbidden: RegExp,
): void {
  for (const file of files) {
    const offending = importSpecifiers(file).filter((specifier) =>
      forbidden.test(specifier),
    );
    expect(offending, `${file} crosses an ownership boundary`).toEqual([]);
  }
}

describe("architecture boundaries", () => {
  it("keeps the public contract and web independent from API internals", () => {
    expectNoImports(
      [...sourceFiles("packages/query-types"), ...sourceFiles("apps/web/src")],
      /(?:^|\/)apps\/api\/src(?:\/|$)|(?:^|\/)api\/src(?:\/|$)/,
    );
  });

  it("keeps query-types transport independent", () => {
    expectNoImports(
      sourceFiles("packages/query-types"),
      /cloudflare|hono|apps\/|scripts\//,
    );
  });

  it("keeps routes out of database, source parsing, retrieval, and ranking internals", () => {
    expectNoImports(
      sourceFiles("apps/api/src/routes").filter((file) => !file.includes("/__tests__/")),
      /\/(?:db|cisapi|transforms|ranking)\/|search-(?:filters|hybrid|retrieval|fusion|loaders|requirements)/,
    );
  });

  it("keeps ordinary operational scripts independent from API internals", () => {
    const explicitApplicationWorkflow = "scripts/workflows/historical-sync-workflow.ts";
    const workflowTest = "scripts/__tests__/historical-sync.test.ts";
    const checked = sourceFiles("scripts").filter(
      (file) =>
        file !== explicitApplicationWorkflow
        && file !== workflowTest
        && file !== "scripts/__tests__/architecture-boundaries.test.ts",
    );

    expectNoImports(checked, /apps\/api\/src/);
  });

  it("keeps executable retrieval code independent from public response DTOs", () => {
    const retrievalFiles = sourceFiles("apps/api/src/services").filter((file) =>
      /search-(?:retrieval|lane-query|hybrid|fusion)/.test(file),
    );
    expectNoImports(retrievalFiles, /search-response-dto|dto\/course|search-ui/);
  });

  it("keeps ranking independent from HTTP, routes, and presentation", () => {
    expectNoImports(
      sourceFiles("apps/api/src/services/ranking"),
      /\/http\/|\/routes\/|dto\/|search-(?:response|ui|chip|hint-label|result-presentation)/,
    );
  });

  it("keeps DTO mappers independent from repositories and database execution", () => {
    expectNoImports(
      sourceFiles("apps/api/src/dto").filter((file) => !file.includes("/__tests__/")),
      /repository|cloudflare|hono/,
    );
  });

  it("keeps repositories independent from public presentation", () => {
    const repositoryFiles = sourceFiles("apps/api/src").filter(
      (file) =>
        file.endsWith("-repository.ts")
        && !file.includes("/__tests__/"),
    );
    expectNoImports(
      repositoryFiles,
      /\/dto\/|search-(?:response|ui|chip|result-presentation)/,
    );
  });
});
