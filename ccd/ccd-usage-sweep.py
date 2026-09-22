#!/usr/bin/env python3
"""ccd-usage-sweep.py — the offline accounting sweep (routing spec 2026-09-14 §6).

READ-ONLY over the transcripts. One JSON object out. Runs on the fleet box under
`ccd-usage-sweep` (the bash runner, which supplies the roster map, the class
tokens and the lock).

Every Claude Code transcript line of `type: assistant` carries `message.usage`
and `message.id`; a swap carries whole transcripts across config dirs, and a
streamed reply is split across lines that repeat the same `message.id`, so the
ONLY correct total is a GLOBAL dedupe by message id across every dir scanned
(85% of raw assistant lines were duplicates in the 30-day survey). Dirs are
walked in SORTED order so a carried record is attributed the same way on every
run, and the carry is COUNTED per account ONCE PER RECORD — a streamed reply's
repeated `message.id` still costs `duplicatesRemoved` once per line, but
`carriedAcrossDirs` credits the id only on its first sighting from a dir other
than the one that owns it. The `effort` field is top-level on the line.
Subagent transcripts live under a `subagents/` path segment and/or carry
`isSidechain`. The model-id → class table is NOT here: it is
`shared/models.mjs`'s `FAMILY_TOKENS`, passed in as `--class-tokens`. A class
absent from `PROXY_RATES_USD_PER_MTOK` (e.g. a non-Anthropic lane's model) is
UNPRICED, not free: its records are excluded from every apiUsd sum and
reported separately per account (`fableShare.unpricedRecords` /
`.unpricedClasses`) so "not priced" never silently reads as "cost nothing".
A malformed `usage` value (wrong type, non-numeric count), and an assistant
line whose `message` is not an object at all, each count as one `parseErrors`
and cost only that line, never the run. The `"type":"assistant"` byte test is a
PREFILTER only: a line is counted in `assistantLines` after the PARSE agrees it
is an assistant record, and a prefilter hit the parse contradicts (or a line
that is not a JSON object at all) is counted in `prefilterNotAssistant`. `--reap-orphans`, the tool's only
destructive path, never deletes a sidecar whose `ts` it cannot read — that is
skipped and counted in `orphansSkippedUnreadable`, not treated as old.
"""
import argparse, json, os, sys, time

# A PROXY, labelled as such in the output: the subscription's per-class window
# weights are unpublished (research note 2026-09-13 §6). USD per MTok:
# (input, output, cache_read, cache_write). None = not published for that
# FIELD within a priced class. A class with NO ROW here at all (e.g. "other")
# is UNPRICED, not free — see api_usd().
#
# A ROW IS A CLASS, NOT A MODEL ID, so a family's release re-prices its row
# rather than adding one. `opus` was Opus 5's card (5.00/25.00/0.50/6.25) and
# is Opus 5.5's since 2026-09-22 (the release date; the bare `opus` alias every
# lane runs resolves there, so the whole class re-priced at once and no window
# mixes the two beyond that day). Opus 5.5 is cheaper per token than the model
# it replaced — 4.00 in, 20.00 out, 0.20 cache read, all three operator-supplied
# from the release's published card. CACHE WRITE IS DERIVED, NOT PUBLISHED AT
# LAUNCH: 1.25 × input, the ratio every other row here already carries (5.00 ->
# 6.25, 2.00 -> 2.50, 1.00 -> 1.25). Stated rather than left `None` because what
# this table feeds is a RATIO — the per-account Fable share, fable apiUsd over
# all priced apiUsd — where a hole in the denominator is not neutral: it would
# silently inflate every account's share against the placement ceiling. Replace
# 5.00 with the published figure when there is one.
#
# THE OTHER THREE ROWS ARE UNCHANGED AND STILL SOURCED. sonnet (Sonnet 5) and
# haiku (Haiku 4.5) are their families' current cards. `fable` is the one row
# that is already a blend — the sweep classifies Fable 5 and Fable 5.1 into one
# class (the only split the 30-day scan supports, spec §2) and they share
# 10.00/50.00; their cache-read rates differ (Fable 5.1 reads cheaper than Fable
# 5), so the blended 1.00 here is not re-derivable from either alone and is left
# where the scan put it.
PROXY_RATES_USD_PER_MTOK = {
    "fable":  (10.0, 50.0, 1.00, None),
    "opus":   (4.0,  20.0, 0.20, 5.00),
    "sonnet": (2.0,  10.0, 0.20, 2.50),
    "haiku":  (1.0,   5.0, 0.10, 1.25),
}
RATES_LABEL = ("API rate card, USD per MTok — a PROXY: the subscription's per-class window weights are unpublished; "
               "use for ranking within a window, never as an invoice")
ATTRIBUTION = ("a message id seen in more than one config dir (a swap carries transcripts) is counted ONCE, for the "
               "config dir that sorts first; every such record is also counted in that account's carriedAcrossDirs")
ORPHAN_AGE_S = 86400


def class_of(model, tokens):
    m = (model or "")
    for tok, cls in tokens:
        if tok in m:
            return cls
    return "other"


def api_usd(cls, inp, out, cread, cwrite):
    """USD for one record, or None when `cls` has no row in the rate table —
    UNPRICED, never priced at 0.0 (a class outside the table is not free; it
    is simply not costed here). Callers must skip a None result rather than
    add it, so 'not priced' and 'cost nothing' never collapse."""
    r = PROXY_RATES_USD_PER_MTOK.get(cls)
    if r is None:
        return None
    total = inp / 1e6 * r[0] + out / 1e6 * r[1]
    if r[2] is not None:
        total += cread / 1e6 * r[2]
    if r[3] is not None:
        total += cwrite / 1e6 * r[3]
    return total


def bucket():
    return {"n": 0, "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "apiUsd": 0.0}


def add(b, rec):
    """`rec['apiUsd']` is None for an unpriced class (see api_usd()) — every
    apiUsd sum (perModel, perClass, perAccount, perSession) adds only PRICED
    records; an unpriced record still counts toward n/input/output/etc."""
    b["n"] += 1
    b["input"] += rec["input"]; b["output"] += rec["output"]
    b["cacheRead"] += rec["cacheRead"]; b["cacheWrite"] += rec["cacheWrite"]
    if rec["apiUsd"] is not None:
        b["apiUsd"] += rec["apiUsd"]


def scan(dirs, tokens, now, days, stats, carried):
    """dirs: {configDir: accountId}. Returns {messageId: record}, deduped globally,
    dirs walked in sorted order; `carried[account]` counts each carried-across-dirs
    RECORD once — on the id's first sighting from a dir other than the one that
    owns it — never once per duplicate LINE (a streamed reply repeats the same
    message id across many lines; `duplicatesRemoved` still counts every one)."""
    cutoff_iso = time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(now - days * 86400))
    mtime_cutoff = now - days * 86400
    records = {}
    carried_ids = set()
    for cfg_dir in sorted(dirs):
        account = dirs[cfg_dir]
        carried.setdefault(account, 0)
        root = os.path.join(cfg_dir, "projects")
        if not os.path.isdir(root):
            continue
        for dirpath, _dirnames, filenames in os.walk(root):
            for fn in filenames:
                if not fn.endswith(".jsonl"):
                    continue
                fpath = os.path.join(dirpath, fn)
                stats["files"] += 1
                try:
                    st = os.stat(fpath)
                except OSError:
                    continue
                if st.st_mtime < mtime_cutoff:
                    continue
                stats["filesInWindow"] += 1
                in_subagent_path = (os.sep + "subagents" + os.sep) in fpath
                project = os.path.relpath(fpath, root).split(os.sep)[0]
                try:
                    with open(fpath, "rb") as f:
                        for raw in f:
                            if b'"type":"assistant"' not in raw:
                                continue
                            try:
                                d = json.loads(raw)
                            except Exception:
                                stats["parseErrors"] += 1
                                continue
                            # The byte test above is a PREFILTER, not a verdict:
                            # those bytes can sit anywhere on a line (a quoted
                            # transcript inside a user message, a tool result
                            # echoing one), so `assistantLines` is only counted
                            # once the parsed line SAYS it is one. Lines the
                            # prefilter matched and the parse contradicts are
                            # counted separately, never folded into
                            # `parseErrors` (the line parsed fine) and never
                            # dropped in silence, so the block still reconciles.
                            # `isinstance` first: a JSONL line may be any JSON
                            # value, and `.get` on a list or a string raised an
                            # AttributeError that no `except OSError` below
                            # catches -- one odd line aborted the whole run.
                            if not isinstance(d, dict) or d.get("type") != "assistant":
                                stats["prefilterNotAssistant"] += 1
                                continue
                            stats["assistantLines"] += 1
                            ts = d.get("timestamp")
                            if not isinstance(ts, str):
                                ts = ""
                            if ts[:19] < cutoff_iso:
                                continue
                            # `message` must be an OBJECT to be accounted: the
                            # usage counts and the dedupe id both live in it. A
                            # line carrying anything else is one this scanner
                            # cannot read, so it costs exactly one parseErrors
                            # and is skipped -- never an abort (the isinstance
                            # test is what keeps `.get` off a str/list), and
                            # never a silent drop, which would undercount a
                            # whole lane with no signal in the output (D-2792).
                            msg = d.get("message")
                            if not isinstance(msg, dict):
                                stats["parseErrors"] += 1
                                continue
                            usage = msg.get("usage")
                            mid = msg.get("id")
                            if not usage or not mid:
                                continue
                            if mid in records:
                                stats["duplicatesRemoved"] += 1
                                owner = records[mid]["account"]
                                if owner != account and mid not in carried_ids:
                                    carried[owner] += 1
                                    carried_ids.add(mid)
                                continue
                            try:
                                model = msg.get("model")
                                cls = class_of(model, tokens)
                                inp = int(usage.get("input_tokens") or 0)
                                out = int(usage.get("output_tokens") or 0)
                                cread = int(usage.get("cache_read_input_tokens") or 0)
                                cwrite = int(usage.get("cache_creation_input_tokens") or 0)
                                effort = d.get("effort")
                            except (AttributeError, TypeError, ValueError):
                                # a malformed usage value (wrong type, non-numeric
                                # count) costs one record, never the whole run.
                                stats["parseErrors"] += 1
                                continue
                            records[mid] = {
                                "model": model, "class": cls, "input": inp, "output": out,
                                "cacheRead": cread, "cacheWrite": cwrite,
                                "apiUsd": api_usd(cls, inp, out, cread, cwrite),
                                "effort": effort if isinstance(effort, str) and effort else "none",
                                "sessionId": d.get("sessionId"),
                                "subagent": bool(in_subagent_path or d.get("isSidechain")),
                                "account": account, "project": project,
                            }
                except OSError:
                    continue
    stats["records"] = len(records)
    return records


def read_uuid_map(registry):
    """$REG/<id>.uuid -> {uuid: ccdId}; a dead uuid maps to nobody."""
    out = {}
    try:
        names = os.listdir(registry)
    except OSError:
        return out
    for n in names:
        if not n.endswith(".uuid") or n.startswith("."):
            continue
        try:
            with open(os.path.join(registry, n)) as f:
                u = f.read().strip()
        except OSError:
            continue
        if u:
            out[u] = n[:-len(".uuid")]
    return out


def read_seven(limits, account):
    try:
        with open(os.path.join(limits, account + ".json")) as f:
            row = json.load(f)
    except (OSError, ValueError):
        return None, None
    seven = row.get("seven"); ts = row.get("ts")
    return (seven if isinstance(seven, (int, float)) else None), (ts if isinstance(ts, (int, float)) else None)


def reap_orphans(registry, now):
    """Remove usage/<id>.json (+ <id>.agents/) when no $REG/<id>.uuid exists and the
    row is older than a day. This is the tool's ONLY destructive path, so an id
    whose `ts` is absent, unreadable or malformed is NOT reapable — collapsing
    "unreadable" with "older than a day" would delete on a guess. Such an id is
    skipped and counted in the returned skippedUnreadable, never removed.
    Returns (reaped: [id, ...], skippedUnreadable: int)."""
    reaped = []
    skipped_unreadable = 0
    usage_dir = os.path.join(registry, "usage")
    try:
        names = os.listdir(usage_dir)
    except OSError:
        return reaped, skipped_unreadable
    for n in sorted(names):
        if not n.endswith(".json") or n.startswith("."):
            continue
        sid = n[:-len(".json")]
        if os.path.exists(os.path.join(registry, sid + ".uuid")):
            continue
        try:
            with open(os.path.join(usage_dir, n)) as f:
                ts = (json.load(f) or {}).get("ts")
        except (OSError, ValueError):
            ts = None
        if not isinstance(ts, (int, float)):
            skipped_unreadable += 1
            continue
        if now - ts <= ORPHAN_AGE_S:
            continue
        try:
            os.remove(os.path.join(usage_dir, n))
        except OSError:
            continue
        agents = os.path.join(usage_dir, sid + ".agents")
        if os.path.isdir(agents):
            for root, ds, fs in os.walk(agents, topdown=False):
                for x in fs:
                    try: os.remove(os.path.join(root, x))
                    except OSError: pass
                for x in ds:
                    try: os.rmdir(os.path.join(root, x))
                    except OSError: pass
            try: os.rmdir(agents)
            except OSError: pass
        reaped.append(sid)
    return reaped, skipped_unreadable


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dirs", required=True, help='JSON object {configDir: accountId}')
    ap.add_argument("--class-tokens", required=True, help='JSON array [[substring, class], ...] — shared/models.mjs FAMILY_TOKENS')
    ap.add_argument("--registry", required=True)
    ap.add_argument("--limits", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--now", type=int, default=None)
    ap.add_argument("--reap-orphans", action="store_true")
    a = ap.parse_args()
    now = a.now if a.now is not None else int(time.time())
    started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    dirs = json.loads(a.dirs)
    tokens = json.loads(a.class_tokens)
    if not isinstance(tokens, list) or not all(isinstance(t, list) and len(t) == 2 for t in tokens):
        print("usage-sweep: --class-tokens must be a JSON array of [substring, class] pairs", file=sys.stderr)
        return 2
    stats = {"files": 0, "filesInWindow": 0, "assistantLines": 0, "prefilterNotAssistant": 0,
             "parseErrors": 0, "records": 0, "duplicatesRemoved": 0}
    carried = {}
    records = scan(dirs, tokens, now, a.days, stats, carried)
    uuid_map = read_uuid_map(a.registry)

    per_model, per_class, per_effort, per_account, per_session = {}, {}, {}, {}, {}
    unpriced_records, unpriced_classes = {}, {}
    for rec in records.values():
        add(per_model.setdefault(rec["model"] or "(none)", bucket()), rec)
        add(per_class.setdefault(rec["class"], bucket()), rec)
        pe = per_effort.setdefault(rec["effort"], {"n": 0, "output": 0})
        pe["n"] += 1; pe["output"] += rec["output"]
        acct = per_account.setdefault(rec["account"], {"n": 0, "apiUsd": 0.0, "perClass": {}})
        acct["n"] += 1
        if rec["apiUsd"] is not None:
            acct["apiUsd"] += rec["apiUsd"]
        else:
            unpriced_records[rec["account"]] = unpriced_records.get(rec["account"], 0) + 1
            unpriced_classes.setdefault(rec["account"], set()).add(rec["class"])
        add(acct["perClass"].setdefault(rec["class"], bucket()), rec)
        sid = rec["sessionId"] or "(none)"
        s = per_session.setdefault(sid, {"ccdId": uuid_map.get(sid), "account": rec["account"], "project": rec["project"],
                                         "n": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0, "apiUsd": 0.0,
                                         "subagentN": 0, "models": {}, "efforts": {}})
        s["n"] += 1; s["output"] += rec["output"]; s["cacheRead"] += rec["cacheRead"]; s["cacheWrite"] += rec["cacheWrite"]
        if rec["apiUsd"] is not None:
            s["apiUsd"] += rec["apiUsd"]
        if rec["subagent"]:
            s["subagentN"] += 1
        s["models"][rec["model"] or "(none)"] = s["models"].get(rec["model"] or "(none)", 0) + 1
        s["efforts"][rec["effort"]] = s["efforts"].get(rec["effort"], 0) + 1

    for account in sorted(set(dirs.values())):
        acct = per_account.setdefault(account, {"n": 0, "apiUsd": 0.0, "perClass": {}})
        acct["carriedAcrossDirs"] = carried.get(account, 0)
        # acct["apiUsd"] is already PRICED-only (add()/the manual accumulation
        # above both skip a None apiUsd), so this ratio is fable-priced over
        # all-priced — never let an unpriced class read as "cost nothing".
        fable = acct["perClass"].get("fable", {}).get("apiUsd", 0.0)
        estimate = (fable / acct["apiUsd"]) if acct["apiUsd"] > 0 else None
        seven, seven_ts = read_seven(a.limits, account)
        acct["fableShare"] = {"estimate": estimate,
                              "basis": ("fable apiUsd / all PRICED apiUsd in the window (unpriced classes "
                                        "excluded and listed; a PROXY, see rates.label)"),
                              "sevenPct": seven, "sevenTs": seven_ts,
                              "carriedAcrossDirs": carried.get(account, 0),
                              "unpricedRecords": unpriced_records.get(account, 0),
                              "unpricedClasses": sorted(unpriced_classes.get(account, set()))}

    reaped, orphans_skipped_unreadable = reap_orphans(a.registry, now) if a.reap_orphans else ([], 0)

    out = {"schema": 1, "startedAt": started, "finishedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
           "windowDays": a.days, "now": now, "scan": stats, "attribution": ATTRIBUTION,
           "rates": {"label": RATES_LABEL, "table": {k: list(v) for k, v in PROXY_RATES_USD_PER_MTOK.items()}},
           "perModel": per_model, "perClass": per_class, "perEffort": per_effort,
           "perAccount": per_account, "perSession": per_session, "orphansReaped": reaped,
           "orphansSkippedUnreadable": orphans_skipped_unreadable}
    tmp = a.out + ".tmp"
    with open(tmp, "w") as f:
        json.dump(out, f, indent=1, sort_keys=True)
    os.replace(tmp, a.out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
