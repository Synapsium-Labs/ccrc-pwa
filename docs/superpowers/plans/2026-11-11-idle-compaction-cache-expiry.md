# Idle compaction predicted from the prompt cache's expiry

## Goal

The operator's ruling of 2026-11-11: keep Claude Code's idle compaction on (pinned by D-8173) and predict when it will run from the prompt cache's expiry the statusline reports, instead of assuming a fixed delay of about 55 minutes after the turn ended. The fixed delay stays as the fallback when no expiry was recorded. Nothing else about compaction changes.

## What was read first

- A search of `ccd/`, `server/src`, `pwa/src` and `shared/` for the idle-compaction delay (`idle compact`, `55 min`, `IDLE_COMPACT`, `compactAt`, cache expiry). The fixed delay existed only as prose: the header of `server/src/idlenudge.ts` and the D-5371 measurement in `2026-10-16-working-state-and-interruptions.md` ("about 55 minutes after a turn that had ended ... before the 1 h prompt cache expires"). No code computed a predicted time. The idle-compact nudge (D-5373) reacts to the compaction after it ran, and the roll's `compacting` hold (D-7443) reads the live status's last move, so neither reads a prediction.
- `ccd/statusline-command.sh`: the per-session usage sidecar (`~/.cc-sessions/usage/<ccd-id>.json`) recorded `ts`, `uuid`, `account`, `model`, `effort`, `ctxPct`, `cost` and `agent`, and no cache field.
- Claude Code's statusline documentation (the "Prompt cache fields" section): the `prompt_cache` object, present after the main conversation's first API response, from v2.1.251. `prompt_cache.expires_at` is "when the cached prefix leaves its TTL and goes cold, in epoch seconds", `null` when the last response reported no cache tokens. It counts the main conversation only, not subagents. Only this documented field is used; nothing was probed live.

## Deviations found

- **D-8267 (2026-11-11)** — idle-compaction-cache-expiry: the statusline's usage sidecar records `cacheExpiresAt` (`prompt_cache.expires_at`, epoch seconds, null when absent or not a number); the server's sidecar reader and the snapshot revival carry it on `SessionUsage` as an optional field (an older server omits it); `predictIdleCompactAt` in `shared/api.ts` predicts the idle compaction on a `done` or `idle` row as that expiry when present, else `bucketSince` plus `IDLE_COMPACT_ESTIMATE_MS` (55 minutes, the D-5371 figure), else nothing, and on every other bucket nothing. No lane or screen acts on the prediction yet, and compaction behaviour is unchanged.

## Tasks

- [x] T1. Tests first, red: the statusline writes `cacheExpiresAt` for a warm cache, a cold one (`expires_at: null`) and a payload with no `prompt_cache`; `parseUsageSidecar` reads it, nulls a missing or non-numeric one; `reviveFleetSession` carries it and refuses a non-number; `predictIdleCompactAt` rows for the expiry, the missing-expiry fallback (null, absent key, no reading, a cast row with no `usage`), no start and no expiry, and every bucket with no idle compaction coming.
- [x] T2. Record the field in `ccd/statusline-command.sh`, read it in `server/src/usage.ts` and `reviveUsage`, add `IDLE_COMPACT_ESTIMATE_MS` and `predictIdleCompactAt` beside the idle-compaction vocabulary in `shared/api.ts`, and point `idlenudge.ts`'s header at the predictor.
