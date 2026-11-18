// D-8274 (spec 2026-10-28 R-6): Settings › Automation › Shadow lanes. The card reads its own door and writes `{lane, choice}`;
// Live goes out with no key, the server's 409 `confirm-required` opens the confirm sheet from the facts it read, and Go live
// sends the server's key back. Every case spies `api.laneArm` and `api.setLaneArm` and renders the card alone; every word is
// L0's `LANE_ARM_TEXT`, read by name. The card at every width is `browser/shadow-lanes-card.browser.test.ts`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { LANE_ARM_TEXT as T, ROSTER_CARD_SHADOW_LOG, laneArmGate, type LaneArmQuizPending, type LaneArmQuizView, type LaneArmRowView, type LaneArmView } from '../../shared/lane-arm';
import { COORDINATOR_ROSTER_CARD_LIVE_MARKER } from '../../shared/switches';
import { ShadowLanesSection } from '../src/fleet/ShadowLanesSection';
import { asLaneArmConfirm, asLaneArmView, laneArmLines, laneArmQuizDate } from '../src/fleet/laneArmWords';
import { ApiError, api } from '../src/lib/api';
import { clearScreenCache } from '../src/lib/screenCache';
import { UNCONFIRMED_TEXT } from '../src/fleet/settingsText';

afterEach(() => {
  cleanup();
  clearScreenCache();
  vi.restoreAllMocks();
});

const R = T.rows['roster-card'];
const row = (over: Partial<LaneArmRowView> = {}): LaneArmRowView => ({
  lane: 'roster-card', stored: 'shadow', detail: null, live: false, updatedAt: 0, imported: null,
  marker: COORDINATOR_ROSTER_CARD_LIVE_MARKER, ...over,
});
const view = (over: Partial<LaneArmRowView> = {}): LaneArmView => ({ lanes: [row(over)] });
const radio = (name: string): HTMLInputElement => screen.getByRole('radio', { name }) as HTMLInputElement;
const confirm409 = (key = 'roster-card:shadow:0') => new ApiError(409, {
  ok: false, error: 'confirm-required', lane: 'roster-card', confirmKey: key,
  facts: { stored: 'shadow', updatedAt: 0, shadowLog: ROSTER_CARD_SHADOW_LOG },
});
const mount = () => render(<ShadowLanesSection />);

describe('Settings › Automation › Shadow lanes (D-8274)', () => {
  it('a seeded server reads Shadow: the roster card row, Shadow checked, the shadow record named', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view());
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    expect(radio(T.live).checked).toBe(false);
    expect(screen.getByRole('heading', { level: 3, name: T.title })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: R.legend })).toBeInTheDocument();
    expect(screen.getByText(T.shadowLog(ROSTER_CARD_SHADOW_LOG))).toBeInTheDocument();
    expect(screen.getByText(R.liveNote)).toBeInTheDocument();
  });

  it('the continuity row (Overlord W1a, generations) is listed after the roster card, in its own words, with no shadow record', async () => {
    const C = T.rows.continuity;
    vi.spyOn(api, 'laneArm').mockResolvedValue({ lanes: [row(), row({ lane: 'continuity', marker: null })] });
    mount();
    await waitFor(() => expect(screen.getByRole('group', { name: C.legend })).toBeInTheDocument());
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label') ?? g.querySelector('legend')?.textContent);
    expect(groups.indexOf(C.legend)).toBeGreaterThan(groups.indexOf(R.legend));
    const own = within(screen.getByRole('group', { name: C.legend }));
    expect(own.getByText(C.liveNote)).toBeInTheDocument();
    expect(own.queryByText(/Shadow record:/)).toBeNull();
  });

  it('the launch-profile row (Overlord W1a, launch profiles PR B) is listed after continuity, in its own words, ungated, with no shadow record', async () => {
    const C = T.rows.continuity;
    const P = T.rows['launch-profile'];
    vi.spyOn(api, 'laneArm').mockResolvedValue({ lanes: [row(), row({ lane: 'continuity', marker: null }), row({ lane: 'launch-profile', marker: null })] });
    mount();
    await waitFor(() => expect(screen.getByRole('group', { name: P.legend })).toBeInTheDocument());
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label') ?? g.querySelector('legend')?.textContent);
    expect(groups.indexOf(P.legend)).toBeGreaterThan(groups.indexOf(C.legend));
    const own = within(screen.getByRole('group', { name: P.legend }));
    expect(own.getByText(P.liveNote)).toBeInTheDocument();
    expect(own.queryByText(/Shadow record:/)).toBeNull();
    expect(laneArmGate('launch-profile')).toBeNull();
    expect((own.getByRole('radio', { name: T.live }) as HTMLInputElement).disabled).toBe(false);
  });

  it('the anchor-slot row (Overlord W1a, the anchor piece) is listed last, in its own words, ungated, with no shadow record', async () => {
    const P = T.rows['launch-profile'];
    const A = T.rows['anchor-slot'];
    vi.spyOn(api, 'laneArm').mockResolvedValue({ lanes: [row(), row({ lane: 'continuity', marker: null }),
      row({ lane: 'launch-profile', marker: null }), row({ lane: 'anchor-slot', marker: null })] });
    mount();
    await waitFor(() => expect(screen.getByRole('group', { name: A.legend })).toBeInTheDocument());
    const groups = screen.getAllByRole('group').map((g) => g.getAttribute('aria-label') ?? g.querySelector('legend')?.textContent);
    expect(groups.indexOf(A.legend)).toBeGreaterThan(groups.indexOf(P.legend));
    const own = within(screen.getByRole('group', { name: A.legend }));
    expect(own.getByText(A.shadowNote)).toBeInTheDocument();
    expect(own.queryByText(/Shadow record:/)).toBeNull();
    expect(laneArmGate('anchor-slot')).toBeNull();
    expect((own.getByRole('radio', { name: T.live }) as HTMLInputElement).disabled).toBe(false);
  });

  it('the continuity row carries no gate since the renewal act: its Live is enabled, and a lane-gated refusal from a server still says the server\'s reason (review 2003 F3)', async () => {
    expect(laneArmGate('continuity')).toBeNull();
    expect(T.rows.continuity.gate).toBeNull();
    const words = 'a gate the server still holds';
    const read = vi.spyOn(api, 'laneArm').mockResolvedValue({ lanes: [row({ lane: 'continuity', marker: null })] });
    vi.spyOn(api, 'setLaneArm').mockRejectedValue(new ApiError(409, { ok: false, error: 'lane-gated', detail: words }));
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    expect(radio(T.live).disabled).toBe(false);
    fireEvent.click(radio(T.live));
    expect(await screen.findByText(`${T.refused} (${words})`)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio(T.shadow).checked).toBe(true);
  });

  it('Live is one tap then a confirm: the tap sends no key, the server\'s 409 opens the sheet, Go live sends its key', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setLaneArm')
      .mockRejectedValueOnce(confirm409('roster-card:shadow:0'))
      .mockResolvedValueOnce(view({ stored: 'live', live: true, updatedAt: 5 }));
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    fireEvent.click(radio(T.live));
    expect(set).toHaveBeenNthCalledWith(1, { lane: 'roster-card', choice: 'live' });
    const sheet = await screen.findByRole('dialog', { name: T.confirmTitle });
    for (const l of T.confirmLines(R.legend, ROSTER_CARD_SHADOW_LOG)) expect(within(sheet).getByText(l)).toBeInTheDocument();
    // Nothing moved yet: the checked radio is still the server's (the page behind the sheet is hidden from the tree).
    expect((screen.getByRole('radio', { name: T.shadow, hidden: true }) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(within(sheet).getByRole('button', { name: T.confirmLabel }));
    expect(set).toHaveBeenNthCalledWith(2, { lane: 'roster-card', choice: 'live', confirm: 'roster-card:shadow:0' });
    await waitFor(() => expect(radio(T.live).checked).toBe(true));
  });

  it('Cancel on the sheet sends nothing more', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view());
    const set = vi.spyOn(api, 'setLaneArm').mockRejectedValueOnce(confirm409());
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    fireEvent.click(radio(T.live));
    const sheet = await screen.findByRole('dialog', { name: T.confirmTitle });
    fireEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(set).toHaveBeenCalledTimes(1);
    expect(radio(T.shadow).checked).toBe(true);
  });

  it('Shadow goes out at once, with no sheet, and the reply is what the card shows', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view({ stored: 'live', live: true }));
    const set = vi.spyOn(api, 'setLaneArm').mockResolvedValue(view());
    mount();
    await waitFor(() => expect(radio(T.live).checked).toBe(true));
    fireEvent.click(radio(T.shadow));
    expect(set).toHaveBeenCalledWith({ lane: 'roster-card', choice: 'shadow' });
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('sign-in dark: the refusal is said in the card\'s sentence, and the card re-reads', async () => {
    const read = vi.spyOn(api, 'laneArm').mockResolvedValue(view());
    vi.spyOn(api, 'setLaneArm').mockRejectedValue(new ApiError(403, { ok: false, error: 'sign-in-unarmed' }));
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    fireEvent.click(radio(T.live));
    expect(await screen.findByText(T.signInUnarmed)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
    expect(radio(T.shadow).checked).toBe(true);
  });

  it('an unreadable 2xx is not a refusal: it may have landed, and the card re-reads', async () => {
    const read = vi.spyOn(api, 'laneArm').mockResolvedValue(view({ stored: 'live', live: true }));
    vi.spyOn(api, 'setLaneArm').mockResolvedValue('unreadable');
    mount();
    await waitFor(() => expect(radio(T.live).checked).toBe(true));
    fireEvent.click(radio(T.shadow));
    expect(await screen.findByText(UNCONFIRMED_TEXT)).toBeInTheDocument();
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('a Live stored on the continuity row checks Live, now that no gate holds it (review 2006 N1)', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue({ lanes: [row({ lane: 'continuity', stored: 'live', live: true, marker: null })] });
    mount();
    await waitFor(() => expect(radio(T.live).checked).toBe(true));
    expect(radio(T.shadow).checked).toBe(false);
  });

  it('a marker imported at the upgrade is said on the row; a token this build does not know checks neither radio', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(view({ stored: 'live', live: true, imported: { result: 'stood', at: 1 } }));
    mount();
    expect(await screen.findByText(T.importedLive(COORDINATOR_ROSTER_CARD_LIVE_MARKER))).toBeInTheDocument();
    cleanup();
    clearScreenCache();
    vi.spyOn(api, 'laneArm').mockResolvedValue(view({ stored: 'unknown' }));
    mount();
    expect(await screen.findByText(T.unknown)).toBeInTheDocument();
    expect(radio(T.shadow).checked).toBe(false);
    expect(radio(T.live).checked).toBe(false);
  });

  it('a server without the route (404 not-found) shows only "Not available on this server."', async () => {
    vi.spyOn(api, 'laneArm').mockRejectedValue(new ApiError(404, { ok: false, error: 'not-found' }));
    mount();
    expect(await screen.findByText('Not available on this server.')).toBeInTheDocument();
    expect(screen.queryByRole('radio')).toBeNull();
  });
});

describe('laneArmWords (D-8274)', () => {
  it('the view guard takes a whole view, leaves out a lane this build does not know, and refuses a mistyped row', () => {
    expect(asLaneArmView(view())).toEqual(view());
    expect(asLaneArmView({ lanes: [row(), { ...row(), lane: 'a-newer-lane' }] })).toEqual(view());
    expect(asLaneArmView({ lanes: [{ ...row(), stored: 'maybe' }] })).toBeNull();
    expect(asLaneArmView({ lanes: [{ ...row(), live: 'yes' }] })).toBeNull();
    expect(asLaneArmView({ lanes: [{ ...row(), imported: { result: 'odd', at: 1 } }] })).toBeNull();
    expect(asLaneArmView(null)).toBeNull();
  });

  it('the confirm guard reads only a whole confirm-required body', () => {
    expect(asLaneArmConfirm(confirm409().body)).toMatchObject({ confirmKey: 'roster-card:shadow:0' });
    expect(asLaneArmConfirm({ ok: false, error: 'bad-request' })).toBeNull();
  });

  it('an unreadable row is said amber with the server\'s detail, before the shadow record', () => {
    expect(laneArmLines(row({ stored: 'unreadable', detail: 'disk I/O error' }), ROSTER_CARD_SHADOW_LOG)).toEqual([
      { text: `${T.unreadable} (disk I/O error)`, tone: 'warn' },
      { text: T.shadowLog(ROSTER_CARD_SHADOW_LOG), tone: 'note' },
    ]);
  });
});

describe('the replay quiz block (Overlord W1a, quiz record)', () => {
  const AT = Date.UTC(2026, 10, 24, 12, 0, 0);
  const run = (id: number, over: Partial<LaneArmQuizPending> = {}): LaneArmQuizPending => ({
    id, recordedAt: AT + 100 + id, reportShaPrefix: `${id}`.repeat(12).slice(0, 12), recordedBy: `quiz-record op-${id} both 2026-11-24T12:00:00Z`,
    measuredAt: AT + id, score: 0.8 + id / 100, lo: 0.7, hi: 0.9, questions: 100, families: 34, answered: 97, runFailed: 2, absent: 1, ...over,
  });
  const pendingLine = (r: LaneArmQuizPending): string => T.quizPending(laneArmQuizDate(r.measuredAt), laneArmQuizDate(r.recordedAt), r);
  const quiz = (over: Partial<LaneArmQuizView> = {}): LaneArmQuizView => ({
    baseline: { state: 'not-yet' }, pending: { ok: true, runs: [run(7)] }, ...over,
  });
  const withQuiz = (q?: LaneArmQuizView): LaneArmView => (q === undefined ? view() : { ...view(), quizBaseline: q });

  it('shows each pending run with Confirm and Discard, the rule note once, and the baseline line, per baseline state', async () => {
    expect(laneArmQuizDate(AT + 7)).toBe('2026-11-24 UTC');
    const cases: [LaneArmQuizView['baseline'], string][] = [
      [{ state: 'recorded', at: AT }, T.quizBaseline.recorded(laneArmQuizDate(AT))],
      [{ state: 'not-yet' }, T.quizBaseline.notYet],
      [{ state: 'unreadable', detail: 'db locked' }, T.quizBaseline.unreadable],
    ];
    for (const [baseline, line] of cases) {
      vi.spyOn(api, 'laneArm').mockResolvedValue(withQuiz(quiz({ baseline, pending: { ok: true, runs: [run(7), run(8)] } })));
      const { unmount } = mount();
      expect(await screen.findByText(line)).toBeInTheDocument();
      expect(screen.getByText(pendingLine(run(7)))).toBeInTheDocument();
      expect(screen.getByText(pendingLine(run(8)))).toBeInTheDocument();
      expect(screen.getAllByRole('button', { name: T.quizConfirm })).toHaveLength(2);
      expect(screen.getAllByRole('button', { name: T.quizDiscard })).toHaveLength(2);
      expect(screen.getAllByText(T.quizRuleNote)).toHaveLength(1);
      unmount();
      vi.restoreAllMocks();
    }
  });

  it('each pending run names its run id, report sha prefix, record date and trace, so the operator can tell runs apart (review 2442 F1)', async () => {
    const r = run(7, { recordedAt: Date.UTC(2026, 10, 25, 23, 30), reportShaPrefix: 'abcdef012345', recordedBy: 'quiz-record op both 2026-11-25T23:30:00Z' });
    vi.spyOn(api, 'laneArm').mockResolvedValue(withQuiz(quiz({ pending: { ok: true, runs: [r] } })));
    mount();
    const text = (await screen.findByText(pendingLine(r))).textContent ?? '';
    for (const want of ['run 7,', 'report sha abcdef012345', 'recorded 2026-11-25 UTC', 'by quiz-record op both 2026-11-25T23:30:00Z', `the arms ran ${laneArmQuizDate(AT + 7)}`]) {
      expect(text).toContain(want);
    }
    expect(laneArmQuizDate(Date.UTC(2026, 10, 25, 23, 59))).toBe('2026-11-25 UTC');
  });

  it('pending runs show in id order, never by a date inside the report (review 2442 F3)', async () => {
    const runs = [run(9, { measuredAt: AT - 5 * 86_400_000 }), run(8), run(10, { measuredAt: AT - 86_400_000 })];
    vi.spyOn(api, 'laneArm').mockResolvedValue(withQuiz(quiz({ pending: { ok: true, runs } })));
    mount();
    await screen.findByText(pendingLine(runs[0]!));
    expect([...document.querySelectorAll('[data-quiz-run]')].map((e) => e.getAttribute('data-quiz-run'))).toEqual(['8', '9', '10']);
  });

  it('a view without the field shows no block', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(withQuiz());
    mount();
    await waitFor(() => expect(radio(T.shadow).checked).toBe(true));
    expect(screen.queryByText(T.quizBaseline.notYet)).toBeNull();
    expect(screen.queryByRole('button', { name: T.quizConfirm })).toBeNull();
  });

  it('a failed pending read shows its line, and no buttons', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(withQuiz(quiz({ pending: { ok: false, detail: 'read failed' } })));
    mount();
    expect(await screen.findByText(T.quizPendingUnreadable)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: T.quizConfirm })).toBeNull();
    expect(screen.getByText(T.quizBaseline.notYet)).toBeInTheDocument();
  });

  it.each([['confirm', T.quizConfirm], ['discard', T.quizDiscard]] as const)('%s calls the rule door with the run id and re-reads the card', async (action, label) => {
    const read = vi.spyOn(api, 'laneArm').mockResolvedValue(withQuiz(quiz({ pending: { ok: true, runs: [run(7), run(8)] } })));
    const rule = vi.spyOn(api, 'ruleQuizRun').mockResolvedValue({ ok: true, id: 8, state: action === 'confirm' ? 'confirmed' : 'discarded', baseline: false });
    mount();
    const second = (await screen.findByText(pendingLine(run(8)))).closest('[data-quiz-run]') as HTMLElement;
    fireEvent.click(within(second).getByRole('button', { name: label }));
    await waitFor(() => expect(rule).toHaveBeenCalledWith(8, action));
    expect(rule).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(read).toHaveBeenCalledTimes(2));
  });

  it('a step-up-required refusal shows the step and sends nothing more; a refusal says its detail', async () => {
    vi.spyOn(api, 'laneArm').mockResolvedValue(withQuiz(quiz()));
    const client = { stepUpStart: vi.fn().mockResolvedValue({ allowCredentialIdsB64url: [] }), stepUpFinish: vi.fn(), stepUpPassphrase: vi.fn() };
    const rule = vi.spyOn(api, 'ruleQuizRun').mockRejectedValueOnce(new ApiError(401, { ok: false, error: 'step-up-required' }))
      .mockRejectedValueOnce(new ApiError(409, { ok: false, error: 'bad-request', detail: 'already confirmed' }));
    render(<ShadowLanesSection stepUpDeps={{ client }} />);
    fireEvent.click(await screen.findByRole('button', { name: T.quizConfirm }));
    await waitFor(() => expect(client.stepUpStart).toHaveBeenCalled());
    expect(rule).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: T.quizDiscard }));
    expect(await screen.findByText(`${T.refused} (already confirmed)`)).toBeInTheDocument();
  });

  it('the reader keeps a well-formed block, leaves an absent one absent, and drops a malformed one', () => {
    const q = quiz({ baseline: { state: 'recorded', at: AT } });
    expect(asLaneArmView(withQuiz(q))).toEqual(withQuiz(q));
    expect(asLaneArmView(withQuiz(quiz({ pending: { ok: false, detail: 'x' } })))).toEqual(withQuiz(quiz({ pending: { ok: false, detail: 'x' } })));
    expect(asLaneArmView(withQuiz())).toEqual(view());
    expect(asLaneArmView({ ...view(), quizBaseline: { baseline: { state: 'maybe' }, pending: { ok: true, runs: [] } } })).toEqual(view());
    expect(asLaneArmView({ ...view(), quizBaseline: { baseline: { state: 'not-yet' }, pending: { ok: true, runs: [{ id: 1 }] } } })).toEqual(view());
    const noSha: Record<string, unknown> = { ...run(1) };
    delete noSha['reportShaPrefix'];
    expect(asLaneArmView({ ...view(), quizBaseline: { baseline: { state: 'not-yet' }, pending: { ok: true, runs: [noSha] } } })).toEqual(view());
    expect(asLaneArmView({ ...view(), quizBaseline: 'nope' })).toEqual(view());
  });
});
