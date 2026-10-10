# Worktree Lifecycle (All Agents)

- When a task uses a newly created worktree, integrate all of its changes into the primary checkout (`main`, or the repository's existing primary branch), preserve existing work, resolve conflicts, and verify the combined result before task completion. Uncommitted changes must also be integrated.
- You MUST delete the task worktree after integration, without exception. Verify that both its Git worktree registration and its directory are gone. Preserve required provenance and reusable build caches outside the worktree before deleting it.
- These requirements do not authorize commits or publishing; follow the user's existing instructions for those actions.
