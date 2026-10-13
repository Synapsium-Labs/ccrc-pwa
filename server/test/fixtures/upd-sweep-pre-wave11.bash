# FROZEN (wave 11, D-3982) — `_upd_sweep` exactly as every release from v0.0.60 through v0.0.84 ships it, measured
# per tag. The move INTO wave 11 runs THIS function (the box's old ccrc) with the new tree's verify-service.sh, so
# `ccrc-sweep-deliberate-stop.test.ts` sources it over this tree's ccd/ccrc and runs it. Never edit what follows:
# X0 pins its sha256, and X0c pins the tree's helpers it calls. If a later wave must change one of those helpers,
# it freezes v0.0.84's copy here, below the function, first. Retire this file and its cases once no box's ~/ccrc,
# or kept ~/ccrc-versions/<tag>, predates wave 11's release.
_upd_sweep() {
  # ── THE DARWIN ARM ──────────────────────────────────────────────────────
  # Same job, same guard, different observable. The sweep exists because a
  # live supervisor keeps executing the OLD ccd until it is restarted, and its
  # refusal exists because a restart that kills the whole process group would
  # take every pane with it. On Linux the property is `KillMode=process`, read
  # back from systemd. On macOS it is `AbandonProcessGroup` — and it is read
  # back from the PLIST ON DISK rather than from launchd, because that file is
  # what launchd will act on at the next kickstart and `launchctl print` does
  # not report the key at all.
  #
  # A plist missing the key is a session enabled by an OLDER ccd, before the
  # key was written. Refusing is right for exactly the Linux reason: the sweep
  # would kill panes. The remedy is per-session and safe — `ccd start <id>`
  # rewrites the plist through `_svc_write_session_plist`.
  if [ "$CCD_OS" = darwin ]; then
    local u sid plist missing=0
    for u in $(_svc_list_sessions); do
      plist="$(_svc_plist "$u")"
      [ -f "$plist" ] || continue
      if ! grep -q 'AbandonProcessGroup' "$plist"; then
        # `ccd start` takes the BARE session id — both decorations stripped,
        # or the remedy hands the operator an id ccd does not recognise.
        sid="${u#claude-session@}"; sid="${sid%.service}"
        echo "update: sweep REFUSED — $(_svc_plist "$u") carries no AbandonProcessGroup, and the sweep needs it: without that key launchd kills the job's whole process group on restart, and whenever the tmux server placement falls back to a bare create every session on this box is a child of ONE tmux server — so a restart would take the lot. Re-enable that session to rewrite its job file: ccd start $sid" >&2
        missing=1
      fi
    done
    if [ "$missing" = 1 ]; then
      # STDOUT, exactly as the Linux arm's DEGRADED line is: the two-stream
      # split is the function's stated contract (the header above — stderr is
      # the diagnosis, stdout is the transcript of what the update did and did
      # not do), and a stdout-only capture of a macOS run must not read as a
      # clean update. The remedy tail names the per-session fix the same way
      # the Linux line names its try-restart.
      echo "update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted. Fix the job files above (ccd start <id> rewrites each), then restart per session: launchctl kickstart -k $(_svc_domain)/<label>"
      return 0
    fi
    # `_svc_try_restart`'s `_svc_is_loaded || return 0` skips a job launchd no
    # longer holds — which is exactly where a `.svcfailed` session sits: the
    # start-limit emulation booted it out when it gave up (`cmd_supervise`).
    # The Linux arm warns about `--state=failed` units try-restart skipped;
    # silence here would be the same session, skipped with no line at all.
    # A plist that is merely NOT LOADED (next login will bootstrap it) is not
    # this update's business and is skipped without comment, exactly as a
    # stopped unit is on Linux.
    local -a kicked=()
    for u in $(_svc_list_sessions); do
      if [ "$(_svc_is_active "$u")" = failed ]; then
        sid="${u#claude-session@}"; sid="${sid%.service}"
        echo "update: warning: $u is FAILED (start-limit stamp) — the sweep skipped it and did not verify it. On the box: ccd start $sid (it clears the stamp and re-bootstraps the job)" >&2
        continue
      fi
      _svc_is_loaded "$u" || continue
      _svc_try_restart "$u" \
        || _ccrc_die "restarting $u failed — the supervisors' state is now mixed; read: $(_svc_status_hint "$u"). The pre-update backup is complete at $UPD_BACKUP_DIR"
      kicked+=("$u")
    done
    # THE STAY-UP GATE, and it is the half the first cut of this arm dropped:
    # kickstart's exit is the exit of the KICK, not of the process surviving
    # it — the exact gap deploy/verify-service.sh's header describes for
    # systemd, and the reason the Linux arm below runs that script per active
    # unit. Each restarted supervisor is held to the same standard here, and
    # the failure names the rollback the way the Linux `_ccrc_die` does —
    # this is the one line in the whole update path that points an operator
    # at the backup, and on macOS it must be able to fire.
    for u in ${kicked[@]+"${kicked[@]}"}; do
      _ccrc_job_stayed_up "$u" \
        || _ccrc_die "$u was restarted and did not stay up ($CCRC_STAYED_DETAIL) — read: $(_svc_status_hint "$u"). The pre-update backup is complete at $UPD_BACKUP_DIR"
    done
    # Wave 8 item G: a claim of "every … now runs the ccd this update
    # installed" is false on a box with nothing loaded — there was nothing to
    # verify. `kicked` is the set `_svc_try_restart` actually touched.
    if [ "${#kicked[@]}" -eq 0 ]; then
      echo "update: sweep: no loaded claude-session@ supervisor on this box, so nothing was restarted (AbandonProcessGroup is checked per job file when there is one)"
    else
      echo "update: sweep: every live claude-session@ supervisor now runs the ccd this update installed (AbandonProcessGroup verified in every job file; ${#kicked[@]} restarted and re-measured still up)"
    fi
    return 0
  fi
  # The bus contingency `_inst_enable` carries, for the same reason: without
  # XDG_RUNTIME_DIR, `systemctl --user` from a non-interactive context fails
  # for a reason that has nothing to do with this box.
  : "${XDG_RUNTIME_DIR:=/run/user/$UID}"; export XDG_RUNTIME_DIR
  : "${DBUS_SESSION_BUS_ADDRESS:=unix:path=${XDG_RUNTIME_DIR}/bus}"; export DBUS_SESSION_BUS_ADDRESS
  local u km listing lu _ll la _lr lrc=0
  local -a before=() after=() failed=()
  listing="$(systemctl --user list-units "claude-session@*" --plain --no-legend)" || lrc=$?
  # fix round 1 item 1 (D-3599): the plan's Task 5 code dropped this rc with
  # `|| :` and built `before` from this listing alone, so a transient failure
  # here (an unread listing) left `before` empty and the zero line below
  # claimed no supervisor was active even while every one of them was — an
  # unmeasured pre-sweep listing is now a failed preflight: the sweep refuses
  # and restarts nothing, exactly as the KillMode preflight below already
  # does, rather than claim a clean sweep it never measured.
  if [ "$lrc" -ne 0 ]; then
    echo "update: sweep REFUSED — systemctl --user list-units \"claude-session@*\" --plain --no-legend failed (rc $lrc), so the supervisors to be checked could not be listed." >&2
    echo "update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted. Once systemctl --user list-units 'claude-session@*' answers, confirm KillMode=process on each unit, then restart them."
    return 0
  fi
  # Wave 8 item G: the supervisors the restart below can touch are the ones
  # ACTIVE before it runs — read from THIS listing's ACTIVE column (`--plain
  # --no-legend`: UNIT LOAD ACTIVE SUB DESCRIPTION), so no systemctl call is
  # added, and the argv order below is unchanged.
  while read -r lu _ll la _lr; do
    [ "$la" = active ] && before+=("$lu")
  done <<< "$listing"
  for u in $(printf '%s\n' "$listing" | awk '{print $1}') \
           claude-session@ccrc-update-preflight.service; do
    km="$(systemctl --user show -p KillMode "$u" 2>/dev/null)" || km=""
    if [ "$km" != "KillMode=process" ]; then
      echo "update: sweep REFUSED — $u resolves to ${km:-no answer from systemd}, and the sweep needs KillMode=process: systemds default is control-group, and whenever the tmux server placement falls back to a bare create every session on this box is a child of ONE tmux server sitting in a claude-session@ cgroup, so try-restart would kill the lot. A drop-in under $BOX_UNIT_DIR/claude-session@.service.d/ can set this without the base unit changing a byte." >&2
      echo "update: DEGRADED: the supervisor sweep did not run — every live claude-session@ supervisor keeps executing the PREVIOUS ccd until restarted. Fix the KillMode above, then: systemctl --user try-restart 'claude-session@*'"
      return 0
    fi
  done
  # fix round 1 item 7 (review 196 F8): the argv-order pin is
  # `ccrc-update.test.ts`'s "with KillMode=process resolving per unit, the
  # sweep runs: preflight, try-restart, the failed warn query, the active
  # verify query — in that argv order" case — cited by title, since its line
  # range moves.
  systemctl --user try-restart "claude-session@*" \
    || _ccrc_die "systemctl --user try-restart claude-session@* failed — the supervisors' state is now mixed; read: systemctl --user list-units 'claude-session@*'"
  # try-restart is a no-op on a failed unit (its own man page), so a
  # pre-existing failed session was neither restarted nor verified — not this
  # update's doing, must not fail it, must not be silent either.
  for u in $(systemctl --user list-units "claude-session@*" --state=failed --plain --no-legend | awk '{print $1}'); do
    echo "update: warning: $u is FAILED — try-restart skipped it and this sweep did not verify it. On the box: systemctl --user reset-failed $u, then ccd start the session" >&2
    failed+=("$u")
  done
  # Each restarted supervisor is held to the same standard as the services the
  # staged install just verified — verify-service.sh out of the NEW tree,
  # guarded by [ -f ] exactly as `_inst_enable` guards it. `--state=active`
  # here and NOT above: handing verify-service.sh a unit try-restart never
  # touched is deploy.sh's final-review finding 6.
  local verify="$BOX_TREE_DIR/deploy/verify-service.sh"
  local after_listing arc=0
  after_listing="$(systemctl --user list-units "claude-session@*" --state=active --plain --no-legend)" || arc=$?
  # fix round 1 item 1 (D-3599): the same unmeasured-listing hazard, on the
  # verify side — an unmeasured verify listing verifies nothing, so when
  # something WAS restarted (`before` non-empty) the per-unit "not active
  # after it" warnings and the success line below must not fire over a set
  # nobody actually re-listed. When `before` was measured empty, nothing that
  # was running was restarted, so this fork is skipped and the zero line
  # below prints exactly as it does today.
  if [ "$arc" -ne 0 ] && [ "${#before[@]}" -gt 0 ]; then
    echo "update: warning: the post-restart set could not be listed (systemctl --user list-units \"claude-session@*\" --state=active --plain --no-legend failed, rc $arc) — no supervisor was verified." >&2
    echo "update: DEGRADED: every live claude-session@ supervisor was restarted, and none of them was verified by this sweep."
    return 0
  fi
  for u in $(printf '%s\n' "$after_listing" | awk '{print $1}'); do
    if [ -f "$verify" ]; then
      bash "$verify" "$u" \
        || _ccrc_die "$u was restarted and did not stay up — read: systemctl --user status $u. The pre-update backup is complete at $UPD_BACKUP_DIR"
    fi
    after+=("$u")
  done
  # Wave 8 item G: a claim that "every … now runs the ccd this update
  # installed" is false for a unit that WAS active before try-restart and is
  # neither active nor failed after it — this sweep did not verify it, and
  # the operator needs to know which one. Keyed on the PRE-restart set,
  # `before`, never `after` (a unit this box never had cannot be a miss).
  local b a seen
  for b in ${before[@]+"${before[@]}"}; do
    seen=0
    for a in ${after[@]+"${after[@]}"} ${failed[@]+"${failed[@]}"}; do [ "$a" = "$b" ] && { seen=1; break; }; done
    [ "$seen" -eq 1 ] || echo "update: warning: $b was active before try-restart and is not active after it — this sweep did not verify it. On the box: systemctl --user status $b" >&2
  done
  if [ "${#before[@]}" -eq 0 ]; then
    echo "update: sweep: no claude-session@ supervisor was active when the sweep began, so try-restart had nothing running to restart (KillMode=process verified before the restart; panes untouched)"
    return 0
  fi
  echo "update: sweep: every live claude-session@ supervisor now runs the ccd this update installed (KillMode=process verified per unit before any restart; panes untouched)"
}
