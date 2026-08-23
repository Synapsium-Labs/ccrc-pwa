# Security policy

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Report it through GitHub's private vulnerability reporting on this repository
(*Security* → *Report a vulnerability*). That channel is private to the maintainers and
lets us fix an issue before it is described in public.

If private reporting is unavailable to you, open a public issue containing **only** the
words "security report, requesting private contact" and nothing about the finding itself,
and a maintainer will open a private channel.

This is a single-maintainer project. "Within a few days" is the truthful expectation for
an acknowledgement, not a contractual one.

## What this project is, and why the surface is unusual

ccrc drives **Claude Code sessions on real machines**. In its normal shape it runs shell
commands, manages tmux panes and systemd units, reads and writes git worktrees, and
exposes a web UI that can do all of the above from a phone. A defect here is not a defect
in a web app that renders text — it can be arbitrary code execution on a developer's box.

That makes the following especially worth reporting:

- Any path where the session gate (`server/src/auth/`) can be bypassed, or fails **open**
  rather than shut.
- Any way to reach an exec path (`ccd`, `tmux`) with arguments the whitelist was meant to
  refuse, or to escape the argument brand (`CcdArgv`) that gates it.
- Any way for a page on another origin to drive this server (CSRF, WebSocket upgrade from
  a foreign origin, cookie scope).
- Anything that leaks a token, passphrase hash, or session id into a log, a transcript, an
  error message, or a URL.
- Anything that lets an unauthenticated caller learn the fleet's shape.

## What is already known and by design

- **Identity on the fleet host is attribution, not authentication.** ccrc runs as a single
  UNIX user; `ccd` has no caller auth. The exec whitelist guards the
  PWA → server → agent path only. A process already running as that user is inside the
  trust boundary by construction. This is documented, not a finding.
- **`CCRC_AUTH` defaults off.** A fresh install is unauthenticated and bound to loopback;
  arming is an explicit operator step (`ccrc passwd` + `ccrc expose`). Reporting "the
  default install has no password" tells us something we say ourselves — but reporting a
  box that is *exposed* and still unauthenticated is very much a finding.
- **Exposure always terminates TLS at a certificate you arranged.** `ccrc expose` takes
  `duckdns` (a free public name) or `byo` (your own domain); there is no mode that skips
  the certificate. A box reachable over plain HTTP is a misconfiguration, and reporting
  one is welcome.

## Supported versions

Pre-1.0: only the latest tag receives fixes. There are no backports.
