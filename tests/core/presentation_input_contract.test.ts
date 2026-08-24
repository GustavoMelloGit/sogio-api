import { describe, it, expect } from "bun:test";
import { Glob } from "bun";
import { dirname, relative, resolve } from "node:path";

const PROJECT_ROOT = resolve(import.meta.dir, "../..");
const SRC = resolve(PROJECT_ROOT, "src");

const TOOLS_WITHOUT_A_USE_CASE = [
  "src/auth/presentation/mcp_tool/get_me.mcp_tool.ts",
];

type Surface = { file: string; source: string; useCases: string[] };

function repoPath(absolute: string): string {
  return relative(PROJECT_ROOT, absolute);
}

function useCasesOf(source: string): string[] {
  return [...source.matchAll(/^import[\s\S]*?from\s+"[^"]+";$/gm)].flatMap(
    statement =>
      [...statement[0].matchAll(/\b([A-Z][A-Za-z]*UseCase)\b/g)].map(
        match => match[1] as string
      )
  );
}

async function collect(pattern: string): Promise<Surface[]> {
  const surfaces: Surface[] = [];

  for await (const match of new Glob(pattern).scan({ cwd: SRC })) {
    const file = resolve(SRC, match);
    const source = await Bun.file(file).text();
    surfaces.push({ file, source, useCases: useCasesOf(source) });
  }

  return surfaces.sort((a, b) => a.file.localeCompare(b.file));
}

function sharedSchemaImports(surface: Surface): string[] {
  return [...surface.source.matchAll(/from\s+"([^"]*\/schema\/[^"]+)"/g)]
    .map(match => resolve(dirname(surface.file), match[1] as string))
    .sort();
}

function isZodSchema(value: unknown): value is { description?: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as { parse?: unknown }).parse === "function"
  );
}

const controllers = await collect(
  "*/presentation/controller/**/*.controller.ts"
);
const tools = await collect("*/presentation/mcp_tool/*.mcp_tool.ts");

const pairs = tools.flatMap(tool =>
  tool.useCases.flatMap(useCase => {
    const controller = controllers.find(candidate =>
      candidate.useCases.includes(useCase)
    );
    return controller ? [{ useCase, controller, tool }] : [];
  })
);

describe("Input contract shared between HTTP and MCP", () => {
  it("backs every MCP tool with the controller of the same use case", () => {
    expect(pairs.length).toBeGreaterThan(0);

    const orphans = tools
      .filter(tool => tool.useCases.length === 0)
      .map(tool => repoPath(tool.file));

    expect(orphans).toEqual(TOOLS_WITHOUT_A_USE_CASE);

    const unpaired = tools
      .filter(
        tool =>
          tool.useCases.length > 0 &&
          !pairs.some(pair => pair.tool.file === tool.file)
      )
      .map(tool => repoPath(tool.file));

    expect(unpaired).toEqual([]);
  });

  it("makes both transports of a use case read one declaration", () => {
    const split = pairs
      .filter(pair => {
        const fromController = sharedSchemaImports(pair.controller);
        const fromTool = sharedSchemaImports(pair.tool);
        if (fromController.length === 0 && fromTool.length === 0) return false;
        return fromController.join() !== fromTool.join();
      })
      .map(pair => ({
        use_case: pair.useCase,
        controller: repoPath(pair.controller.file),
        tool: repoPath(pair.tool.file),
      }));

    expect(split).toEqual([]);
  });

  it("describes every field of every shared shape", async () => {
    const undescribed: string[] = [];

    for await (const match of new Glob(
      "*/presentation/schema/*.schema.ts"
    ).scan({ cwd: SRC })) {
      const file = resolve(SRC, match);
      const module = (await import(file)) as Record<string, unknown>;

      for (const [exportName, exported] of Object.entries(module)) {
        if (isZodSchema(exported)) {
          if (!exported.description) {
            undescribed.push(`${repoPath(file)} → ${exportName}`);
          }
          continue;
        }

        if (typeof exported !== "object" || exported === null) continue;

        for (const [field, schema] of Object.entries(exported)) {
          if (!isZodSchema(schema) || !schema.description) {
            undescribed.push(`${repoPath(file)} → ${exportName}.${field}`);
          }
        }
      }
    }

    expect(undescribed).toEqual([]);
  });
});
