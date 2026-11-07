# Node runtime under nvm — design

**Status:** approved by the operator 2026-10-26. **Scope:** Linux `ccrc install` / `update` / `doctor` /
`uninstall`, `install.sh` and `deploy/deploy.sh`.

## Problem

Every systemd user unit ccrc installs reaches node by name: `ccrc.service` and `ccrc-agent.service` run
`/usr/bin/env node …`, five timers' scripts call `node`, the update watchdog and `ccrc update --detach` preflight
`node`, and session panes (started under the supervisor, so with the manager's environment) run the session hook's
`node compact-card.mjs` / `approval-verify.mjs` and `ccrc history`. They all resolve `node` on the **user
manager's** PATH. A box whose node comes from nvm (`~/.nvm/versions/node/vX/bin`) has node on the operator's shell
PATH only, so `ccrc install` succeeds, the build succeeds, and `ccrc.service` crash-loops with
`env: 'node': No such file or directory` (exit 127). The README told nvm users to hand-write an
`~/.config/environment.d` fragment; nothing wrote it.

## Decisions

1. **The appropriate node** is the one that satisfies `engines.node` in the shipped `server/package.json` (agent's on
   a fleet tree) — the floor stays written once. Under nvm: nvm's `default` alias if it qualifies, else the newest
   installed version that qualifies.
2. **None qualifies under nvm, and the PATH node does not either:** `nvm install --lts`. nvm's `default` alias is never changed.
3. **Chosen once, at install/update time**, never per service start. Doctor re-measures it.
4. **Only an interactive run installs node** (stdin is a TTY). An unattended run (`update --detach`, the watchdog,
   the console) picks among installed versions and refuses with one clear line when none qualifies.
5. **nvm only** for installation, with the PATH node as the fallback. Order: (1) an installed nvm version (decision
   1); (2) the installer shell's `command -v node`, if it qualifies; (3) only then, interactively, `nvm install
   --lts` (decisions 2 and 4); (4) refuse, saying what each step found. Step 2 is a controller ruling of 2026-10-26: a
   box with nvm present that runs a qualifying system node must not lose its unattended updates. Without nvm, steps
   2 and 4 alone apply, which also fixes fnm, volta, asdf and mise boxes with no code of their own.
6. **How units reach it:** a ccrc-owned directory `~/.local/libexec/ccrc/node-bin/` holding exactly three
   symlinks, `node`, `npm`, `npx`, to the chosen install; and `~/.config/environment.d/50-ccrc-node.conf` putting
   that directory first on the user manager's PATH, followed by `systemctl --user daemon-reload` (which re-runs the
   environment generators, `systemd.environment-generator(7)`). Re-choosing re-points the links; the PATH line never
   changes. `ccrc-models.service`, whose `Environment=PATH=` replaces the manager's PATH, names the directory too.
   Unit files stay byte-identical to the tree and `ExecStart` keeps `/usr/bin/env node`.
   - Rejected: an absolute node path in `ExecStart` — fixes two units, not the by-name callers.
   - Rejected: a PATH drop-in per unit — enumerates every unit and spells the whole PATH in each.
   - Rejected: nvm's whole `bin` directory on PATH — for a system node the same rule would put all of `/usr/bin` first.
7. **Written on every box**, including one whose system node already qualifies (the links then point at it).
8. **`install.sh`** runs the same selection before it builds, so the build and the units use one node.
9. **Doctor `node-path`** fails on a missing/broken link, a target below the floor, a missing fragment, or a manager
   PATH without the directory; `--fix` re-chooses among installed versions and reloads, never installs.
10. **`deploy/deploy.sh`** (the fallback installer) runs the same selection and publication ON THE BOX, in each
    lane's remote build: select before `npm ci` (so the box's build uses the chosen node), publish after the units
    are placed. Its ssh is non-interactive, so it never installs node; a box with no qualifying node fails the
    deploy with the selection's own line. (Operator ruling 2026-10-26: in this PR, not deferred.)
11. **`ccrc uninstall`** removes the directory and the fragment, then reloads the manager.

## Out of scope

- macOS: launchd plists already bake the installer's PATH (`_svc_job_path`).
- Codex runtimes: they run an absolute python and need no node.

## Deviations

- D-TBD-node-runtime-under-nvm: README's "nvm users write an environment.d fragment by hand" advice is retired; the
  installer writes the fragment. (Number not issued: the ledger allocator is box-token gated and unreachable from
  the authoring session.)
