# AGENTS.md — Rules for AI Agents

> This file governs all AI coding agents working in this repository (Copilot, Codex, custom agents, etc.).
> These rules take precedence over an agent's preference for efficient automation: **Asking one more question is safer than taking one extra action.**

## 1. Mandatory Rules

1. **Do not commit code automatically.**
   Do not run `git commit`, `git commit --amend`, `git stash`, or any other operation that
   creates or modifies commits without explicit human permission. After making changes,
   report the changes and validation results, then **stop and wait** for an instruction to commit.

2. **Do not start background monitoring automatically.**
   Do not start background polling, monitoring, or prolonged observation without permission
   (for example, polling CI status, monitoring PR review progress, or periodically fetching comments).
   When waiting for a result, tell the human when it is expected and when they can check again.
   Let the human decide whether monitoring is needed.

3. **Do not push or perform remote operations automatically.** (Same principle as rule 1.)
   Obtain **separate human approval for each action** before running `git push` (including
   `--force` and `--force-with-lease`) or performing any GitHub remote operation: creating PRs,
   changing PR status (draft, ready for review, closed, or reopened), posting comments,
   mentioning review bots to trigger reviews, adding labels, assigning people or milestones, etc.

4. **Do not modify repository governance configuration automatically.**
   Do not automatically change `.github/` (workflows, CODEOWNERS, etc.), branch rulesets or
   protection rules, or review bot configuration such as `.coderabbit.yaml`.
   Report any issues first and let the human decide.

## 2. Allowed Automatic Actions

- Read and write local files, create and switch branches, and run read-only queries such as `git status` and `git diff`.
- Run local validation: `node --check`, `node tools/test-engine.js`, and smoke tests using a local static server and a headless browser.
- **Report** the results of these actions to the human.

Decision rule: **Actions that only affect the local environment and are readily reversible may
be performed automatically. Actions that write to remote systems, are difficult to reverse,
or disturb people (notifications, comments, or polling) require prior approval.**

## 3. Workflow Conventions

1. At the start of a task, read `PLAN.md`, `docs/GAME_DESIGN.md`, and this file. Follow the
   repository's existing conventions, including branch names (`feat/<issue-number>-<slug>`)
   and Conventional Commits.
2. After making changes, run the repository quality gates (PLAN.md §4), report the
   **changed files, validation results, and recommended next steps**, then stop and wait for instructions.
3. When commits, pushes, PR creation, or other remote actions are needed, **list the planned
   actions individually and request approval** instead of executing them immediately.
4. Keep reports concise. Do not make remote decisions on the human's behalf just because
   they seem convenient to handle along the way.
5. When reasoning about design or implementation decisions, consult similar open-source
   games where practical. Prefer proven approaches and reuse suitable existing solutions
   rather than reinventing the wheel, while respecting this project's constraints and any
   applicable licenses.

## 4. Why These Rules Exist

- On 2026-10-21 (during Issue #5), an agent committed changes several times without confirmation
  and started background polling of CodeRabbit review progress without being asked. The human
  stopped both behaviors, leading to the mandatory rules in section 1.
- On the same day, after a branch ruleset blocked a push, the agent closed and reopened the PR
  and mentioned a review bot on its own initiative. These unauthorized remote operations led
  to section 1, rule 3.
