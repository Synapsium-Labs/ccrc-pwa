# ccrc Plan 3/3 — Box Integration & E2E Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy ccrc to the <server-host> box, verify it against real ccd sessions end-to-end (a dedicated `cctest` session), re-capture parser fixtures from live panes, and complete the mobile-device pass.

**Architecture:** No new components — this plan exercises Plans 1+2 output on the real box. E2E tests are a vitest suite in `server/test-e2e/` that runs from the Mac against `CCRC_BASE_URL` (skipped when the env var is absent, so `vitest run` stays green offline).

**Tech Stack:** deploy.sh (rsync over ssh port 2222), systemd user units, vitest for e2e, real Android phone for the mobile pass.

**Spec:** `docs/superpowers/specs/2026-07-20-ccrc-remote-control-app-design.md`

## Global Constraints

- Box access: `ssh -p 2222 -i ~/.ssh/<your-key> you@<server-host>` (Tailscale). `~/.local/bin` is NOT on PATH over non-interactive SSH — always absolute `~/.local/bin/ccd`. `systemctl --user` needs `XDG_RUNTIME_DIR=/run/user/$(id -u)` exported.
- The server must be reachable at `http://203.0.113.7:7788` from the tailnet and **unreachable** on any other interface.
- Never touch the six production sessions during e2e — all live testing goes through a dedicated `cctest` project session (`claude2-cctest` — gmail Max, the least-critical account). Stop it when done.
- E2E suite: `server/test-e2e/*.e2e.test.ts`, guarded by `const BASE = process.env.CCRC_BASE_URL; describe.skipIf(!BASE)`.
- Commit after every task: `feat(ccrc): <what>` / `test(ccrc): <what>`.

---

### Task 1: First deploy + hardening checks

**Files:**
- Modify (if needed from findings): `infra/ccrc/deploy/deploy.sh`, `infra/ccrc/deploy/ccrc.service`

- [ ] **Step 1:** Ensure box has Node ≥22: `ssh ... 'node --version'`; if <22, install via existing box practice (nvm or apt NodeSource) and record what was done in the task notes.
- [ ] **Step 2:** Run `infra/ccrc/deploy/deploy.sh` from repo root. Expected: rsync + `npm ci` + build + unit enabled + final `curl http://203.0.113.7:7788/health` prints `{"ok":true}`.
- [ ] **Step 3:** Verify bind isolation: on the box `ss -tlnp | grep 7788` shows `203.0.113.7:7788` only (NOT `0.0.0.0`/`*`); `curl -m 3 http://127.0.0.1:7788/health` from the box **fails**; from the Mac (on tailnet) `curl http://203.0.113.7:7788/health` succeeds.
- [ ] **Step 4:** Verify survival: `ssh ... 'export XDG_RUNTIME_DIR=/run/user/$(id -u); systemctl --user restart ccrc && sleep 2 && curl -fsS http://203.0.113.7:7788/health'`; `loginctl show-user you | grep Linger=yes`.
- [ ] **Step 5:** From the Mac: `curl http://203.0.113.7:7788/api/fleet | jq '.sessions[].id'` lists the real sessions. Open `http://203.0.113.7:7788/` in a desktop browser — fleet renders with live data.
- [ ] **Step 6: Commit** any deploy-script fixes: `git add -A && git commit -m "feat(ccrc): first box deploy fixes"`

---

### Task 2: notify.sh hook install + swap notice verify

- [ ] **Step 1:** Install: `scp -P 2222 -i ~/.ssh/<your-key> infra/ccrc/deploy/notify.sh you@<server-host>:.cc-sessions/notify.sh` then `ssh ... 'chmod +x ~/.cc-sessions/notify.sh'`.
- [ ] **Step 2:** Verify manually: `ssh ... '~/.cc-sessions/notify.sh "cc swap: claude2-cctest moved claude2 -> claude (limits) — test"'` while `websocat ws://203.0.113.7:7788/ws/fleet` (or a tiny node script) is connected from the Mac. Expected: a `{"type":"notice",...}` frame arrives.
- [ ] **Step 3: Commit** any fixes: `git commit -m "feat(ccrc): notify hook installed and verified"` (docs-only note if no code changed).

---

### Task 3: E2E suite against cctest

**Files:**
- Create: `infra/ccrc/server/test-e2e/session.e2e.test.ts`, `infra/ccrc/server/test-e2e/helpers.ts`

**Interfaces:**
- `helpers.ts`: `wsCollect(url, pred, timeoutMs): Promise<msg[]>` (connect, buffer messages until predicate or timeout); `post(path, body)`; `BASE` from env.
- Test flow (single serial describe, generous timeouts — real Claude turns take a while; each step asserts through the **public API only**):
  1. **Create:** `POST /api/sessions {wrapper:'claude2', project:'cctest'}` (workdir default `/data/projects/cctest`; pre-create the dir on the box in Step 1 if absent) → poll `/api/fleet` until `claude2-cctest` alive (≤3 min: first-run gates).
  2. **Prompt→reply:** connect `/ws/session/claude2-cctest`; `POST .../prompt {text:"Reply with exactly the word pong"}` → expect a `user` event then an `assistant` event containing `pong` (≤2 min).
  3. **Dialog:** prompt: `"Use your AskUserQuestion tool to ask me which colour I prefer, options Red, Green, Blue."` → expect a `dialog` message with ≥3 options → `POST .../dialog {dialogId, optionIndex:2}` → expect `dialog_cleared` and a subsequent assistant turn mentioning the chosen colour.
  4. **Interrupt:** prompt a long task ("count to 200 slowly, one number per line") → wait for `status:'busy'` → `POST .../interrupt` → expect status back to `idle` within 30 s.
  5. **Upload:** POST a small PNG to `.../upload` → capture verify via next prompt: `"What file path did I just paste into your prompt box? Send it back."` → assistant reply contains `/.cc-clips/claude2-cctest/`.
  6. **Swap follow:** `POST .../swap {wrapper:'claude'}` → expect fleet to show wrapper `claude` for the id (≤3 min, swap + respawn) → session WS reconnect streams events under the new account (send one more prompt→reply round).
  7. **Stop:** `POST .../stop` → fleet shows status `dead`.
- [ ] **Step 1:** Write helpers + the suite (complete code, all seven phases).
- [ ] **Step 2:** Run: `CCRC_BASE_URL=http://203.0.113.7:7788 npx vitest run test-e2e --testTimeout 300000` — iterate on real-world failures (this is where pane-marker/timing assumptions meet reality; fix server code as needed, keeping unit tests green).
- [ ] **Step 3:** Expected final state: all e2e phases PASS; run `npx vitest run` (units) — still green.
- [ ] **Step 4: Commit** `git add -A && git commit -m "test(ccrc): live e2e suite against cctest on the box"`

---

### Task 4: Fixture re-capture from live panes

- [ ] **Step 1:** With cctest running, drive it to each dialog state and capture real panes into `server/test/fixtures/panes/`: AskUserQuestion (single + multiSelect variants via prompts), `/model` picker (`POST .../prompt {text:"/model"}`, capture, then Esc via interrupt route or terminal), and the trust/resume gates if observable (kill + `ensure` cctest and capture during startup). Capture command: `ssh ... 'tmux capture-pane -t cc-claude2-cctest -p'`.
- [ ] **Step 2:** Replace the authored fixtures with the real captures; run `npx vitest run test/dialog.test.ts` — adjust `parseDialog` until green against reality. Any pane that can't parse must yield `parsed:false` (never a crash).
- [ ] **Step 3:** Document the re-capture procedure in `infra/ccrc/README.md` ("after every Claude Code version bump: re-capture, re-run dialog tests").
- [ ] **Step 4: Commit** `git add -A && git commit -m "test(ccrc): real pane fixtures from live box"`

---

### Task 5: Mobile pass + docs + wrap-up

**Files:**
- Create: `infra/ccrc/README.md`
- Modify: `infra/ccrc/pwa/design/QA-CHECKLIST.md` (mobile column)

- [ ] **Step 1:** Mobile verification on the Android phone (Tailscale on): install from `http://203.0.113.7:7788/` (Chrome → Add to Home screen; verify WebAPK standalone launch). Walk the checklist and record results: fleet loads <2 s warm; open session, send prompt, watch streamed reply; answer a real dialog via bottom sheet; interrupt a busy turn; attach a photo; start + stop a session; move cctest between accounts and watch the chat follow; background the app 5 min → foreground resyncs silently; keyboard never covers the composer; terminal drawer usable one-thumbed (quick-keys work).
- [ ] **Step 2:** Fix what the pass surfaces (mobile findings are expected); re-run unit suites; redeploy; re-verify the failing items.
- [ ] **Step 3:** Write `infra/ccrc/README.md`: what ccrc is, architecture sketch, deploy procedure, fixture re-capture procedure, port/bind facts, troubleshooting (parser drift → terminal drawer + re-capture).
- [ ] **Step 4:** Stop cctest; confirm the six production sessions untouched (`ccd ls` matches pre-e2e state).
- [ ] **Step 5: Commit** `git add -A && git commit -m "docs(ccrc): README, mobile pass results, wrap-up"`

---

## Plan-level acceptance (project done)

- ccrc.service running on the box, bound to the tailnet address only, surviving restarts.
- Full e2e suite green against the live box; unit suites green.
- PWA installed on the phone passes the spec's Native-like bar, Design ambition, and Usability checklists.
- README + fixtures in place; cctest stopped; production fleet untouched.
