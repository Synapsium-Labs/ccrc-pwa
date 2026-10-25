# Collect lane: the leaf checkout scan's cap and its own word: Implementation Plan

> **For agentic workers:** one task, one PR (#1394). REQUIRED SUB-SKILL: superpowers:test-driven-development (red
> first, then green). Fixture HOMEs only.

**Goal.** A leaf of many fixture clones is no longer stuck unmeasured on `checkouts`, and a leaf that really exceeds
the checkout scan's cap says so in a per-leaf word, so it is listed as a fact of the leaf at once.

**Spec:** `docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md` §5.5 ("The scan").
**Contract:** `docs/superpowers/programs/child-reclamation-contract.md`, the per-leaf deterministic probe words.

## What was measured (2026-10-25)

- A temp root of many fixture clones held more than 64 entries named `.git`, so every audit of it answered
  unmeasured `checkouts`. That word is load-sensitive: the lane read it as transient, and listed the leaf only after
  the fourth failing run, as `failing`, never as a fact of the leaf. Nothing could collect it.
- Examining one `.git` file costs about 20 ms on the worst path (an outside admin directory with its back-link):
  64 entries took about 1.2 s, 512 about 11 s and 2048 about 42 s, against a `REAP_SCAN_SECONDS` of 30 s.

## The decision

- **D-6860** — The leaf checkout scan counts only `.git` entries that need examining (a `.git` directory, a full
  clone, passes unread and is not counted), its cap is raised from 64 to 1024 entries, and the examination is bounded
  by `REAP_SCAN_SECONDS` as well; an examination that does not finish is unmeasured `checkouts` (load), while a leaf
  over the cap answers the per-leaf word `checkouts-cap` in the collector's audit and its loose arm.
