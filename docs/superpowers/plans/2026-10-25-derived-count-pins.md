# Derived count pins: four exact-count pins become derivations, ceilings or manifests: Implementation Plan

> **For agentic workers:** one task, one PR (#1519). REQUIRED SUB-SKILL: superpowers:test-driven-development (red
> first, then green). Test files only.

**Goal.** Four exact-count pins forced a one-line re-pin on almost every PR touching them, and each re-pin collided
with concurrent PRs. Each becomes a derivation, a ceiling or a manifest, and none rejects less than it did.

## What was measured (2026-10-25)

- Root-cause rank 9 of the 2026-10-25 landing measurement: `COORD_SCHEMA_VERSION` in `asks-store.test.ts`, the
  refusal-status send pins, ccd-contexts' cross-context edge count and the single-array growth-waiver ledger.
- The ccd-contexts edge manifest, generated from `origin/main`'s computed set, holds 539 sorted unique edges, and
  that set equals the computed set (characterization: the manifest replaces the count without moving it).

## The decision

- **D-6925** — The four pins become: (a) a check that a migration creates the asks table, found by its DDL; (b)
  per-file ceilings on the refusal-status sends plus a merge-base rule that a net-added line starts no literal or
  computed refusal send; (c) `ccd/contexts-edges.tsv`, a manifest the computed edges must be a subset of; (d)
  `server/test/growth-waivers/`, one waiver per `<D-number>-<slug>.json` file. While the merge queue drains, a
  merge-base that predates the directory is read through the legacy `server/test/growth-waivers.json` `waivers`
  array, so the migrated waivers never count as newly added; that fallback is deleted once the queue has drained.
