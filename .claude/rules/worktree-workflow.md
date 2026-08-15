# Worktree-Based Feature Development

## Rule

Every new feature must be developed inside an isolated git worktree — never directly in the primary working directory.

## Workflow

1. **Before any code change**, create a branch from `main` and a worktree for it under `.claude/worktrees/<branch-name>`:
   ```bash
   git worktree add .claude/worktrees/<branch-name> -b <branch-name> main
   ```
2. All agents (Desenvolvedor and any other persona that edits files, runs commands, or commits) must operate **inside that worktree directory** — never in the repository root. The root working tree stays untouched, on `main`, clean.
3. Commits and PR creation still follow the flow declared in `orquestrador.md` under "Fluxo de branch e PR obrigatório", but every git/bun command runs from within the worktree path, not the root.
4. Once the PR is created and the feature is done, remove the worktree:
   ```bash
   git worktree remove .claude/worktrees/<branch-name>
   ```
5. `.claude/worktrees/` is gitignored — its contents must never be committed.

## Why

Keeps the main project directory stable and untouched while agents implement features, and avoids in-progress work from one feature bleeding into another or into the directory the user may be inspecting concurrently.
