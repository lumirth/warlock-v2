import { existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { TERM_STATUS_VALUES } from "@uiuc-course-search/query-types";
import { describe, expect, it } from "vitest";

function markdownFiles(root: string): string[] {
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      return entry.name === "archive" || entry.name === "research"
        ? []
        : markdownFiles(path);
    }
    return extname(entry.name) === ".md" ? [path] : [];
  });
}

describe("active documentation", () => {
  it("does not keep completed plans or dated reports in active doc directories", () => {
    expect(existsSync("docs/plans")).toBe(false);
    expect(existsSync("docs/reports")).toBe(false);
  });

  it("does not reference missing repository files", () => {
    for (const file of markdownFiles("docs")) {
      const source = readFileSync(file, "utf8");
      const references = [...source.matchAll(/`((?:apps|packages|scripts|docs)\/[^`\s]+)`/g)]
        .map((match) => match[1].replace(/[.,:;)]$/, ""))
        .filter((reference) => !reference.includes("*") && !reference.includes("<"));

      for (const reference of references) {
        expect(existsSync(reference), `${file} references missing ${reference}`).toBe(true);
      }
    }
  });

  it("keeps the security route matrix aligned with mounted route declarations", () => {
    const documented = routeMatrixEntries(
      readFileSync("docs/security-route-matrix.md", "utf8"),
    );
    const mounted = routeSourceEntries("apps/api/src/routes");

    expect(documented).toEqual(mounted);
  });

  it("documents canonical term statuses and the sync-batch owner", () => {
    const apiReadme = readFileSync("apps/api/README.md", "utf8");
    for (const status of TERM_STATUS_VALUES) {
      expect(apiReadme).toContain(`\`${status}\``);
    }
    expect(apiReadme).toContain("services/sync-batch-contract.ts");
    expect(apiReadme).not.toMatch(/\b\d+\s+subjects?\b/i);
  });

  it("does not freeze implementation cache versions in active documentation", () => {
    for (const file of markdownFiles("docs")) {
      expect(readFileSync(file, "utf8"), file).not.toMatch(
        /\b(?:search|course|api)[-_ ]?cache\s+(?:version\s+)?v\d+\b/i,
      );
    }
  });
});

function routeMatrixEntries(source: string): string[] {
  return [...source.matchAll(/\| `(GET|POST|PUT|DELETE|PATCH) ([^`]+)` \|/g)]
    .map((match) => `${match[1]} ${match[2]}`)
    .sort();
}

function routeSourceEntries(root: string): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && extname(entry.name) === ".ts")
    .flatMap((entry) => {
      const source = readFileSync(join(root, entry.name), "utf8");
      return [...source.matchAll(/\b(\w+Routes)\.(get|post|put|delete|patch)\(['"]([^'"]+)['"]/g)]
        .map((match) => {
          const prefix = match[1] === "debugRoutes" ? "/admin/debug" : "";
          return `${match[2].toUpperCase()} ${prefix}${match[3]}`;
        });
    })
    .sort();
}
