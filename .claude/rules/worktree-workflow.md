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
2. All agents (Desenvolvedor and any other persona that edits files, runs commands, or commits) must operate **inside that worktree directory** — never in the repository root. The root working tree stays untouched, on `main`, clean.
3. Commits and PR creation still follow the flow declared in `orquestrador.md` under "Fluxo de branch e PR obrigatório", but every git/bun command runs from within the worktree path, not the root.
4. Once the PR is created and the feature is done, remove the worktree:
   ```bash
   git worktree remove .claude/worktrees/<branch-name>
   ```
5. `.claude/worktrees/` is gitignored — its contents must never be committed.

## Why

Branching from `origin/main` instead of `main` is what makes the flow safe when tasks are requested from a phone: PRs get merged on GitHub, and nothing pulls that back down automatically. Without the fetch, each new task would silently start from the last state this machine happened to see, and the merged work would come back as a conflict or a revert.

Keeps the main project directory stable and untouched while agents implement features, and avoids in-progress work from one feature bleeding into another or into the directory the user may be inspecting concurrently.
