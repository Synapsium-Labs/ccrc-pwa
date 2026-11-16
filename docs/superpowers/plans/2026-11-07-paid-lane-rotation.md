# A pay-per-use lane joins the auto-swap rotation only when a pool names it

`_default_pool` added every enabled non-home-able lane to the auto-swap candidates. An OpenRouter lane has no limits
file and `_avail` reads an unknown as free, so `_swap_target`'s last-resort bracket could move a limited session onto it
with no operator act, and every session it took billed the key. Spec §8.4's Overflow only line said the opposite. The
a26 plan's entry 16 left this open for a ruling, and the operator ruled on 2026-11-07.

- **D-8098 (2026-11-07)** — a pay-per-use lane joins the auto-swap rotation only when a pool names it.
  The roster has no billing field, so the provider is the fact: an `openrouter` or `compatible` lane bills per use.
  `shared/generate.mjs` projects it as `CCRC_PAY_PER_USE`, and `shared/roster-json.mjs` now returns `provider` so the
  deploy CLI emits the same bytes. `_default_pool` skips such a lane unless the session's project is tagged with a pool
  and the lane's projected pool is that same pool. A session's registry `pool` list still names it, because
  `_pool_for` then never calls `_default_pool`. A session already on the lane is not evacuated: nothing checks that the
  current account is a pool member. A home-able pay-per-use lane (a full lane in spec §8.4) is unchanged, because the
  operator made it a home knowingly. Non-pay-per-use overflow lanes, the kill-switch and `_swap_target` are unchanged.
  An `accounts.sh` from before the array answers "not pay-per-use" for every lane, so the old rotation holds until the
  roster is regenerated, which every deploy does before the ccd lane.
