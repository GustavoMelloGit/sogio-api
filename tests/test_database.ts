import { createHash } from "node:crypto";
import { basename, dirname } from "node:path";
import { Client } from "pg";

const MAX_IDENTIFIER_LENGTH = 63;
const DUPLICATE_DATABASE = "42P04";

function git(...args: string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: import.meta.dir });
  if (result.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${result.stderr.toString().trim()}`
    );
  }
  return result.stdout.toString().trim();
}

export function worktreeRoot(): string {
  return git("rev-parse", "--show-toplevel");
}

export function mainWorktreeRoot(): string {
  return dirname(
    git("rev-parse", "--path-format=absolute", "--git-common-dir")
  );
}

export function worktreeRoots(): string[] {
  return git("worktree", "list", "--porcelain")
    .split("\n")
    .filter(line => line.startsWith("worktree "))
    .map(line => line.slice("worktree ".length).trim());
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function databaseNameOf(url: string): string {
  return decodeURIComponent(new URL(url).pathname.slice(1));
}

export function testDatabaseNameFor(root: string): string {
  const base = databaseNameOf(baseDatabaseUrl());
  if (root === mainWorktreeRoot()) return base;

  const hash = createHash("sha1").update(root).digest("hex").slice(0, 8);
  const budget = MAX_IDENTIFIER_LENGTH - base.length - hash.length - 2;
  const slug = slugify(basename(root)).slice(0, Math.max(budget, 0));
  return `${base}_${slug}_${hash}`;
}

function baseDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set — is .env.test present in this worktree?"
    );
  }
  return url;
}

function assertTestDatabase(name: string): void {
  if (!name.includes("test")) {
    throw new Error(
      `refusing to operate on "${name}": test database names must contain "test"`
    );
  }
}

export function testDatabaseUrl(): string {
  const url = new URL(baseDatabaseUrl());
  const name = testDatabaseNameFor(worktreeRoot());
  assertTestDatabase(name);
  url.pathname = `/${encodeURIComponent(name)}`;
  return url.toString();
}

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

async function withMaintenanceClient<T>(
  fn: (client: Client) => Promise<T>
): Promise<T> {
  const url = new URL(baseDatabaseUrl());
  url.pathname = "/postgres";
  const client = new Client({ connectionString: url.toString() });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

function pushSchema(url: string): void {
  const result = Bun.spawnSync(["bun", "x", "drizzle-kit", "push", "--force"], {
    cwd: worktreeRoot(),
    env: { ...process.env, DATABASE_URL: url },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (result.exitCode !== 0) {
    throw new Error(
      [
        `drizzle-kit push failed for ${databaseNameOf(url)}`,
        result.stdout.toString().trim(),
        result.stderr.toString().trim(),
      ]
        .filter(Boolean)
        .join("\n")
    );
  }
}

export async function ensureTestDatabase(): Promise<string> {
  const url = testDatabaseUrl();
  const name = databaseNameOf(url);
  assertTestDatabase(name);

  await withMaintenanceClient(async client => {
    const existing = await client.query(
      "select 1 from pg_database where datname = $1",
      [name]
    );
    if (existing.rowCount) return;
    try {
      await client.query(`create database ${quoteIdentifier(name)}`);
    } catch (error) {
      if ((error as { code?: string }).code !== DUPLICATE_DATABASE) throw error;
    }
  });

  pushSchema(url);
  return url;
}

export async function pruneTestDatabases(): Promise<string[]> {
  const base = databaseNameOf(baseDatabaseUrl());
  const alive = new Set(worktreeRoots().map(testDatabaseNameFor));

  return withMaintenanceClient(async client => {
    const { rows } = await client.query<{ datname: string }>(
      "select datname from pg_database where datname like $1 order by datname",
      [`${base}\\_%`]
    );

    const dropped: string[] = [];
    for (const { datname } of rows) {
      if (alive.has(datname)) continue;
      assertTestDatabase(datname);
      await client.query(
        `drop database if exists ${quoteIdentifier(datname)} with (force)`
      );
      dropped.push(datname);
    }
    return dropped;
  });
}
