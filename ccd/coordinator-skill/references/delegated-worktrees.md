# Delegated worktrees

A worktree can be left behind by delegated work: an Agent or Workflow helper that ran in
a worktree of its own. When that worktree holds changes, the server keeps it. This
reference says what "kept" means and what this session may do about it. It is a
reference, not a clause: nothing here changes what the contract asks of you.

"Adopted" here is not `spawn-adopted` in `references/wave-lifecycle.md`, which says a dispatch reused a workspace that already existed.

## What a kept worktree is

A kept (adopted) worktree is one the server holds back from the disk sweep because it
carries changes nobody has landed. The keep lasts 7 days from the last keep. After that
the worktree is no longer held back, and the sweep may take it.

## Retaining one

The lease's parent, or that parent's coordinator, may keep it another 7 days:

```
printf '{"byId":"<your id>","byUuid":"<your uuid>"}' | ~/.local/bin/ccrc-api leases retain <lease-id> --json -
```

The body is exactly those two fields. The server answers `carrier: "pending"`: the keep
is recorded, and the worktree's carrier follows.

## Promotion

Turning a kept worktree into a real run is a `runs open` that names the worktree's
lease. That is a later change and is not available yet; do not try it.

## Unowned worktrees

A worktree in conflict, or one the server only inferred from a shell call, is the
operator's, not yours. The operator keeps it, attaches it to its own session, or says it
is not delegated, from the PWA. A worktree with no lease at all has no control yet. This
session never does any of these, and never retains a worktree it does not own.
