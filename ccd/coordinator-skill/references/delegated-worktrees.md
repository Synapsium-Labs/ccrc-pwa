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

You may keep a worktree's lease another 7 days when you are the lease's parent, or when
your run's claim names that parent (you are its coordinator). That holds for every
lease, including one the server inferred from a shell call:

```
printf '{"byId":"<your id>","byUuid":"<your uuid>"}' | ~/.local/bin/ccrc-api leases retain <lease-id> --json -
```

The body is exactly those two fields. The server answers `carrier: "pending"`: the keep
is recorded, and the worktree's carrier follows.

## Promotion

Turning a kept worktree into a real run is a `runs open` that names the worktree's
lease. That is a later change and is not available yet; do not try it.

## The operator's acts

Attaching a lease to its own session, and saying a worktree is not delegated, are the
operator's, from the PWA, and so is every act on a worktree in conflict: Retain refuses
one. A worktree with no lease at all has no control yet. This session never does any of
these, and never retains a lease whose parent is neither you nor a session your run's
claim names.
