// Approvals plan §3.1 "The counter, M38" (Task 1.5): Settings › Security › Permission prompts (M38). The card reads the
// census (spied as `api.getApprovalCensus`) and renders alone; its words are `lib/approvalCensusWords`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { APPROVAL_CENSUS_PATHS, type ApprovalCensusWire } from '../../shared/approval-census';
import { ApprovalCensusSection } from '../src/fleet/ApprovalCensusSection';
import { APPROVAL_CENSUS_TEXT, APPROVAL_PATH_LABELS, OPERATOR_REACHING_PATHS, operatorPathLines } from '../src/lib/approvalCensusWords';
import { ApiError, api } from '../src/lib/api';
import { clearScreenCache } from '../src/lib/screenCache';
import { SETTINGS_CARDS } from '../src/fleet/settingsText';

afterEach(() => {
  cleanup();
  clearScreenCache();
  vi.restoreAllMocks();
});

const wire = (over: Partial<ApprovalCensusWire['m38']> = {}, readPrompts = 4): ApprovalCensusWire => ({
  ok: true, days: 14, fromMs: 0, toMs: 1, total: 20, reachedOperator: 9, unmeasured: 0, byUnmeasured: {},
  byPath: {}, byState: {}, byReleaseReason: {}, byClass: {}, byThread: {}, byDenyCurrent: { current: 20 }, byProgramme: {},
  byAuthority: {}, byRoute: {}, readPrompts,
  m38: {
    programmeDays: 6, programmeReached: 9, perProgrammeDay: 1.5, rootReached: 0,
    byDay: [
      { day: '2026-11-16', reachedOperator: 5, byPath: { lapsed: 3, 'hook-skipped': 1, ruled: 40, held: 2 } },
      { day: '2026-11-17', reachedOperator: 4, byPath: { lapsed: 1, 'not-a-child': 3, ruled: 9 } },
    ],
    ...over,
  },
  pushesBySource: {}, rows: [],
});
const card = (): HTMLElement => screen.getByRole('region', { name: SETTINGS_CARDS.security.approvalCensus.title });

describe('Settings › Automation › Permission prompts (M38)', () => {
  it('shows the figure to one decimal, its sentence, the baseline and the read prompts', async () => {
    vi.spyOn(api, 'getApprovalCensus').mockResolvedValue(wire());
    render(<ApprovalCensusSection />);
    expect(await within(card()).findByText('1.5')).toBeInTheDocument();
    expect(within(card()).getByText('Permission prompts you had to answer, per programme-day, over the last 14 days')).toBeInTheDocument();
    expect(within(card()).getByText(/Baseline: the first two weeks after the census went live\. It includes the stale-deny fix and the reviewer prevention clause if they were live by then\./)).toBeInTheDocument();
    expect(within(card()).getByText("Read prompts (the read-only family's gate): 4")).toBeInTheDocument();
  });

  it('a failed read says unmeasured and never shows 0', async () => {
    vi.spyOn(api, 'getApprovalCensus').mockRejectedValue(new ApiError(503, { ok: false, error: 'unavailable' }));
    render(<ApprovalCensusSection />);
    expect(await within(card()).findByText('unmeasured')).toBeInTheDocument();
    expect(card().textContent).not.toMatch(/\b0(\.0)?\b/);
  });

  it('a measured zero (programme-days, nothing reached you) says none reached you, not unmeasured and not 0.0', async () => {
    vi.spyOn(api, 'getApprovalCensus').mockResolvedValue(wire({ perProgrammeDay: 0, programmeReached: 0, byDay: [] }));
    render(<ApprovalCensusSection />);
    expect(await within(card()).findByText('None reached you in the last 14 days')).toBeInTheDocument();
    expect(within(card()).queryByText('unmeasured')).not.toBeInTheDocument();
    expect(card().textContent).not.toContain('0.0');
  });

  it('no programme-days says so in its own sentence, never a figure (ruling F4)', async () => {
    vi.spyOn(api, 'getApprovalCensus').mockResolvedValue(wire({ programmeDays: 0, programmeReached: 0, perProgrammeDay: null, byDay: [] }));
    render(<ApprovalCensusSection />);
    expect(await within(card()).findByText(APPROVAL_CENSUS_TEXT.noProgrammeDays)).toBeInTheDocument();
    expect(within(card()).queryByText(/None reached you/)).not.toBeInTheDocument();
  });

  it('states what a programme-day is, and puts root prompts and the unplaced beside the figure, never in it', async () => {
    vi.spyOn(api, 'getApprovalCensus').mockResolvedValue({ ...wire({ rootReached: 3 }), unmeasured: 2, byUnmeasured: { 'near-miss': 2 } });
    render(<ApprovalCensusSection />);
    expect(await within(card()).findByText('1.5')).toBeInTheDocument();
    expect(within(card()).getByText(APPROVAL_CENSUS_TEXT.programmeDay)).toBeInTheDocument();
    expect(within(card()).getByText("Root sessions' prompts you answered (not in the figure): 3")).toBeInTheDocument();
    expect(within(card()).getByText('Prompts the census could not place: 2')).toBeInTheDocument();
  });

  it('a read-prompt count over rows whose deny currency is unmeasured says so (F11c)', async () => {
    vi.spyOn(api, 'getApprovalCensus').mockResolvedValue({ ...wire(), byDenyCurrent: { unmeasured: 20 } });
    render(<ApprovalCensusSection />);
    expect(await within(card()).findByText(APPROVAL_CENSUS_TEXT.denyUnmeasured)).toBeInTheDocument();
  });

  it('an answer without the counter\'s new fields (an older server) is unmeasured, never a figure', async () => {
    const { unmeasured: _u, ...older } = wire();
    vi.spyOn(api, 'getApprovalCensus').mockResolvedValue(older as never);
    render(<ApprovalCensusSection />);
    expect(await within(card()).findByText('unmeasured')).toBeInTheDocument();
  });

  it('lists the paths that reached the operator with counts, and ruled and held are not among them', async () => {
    vi.spyOn(api, 'getApprovalCensus').mockResolvedValue(wire());
    render(<ApprovalCensusSection />);
    await waitFor(() => expect(card().querySelectorAll('[data-census-path]').length).toBeGreaterThan(0));
    const rows = [...card().querySelectorAll('[data-census-path]')].map((r) => [r.getAttribute('data-census-path'), r.textContent]);
    expect(rows).toEqual([
      ['lapsed', `${APPROVAL_PATH_LABELS.lapsed}: 4`],
      ['not-a-child', `${APPROVAL_PATH_LABELS['not-a-child']}: 3`],
      ['hook-skipped', `${APPROVAL_PATH_LABELS['hook-skipped']}: 1`],
    ]);
    expect(within(card()).queryByText(new RegExp(APPROVAL_PATH_LABELS.ruled))).not.toBeInTheDocument();
    expect(within(card()).queryByText(new RegExp(APPROVAL_PATH_LABELS.held))).not.toBeInTheDocument();
  });
});

describe('the words', () => {
  it('label every census path, and the operator-reaching set leaves out ruled and held', () => {
    for (const p of APPROVAL_CENSUS_PATHS) expect(APPROVAL_PATH_LABELS[p], p).toMatch(/\S/);
    expect(Object.keys(APPROVAL_PATH_LABELS).sort()).toEqual([...APPROVAL_CENSUS_PATHS].sort());
    expect(OPERATOR_REACHING_PATHS).not.toContain('ruled');
    expect(OPERATOR_REACHING_PATHS).not.toContain('held');
    expect(OPERATOR_REACHING_PATHS).not.toContain('unmeasured');
    expect(operatorPathLines(wire()).map((l) => l.path)).toEqual(['lapsed', 'not-a-child', 'hook-skipped']);
  });
});
