// The texts that move with the expiry lane (workspace lifecycle spec 2026-09-24 §5.3 "The contracts that move", §6
// item 1; wave 3b). They land in the SAME commit as the lane's live arm or after it, never before, so no text claims
// a cleanup that does not run (the coordinator's ruling (F)). Each is pinned by what it must SAY, so a later edit
// that drops the claim reds here rather than leaving the docs behind the code.
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..', '..');
const read = (p: string): string => readFileSync(path.join(root, p), 'utf8');
/** Whitespace folded, so a re-wrapped paragraph still matches. */
const flat = (p: string): string => read(p).replace(/\s+/g, ' ');

describe('README: what happens to an archived workspace now', () => {
  const readme = flat('README.md');
  it('says it is cleaned up seven days after its archive, shadowed until the operator arms it, under the one switch', () => {
    const at = readme.indexOf('**Archived workspaces are cleaned up after seven days**');
    expect(at, 'the paragraph is gone').toBeGreaterThan(-1);
    const para = readme.slice(at, at + 3200);
    // The ARMING CONDITION is the paragraph's first claim, not its footnote (the coordinator's ruling): true before and after.
    expect(para).toContain('once the operator has armed the lane with `$REG/expire-lane-live`; until then the lane only records what it would expire');
    expect(para).toContain('`$REG/expire-lane-live`');
    expect(para).toContain('would expire');
    expect(para).toContain('`$REG/reclaim-paused` is the fleet’s one cleanup switch');
    expect(para).toContain('never kills');
  });
  it('says a kept leaf is listed, an older ccd’s silence is the feed row’s, and a day of resumable failures slows the asking (wave 5)', () => {
    const at = readme.indexOf('**Archived workspaces are cleaned up after seven days**');
    const para = readme.slice(at, at + 4200);
    expect(para).toContain('is listed, saying what was kept and why, until the server restarts');
    expect(para).toContain('a fleet box whose ccd predates that report says so in the feed row only');
    // Listed from the ladder's hour (a box answer at once); the day is when it STANDS (review 355, F6).
    expect(para).toContain('is listed after an hour (a box answer at once) and retried, backing off; after a day it becomes a standing entry, with the first failure, the attempts and the last error, asked again four hours after each failed attempt (sooner after an answer that ends no attempt), never stopping.');
    expect(para).not.toContain('is retried, backing off, for a day;');
    expect(para).toContain('The entry stays through a hold, a shadow audit or any other answer that ends no attempt, until an attempt completes, finds that none had begun or stops for good, or the workspace is archived again');
    expect(para).not.toContain('stops asking for that archive');
  });
  it('says a stuck cleanup is listed at once, a cleanup that never began is audited afresh and counted, and a box with no flock halts the lane (wave 6)', () => {
    const at = readme.indexOf('**Archived workspaces are cleaned up after seven days**');
    const para = readme.slice(at, at + 5200);
    // Review 381, F5 (ruling (m)): the stuck entry has an end rule of its own, and an answer that ccd stopped before an attempt began is not it.
    expect(para).toContain('One that met `containment-refuted` is listed at once on that cadence, and ccd’s stopping before an attempt began does not end it (an attempt completing, a verdict stopping it, or a fresh archive does);');
    expect(para).toContain('one ccd stopped before it began is audited afresh, and listed after an hour if that recurs;');
    expect(para).toContain('a box with no `flock` gets no cleanup at all until the server restarts.');
    expect(para).not.toContain('a restart does not end it');
    expect(para).toContain('The spec\'s §12 lists what to know before arming this lane or the next.');
    expect(para).not.toContain('asked again every four hours');
  });
  it('README says ws-expire’s own documents carry crumb since wave 6 — never that they omit it', () => {
    expect(readme).toContain('every `ws-collect` document; `ws-expire` says it too since workspace lifecycle wave 6)');
    expect(readme).not.toContain('`ws-expire`\'s own pre-breadcrumb documents, its resumed arm\'s `probe-unmeasured`, every `ws-collect` document');
  });
  it('the coordinator’s own workspace: by a human — or, with no child marker, by the server seven days after its archive', () => {
    expect(readme).toContain('a coordinator\'s own workspace is still cleaned up by a human — or, when it carries no child marker, by the server seven days after it is archived, once the operator has armed the expiry lane with `$REG/expire-lane-live` (until then the lane only records what it would expire)');
  });
  it('every other passage that names the switch says it stops the expiry too, and calls the row the cleanup row', () => {
    expect(readme).toContain('The cleanup row beneath it keeps the same discipline for `$REG/reclaim-paused`, the fleet\'s one cleanup switch');
    expect(readme).toContain('it pauses every reclamation, every expiry and the dead-coordinator lane fleet-wide');
    expect(readme).toContain('and the expiry of archived workspaces stops too');
    expect(readme).toContain('raise / lower the cleanup pause (`$REG/reclaim-paused`: child reclamation, the expiry of archived workspaces and the dead-coordinator lane)');
    expect(readme, 'the row is not the reclaim row any more').not.toContain('reclaim row on `/runs`');
  });
});

describe('the coordinator’s reference, §6', () => {
  it('a child that has coordinated stays a human’s; an unmarked workspace is the server’s seven days after its archive', () => {
    const s = flat('ccd/coordinator-skill/references/wave-lifecycle.md');
    // `has-coordinated` keeps its `.child` marker, and neither lane ever expires a marked child (CCR-15; spec §5.3).
    expect(s).toContain('`has-coordinated` means the child has coordinated a run, so its workspace is cleaned up by a human. No');
    expect(s).toContain('it stays until a human cleans it up, or — when it carries no child marker — until the server cleans it up seven days after it is archived, once the operator has armed the server’s expiry lane (until then the lane only records what it would expire)');
  });
  it('clause 3 says it too: the cleanup follows the archive once the operator has armed the lane — never for a child', () => {
    // A nested coordinator's own workspace is a CHILD, CCR-15's, never expired (review 313, parked item 3).
    const clause = flat('ccd/coordinator-skill/SKILL.md');
    expect(clause).toContain('this session’s own workspace is cleaned up by a human, or — when it carries no child marker — by the server seven days after it is archived once the operator has armed the server’s expiry lane (until then the lane only records what it would expire).');
  });
  it('no skill file names the lane’s live switch — a session told about the dial could arm a deletion', () => {
    const skills = ['ccd/coordinator-skill', 'ccd/worker-skill', 'ccd/reviewer-skill'];
    const files = skills.flatMap((d) => readdirSync(path.join(root, d), { recursive: true, encoding: 'utf8' })
      .filter((f) => f.endsWith('.md')).map((f) => path.join(d, f)));
    expect(files.length, 'an empty corpus would pass vacuously').toBeGreaterThan(3);
    for (const f of files) expect(read(f), f).not.toContain('expire-lane-live');
  });
});

describe('the specs', () => {
  it('CCR-15 §5.8: the pause is the fleet’s one cleanup switch now — the expiry stops with it', () => {
    const s = flat('docs/superpowers/specs/2026-09-22-child-workspace-reclamation-design.md');
    expect(s).not.toContain('Pausing stops reclamation fleet-wide and nothing else;');
    expect(s).toContain('Pausing stops reclamation fleet-wide, and — since workspace lifecycle wave 3b — the expiry of archived workspaces too');
  });
  it('the lifecycle design §5.3 records the shadowed lane, and §6 item 1 as amended', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s).toContain('**As wave 3b builds the lane**');
    expect(s).toContain('`$REG/expire-lane-live`');
    expect(s).toContain('Amended by this design’s wave 3b');
    // The words carry the arming condition (the coordinator's ruling), and the two spec places that quote clause 3 say so.
    expect(s).toContain('**The words carry the arming condition**');
    expect(s).toContain('Coordinator clause 3\'s closing sentence (§5.3). Amended by this design’s wave 3b');
    // Review 313's residue, closed by wave 4: each of its departures reaches §5.3's list, so the spec says what shipped.
    expect(s).toContain("**Review 313's residue, closed by wave 4**");
    for (const said of ['backs off on the failure ladder and is listed', 'learn slots go in `nextAskAt` order',
      'listed at once and never asked again for that archive', 'ends the row\'s would-expire, in-use and held reports',
      // The residue sentence is exact about a hold (final review of wave 4, B-F1): the box's verdicts stand on a sighting
      // that is NOT held; a hold replaces a non-final report and the row is re-audited once it is due after the release.
      'the verdicts the box itself gave (refused, failing, no evidence) stand on a sighting that is not held',
      'a hold replaces a non-final report (a would-expire, an in-use or a retryable failing one) and the row is re-audited as soon as it is due again after the release',
      'a hold never replaces a report whose row the lane has stopped asking',
      'reads no archive from a ccd that prints the instant',
      'is a row that moved', 'names its instant (`due <instant>`), never a period']) expect(s).toContain(said);
    // An ineligible sighting does NOT clear every report: the box's own verdicts stand (review of wave 4's Task 4, I1).
    expect(s).not.toContain('clears every report');
  });
  it('§5.3 records wave 5’s follow-ups: the consent binds the branch, a failed state-changed is audited afresh, a kept leaf, a day of failures', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    expect(s).toContain("**As wave 5 closes the lane's follow-ups**");
    for (const item of ['**The consent binds the branch.**', '**A `failed` `state-changed` is audited afresh.**', '**A kept leaf is listed.**',
      '**A day of resumable failures slows the asking.**', 'A branch already absent when the token was minted reads absent twice and expires with its work in the attic',
      'An absent key (an older ccd) is recorded in the feed row as unmeasured and lists nothing',
      'mints a fresh token over what stands', 'The lane asks again four hours after each failed attempt, never stopping',
      'No answer that ends no attempt replaces the entry or resets its run', 'finds that none had begun',
      // The attached shape is the pin's to refuse (review 355, F2), and the tier's clock is the verb's alone (F3).
      'With HEAD symbolic to `ws/<slug>`, a branch deleted inside the lock is refused earlier, at the pin, as `pin-failed`, before the breadcrumb: resumable on a ccd older than wave 6, audited afresh since (below)',
      "A failure of the act's own audit never reaches the persistent tier, only the verb's does"]) expect(s).toContain(item);
    for (const gone of ['is final.**', 'stops the asking.**', 'The lane does not ask again until the archive changes',
      '(a branch deleted, or made, in between)', 'The lane asks again every four hours', 'and an arming blocker for the lane until then',
      'its feed row\'s "nothing was deleted" is about that audit alone']) expect(s).not.toContain(gone);
  });
  it('§5.3 records wave 6: ws-expire says crumb and the lane reads it first, containment-refuted is stuck, a recurring restart is counted, and the words say when', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const w6 = s.slice(s.indexOf('- **As wave 6 closes the lane**'), s.indexOf('### 5.4 Stage 4'));
    expect(w6.length, 'the wave-6 bullet sits in §5.3').toBeGreaterThan(100);
    for (const item of ['**`ws-expire` says `crumb`, and the lane reads it first.**', '**`containment-refuted` is stuck.**',
      '**A restart that recurs is counted.**', '**The words say when.**',
      'The parser reads the word, then `crumb`: `false` is audited afresh, `true` is resumed, and an absent or non-boolean `crumb` (an older ccd) falls back to the word rule above, exactly',
      'goes straight to the persistent tier', 'a terminal verdict still outranks it', 'On the wire it is a `failing` entry: no new word',
      'It never reaches the persistent tier, since nothing it started stands',
      'gets no cleanup composed at all, for any workspace, until the server restarts', 'it never says nothing was deleted']) expect(w6).toContain(item);
  });
  it('§5.3\'s attention-list paragraph says a restart can ask again, behind a fresh audit (whole-branch re-review)', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const at = s.indexOf('- **The attention list is the lane\'s own memory.** Child reclamation derives');
    expect(at, 'the §5.3 attention-list paragraph is there').toBeGreaterThan(-1);
    const para = s.slice(at, s.indexOf('- **As wave 5 closes the lane\'s follow-ups**', at));
    expect(para.length, 'the paragraph is bounded').toBeGreaterThan(100);
    expect(para).toContain('which can delay an expiry and can ask again a row the lane had stopped asking, always behind a fresh audit whose token ccd proves again inside its lock (§12)');
    expect(para).not.toContain('never cause one');
  });
  it('§12 says what to know before arming the expiry lane, and the questions still open', () => {
    const s = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
    const at = s.indexOf('## 12. Before arming');
    expect(at, '§12 is there').toBeGreaterThan(-1);
    const b = s.slice(at);
    for (const item of ['Nothing in this tree arms either lane, and nothing writes either live file',
      '**Deploy first, the fleet box first.**', '**Their memory is in memory.**', '**The expiry lane (`$REG/expire-lane-live`).**',
      '**Its arming blockers are closed.**', '`_ws_expire_cwd_users` resolves its parent through `_ws_dir_physical`',
      '**A branch already gone now expires.**', 'its ignored and secret-shaped files go with the tree',
      '**A branch deleted or made inside the lock stops the act**', 'never `no-worktree-record`',
      '**`flock-unavailable` halts the lane\'s act**', '**The first armed pass faces the backlog**',
      '**The recommended order.**', 'Arm the expiry lane first, once this release is deployed and its shadow list has been read',
      'after its own shadow list has been read and any breaker trip worked through',
      'the feed shows the dead-coordinator lane\'s shadow rows', 'and a fresh one\'s is audited afresh, counted',
      '**One residual of question (k), in a narrow window.**', 'leaves `crumb` unsaid, as on the reclaim side',
      // Whole-branch review, item 3: the restart sentence and the residual's own restart clause.
      'So a restart can delay an act and can ask again a row the lane had stopped asking',
      'for the expiry lane a fresh audit whose token ccd proves again inside its lock',
      'for the dead-coordinator lane the claimant measured again before and after the fleet act; neither acts without it',
      'listed at once and not asked again for that archive until the server restarts',
      '**One archived tree holds a leaked test tmux server**',
      '**Questions still open**', '(b) The archive-confirm copy', '(i) A kept-leaf entry lives until a server restart',
      '(j) `ws-expire` refuses a branch made inside the lock as well as one deleted', 'Wave 2\'s three:']) expect(b).toContain(item);
    expect(b, 'the unreadable-breadcrumb residual is not the whole of the shape any more (review 381, F9)')
      .not.toContain('A breadcrumb that stands but cannot be read (a `$REG/<id>.reaping` that is not a readable file) leaves `crumb` unsaid, as on the reclaim side, so that');
    expect(b.slice(0, b.indexOf('**The expiry lane (`$REG/expire-lane-live`).**')),
      'a restart also asks again what the lane had stopped asking (whole-branch review, item 3)').not.toContain('never cause one');
    expect(b, 'never a destructive verb as advice').not.toMatch(/run `ccd ws-(reap|expire|reclaim|rm)/);
  });
});

// Review 381, fix round 1 (F3, F4, F6, F9 and the §12 observations): the words that were more than the code does.
describe('the spec says what the lane does, no more and no less (review 381, F3, F6, F9, §12 observations)', () => {
  const spec = flat('docs/superpowers/specs/2026-09-24-workspace-lifecycle-design.md');
  const s12 = spec.slice(spec.indexOf('## 12. Before arming'));
  it('§5.3: the standing-entry bullet names every failed document ccd marks crumb: false (F6), and the halt reaches every standing entry (F3)', () => {
    expect(spec).toContain('finds that none had begun (any failed document ccd marks `crumb: false`, or an older ccd\'s `state-changed`) or stops for good');
    expect(spec).not.toContain('(a `failed` `state-changed`, which ccd prints only before the breadcrumb)');
    const w6 = spec.slice(spec.indexOf('- **As wave 6 closes the lane**'), spec.indexOf('### 5.4 Stage 4'));
    expect(w6).toContain('a standing entry (stuck or tier) keeps its place and says the halt in its own sentence while it stands, with no new kind and no new word');
    expect(w6).not.toContain('unless a standing entry stands there');
  });
  it('§5.3: the unreadable breadcrumb is final only between the act\'s audit and the in-lock fork; already unreadable at the audit, it is backed off (F9)', () => {
    const w6 = spec.slice(spec.indexOf('- **As wave 6 closes the lane**'), spec.indexOf('### 5.4 Stage 4'));
    expect(w6).toContain('a `probe-unmeasured` over a breadcrumb that turns unreadable between the act\'s audit and the fork\'s in-lock read');
    expect(w6).toContain('A breadcrumb already unreadable at the lane\'s audit never gets that far: the audit answers `unmeasured` (exit 1), read as `audit-failed`, backed off and listed after the hour, never final');
    expect(w6).not.toContain('over a breadcrumb that cannot be read: nothing is deleted');
  });
  it('§12: the residual says the same window (F9), and the questions list (p) as narrowed', () => {
    expect(s12).toContain('If it is already unreadable at the lane\'s audit, `ws-audit --expire` answers `unmeasured` (exit 1), read as `audit-failed`: backed off and listed after the hour, never final');
    expect(s12).toContain('Only a breadcrumb that turns unreadable between the act\'s audit and the in-lock fork leaves a `probe-unmeasured` read by its word');
    expect(s12).toContain('(p) Should a breadcrumb that turns unreadable between the act\'s audit and the in-lock fork');
    expect(s12.slice(s12.indexOf('**Questions still open**'))).toContain('(p) Should a breadcrumb');
  });
  it('§12: a stuck entry stands through a `restart` answer (m), the halt is one process-wide field gating only the act, and the per-pass words are exact (F3, observations)', () => {
    expect(s12).toContain('**A stuck entry stands through a `restart` answer** (ruling (m)).');
    expect(s12).toContain('it keeps its entry, its first instant and the tier\'s cadence');
    expect(s12).toContain('a server restart drops it, as it drops every entry');
    expect(s12).toContain('**`flock-unavailable` halts the lane\'s act** on that box until the server restarts. The halt is one process-wide field gating only the act: learn audits go on.');
    expect(s12).toContain('a standing entry (stuck or tier) keeps its place and says the halt in its own sentence while it stands');
    expect(s12).toContain('is refused `in-use` each time the row is asked (the lane makes at most one act per pass, fleet-wide)');
    expect(s12).not.toContain('refused every pass');
    expect(s12).not.toContain('refuses that row `in-use` on every pass');
    expect(s12).toContain('a box answer such as `lock-unopenable` at once');
    expect(s12).not.toContain('halts the lane** on that box');
  });
});
