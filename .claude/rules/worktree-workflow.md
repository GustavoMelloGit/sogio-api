# Worktree-Based Feature Development

## Rule

Every new feature must be developed inside an isolated git worktree — never directly in the primary working directory.

## Workflow

1. **Before any code change**, sync with the remote and branch from `origin/main` — never from the local `main` ref, which is stale the moment a PR is merged on GitHub:
   ```bash
   git fetch origin
   git worktree add .claude/worktrees/<branch-name> -b <branch-name> origin/main
   ```
   Fast-forward the local `main` too, so the root working tree matches what was merged:
   ```bash
   git merge --ff-only origin/main
   ```
   If the fast-forward is refused, the local `main` has diverged — stop and report it instead of forcing anything.
2. **Right after creating the worktree**, make it runnable — a fresh worktree has neither dependencies nor the gitignored `.env.test`, so tests cannot run without this:
   ```bash
   cd .claude/worktrees/<branch-name>
   cp ../../../.env.test .env.test
   bun install
   ```
   The copied `.env.test` needs no editing: the test database name is derived from the worktree path at run time, so every worktree gets its own Postgres database automatically (`bun run db:push:test` creates it, and `bun run test` keeps its schema in sync). Never point two worktrees at the same test database — concurrent suites truncate each other's fixtures.
3. All agents (Desenvolvedor and any other persona that edits files, runs commands, or commits) must operate **inside that worktree directory** — never in the repository root. The root working tree stays untouched, on `main`, clean.
4. Commits and PR creation still follow the flow declared in `orquestrador.md` under "Fluxo de branch e PR obrigatório", but every git/bun command runs from within the worktree path, not the root.
5. Once the PR is created and the feature is done, remove the worktree and drop the test database it left behind:
   ```bash
   git worktree remove .claude/worktrees/<branch-name>
   bun run db:prune:test
   ```
   `db:prune:test` drops every `sogio_test_*` database with no matching worktree, so it is always safe to run — it never touches the databases of worktrees that still exist.
6. `.claude/worktrees/` is gitignored — its contents must never be committed.

## Why

Branching from `origin/main` instead of `main` is what makes the flow safe when tasks are requested from a phone: PRs get merged on GitHub, and nothing pulls that back down automatically. Without the fetch, each new task would silently start from the last state this machine happened to see, and the merged work would come back as a conflict or a revert.

Deriving the test database from the worktree path is what makes several agents runnable at once: the suite truncates tables between tests, so a shared database means one agent wiping another's fixtures mid-run.

Keeps the main project directory stable and untouched while agents implement features, and avoids in-progress work from one feature bleeding into another or into the directory the user may be inspecting concurrently.
