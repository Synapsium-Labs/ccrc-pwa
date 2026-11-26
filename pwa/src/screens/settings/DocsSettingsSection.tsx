// Docs settings are one server-owned row. The draft stays here until a whole-row write succeeds;
// the account gate, not this form, decides whether that write needs a fresh check.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button, Section, TextInput } from '@ccrc/ui';
import type { DocsSettingsResponse, DocsSettings, TrackerRule } from '../../../../shared/docsTracker';
import { ConfirmItsYou } from '../../accounts/ConfirmItsYou';
import { useStepUp, type StepUpDeps } from '../../accounts/useStepUp';
import { failureSentence, slotSentence } from '../../docs/docsText';
import type { DocsAnswer, DocsNotOk } from '../../docs/failures';
import { ResultLine, SETTINGS_SCOPE, useResultLine } from '../../fleet/settingsText';
import { ApiError, api } from '../../lib/api';
import type { ProjectListRead } from './useProjectList';

type SettingsClient = {
  read(signal?: AbortSignal): Promise<DocsAnswer<DocsSettingsResponse>>;
  write(settings: DocsSettings): Promise<DocsAnswer<DocsSettingsResponse>>;
};
const RULE_REASONS: Readonly<Record<string, string>> = {
  'pattern-long': 'The pattern is too long.',
  'pattern-empty-match': 'The pattern must not match an empty item.',
  'pattern-invalid': 'The pattern is invalid.',
  'template-scheme': 'The URL template must use HTTPS.',
  'template-host': 'The URL template needs a fixed host; placeholders belong after the host.',
  'too-many': 'There are too many rules.',
  'settings-masked': 'Remove credential-like text or masked placeholders before saving.',
  'default-branch-name': 'Enter a valid bare branch name.',
  'default-branch-project': 'The project name is invalid.',
};
const GATE_REASONS: Readonly<Record<string, string>> = {
  'auth-off': 'Turn sign-in on to save this change.',
  'insecure-origin': 'This change requires a secure connection.',
  'unauthenticated': 'Sign in, then save again.',
  'unsupported': 'This server does not support that change yet.',
  'step-up-locked': 'This check is locked. Sign out and sign in again.',
};
function refusal(a: DocsNotOk): string {
  if (a.s !== 'failed') return slotSentence(a);
  const why = a.body.why;
  return typeof why === 'string' && Object.hasOwn(RULE_REASONS, why) ? RULE_REASONS[why]! : failureSentence(a.body);
}
function gateRefusal(error: unknown): string {
  const body: unknown = error instanceof ApiError ? error.body : null;
  const word = typeof body === 'object' && body !== null ? (body as { error?: unknown }).error : null;
  return typeof word === 'string' && Object.hasOwn(GATE_REASONS, word) ? GATE_REASONS[word]! : 'The box refused this change. Try again.';
}

export function DocsSettingsSection({ list, settings = api.docs.settings, stepUpDeps }: {
  list: ProjectListRead; settings?: SettingsClient; stepUpDeps?: StepUpDeps;
}): ReactNode {
  const [draft, setDraft] = useState<DocsSettings | null>(null);
  const [confirmed, setConfirmed] = useState<DocsSettings | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const result = useResultLine();
  const stepUp = useStepUp(Infinity, stepUpDeps);
  useEffect(() => {
    const controller = new AbortController();
    void settings.read(controller.signal).then((answer) => {
      if (controller.signal.aborted) return;
      if (answer.s === 'ok') { setConfirmed(answer.value.settings); setDraft(answer.value.settings); }
      else setReadError(refusal(answer));
    }, () => { if (!controller.signal.aborted) setReadError('Could not read Docs settings.'); });
    return () => controller.abort();
  }, [settings]);

  const save = (): void => {
    if (draft === null || lock.current || stepUp.needed || stepUp.busy) return;
    lock.current = true;
    setBusy(true);
    result.clear();
    void (async () => {
      try {
        let answer: DocsAnswer<DocsSettingsResponse> | undefined;
        const submitted: DocsSettings = { ...draft, rules: draft.rules.map((r) => r.projects === undefined ? r : { ...r, projects: r.projects.map((p) => p.trim()).filter(Boolean) }) };
        const outcome = await stepUp.runAct(async () => { answer = await settings.write(submitted); });
        if (outcome === 'step-up' || answer === undefined) return;
        if (answer.s === 'ok') {
          setConfirmed(answer.value.settings);
          setDraft(answer.value.settings);
          result.say('Docs settings saved.');
        } else result.say(refusal(answer), 'refusal');
      } catch (err) {
        result.say(gateRefusal(err), 'refusal');
      } finally {
        lock.current = false;
        setBusy(false);
      }
    })();
  };
  const updateRule = (i: number, patch: Partial<TrackerRule>): void => setDraft((d) => d === null ? d : {
    ...d, rules: d.rules.map((rule, j) => i === j ? { ...rule, ...patch } : rule),
  });
  const projects = draft === null ? [] : [...new Set([
    ...(list.kind === 'read' ? list.rows.map((row) => row.name) : []),
    ...Object.keys(draft.defaultBranches),
    ...Object.keys(confirmed?.defaultBranches ?? {}),
  ])].sort();
  const disabled = busy || stepUp.busy;
  return (
    <Section level={3} scope={SETTINGS_SCOPE.box} title="Docs settings" purpose="Set item links and project default branches.">
      {draft === null ? <p className="settings-note">{readError ?? 'Reading Docs settings…'}</p> : <>
        <p className="settings-note">Rules are tried in order. Leave projects empty to apply a rule everywhere.</p>
        <ul className="linear-list">
          {draft.rules.map((rule, i) => <li key={i}>
            <div className="linear-add">
              <label className="settings-note">Rule name {i + 1}<TextInput aria-label={`Rule name ${i + 1}`} disabled={disabled} value={rule.name} onChange={(e) => updateRule(i, { name: e.target.value })} /></label>
              <label className="settings-note">Pattern {i + 1}<TextInput aria-label={`Pattern ${i + 1}`} disabled={disabled} value={rule.pattern} onChange={(e) => updateRule(i, { pattern: e.target.value })} /></label>
              <label className="settings-note">URL template {i + 1}<TextInput aria-label={`URL template ${i + 1}`} disabled={disabled} value={rule.template} onChange={(e) => updateRule(i, { template: e.target.value })} /></label>
              <label className="settings-note">Projects {i + 1} (comma-separated)<TextInput aria-label={`Projects ${i + 1}`} disabled={disabled} value={rule.projects?.join(',') ?? ''} onChange={(e) => updateRule(i, { projects: e.target.value.split(',') })} /></label>
              <Button variant="ghost" size="fit" disabled={disabled || i === 0} onClick={() => setDraft((d) => {
                if (d === null) return d; const rules = [...d.rules]; [rules[i - 1], rules[i]] = [rules[i]!, rules[i - 1]!]; return { ...d, rules };
              })}>Move rule {i + 1} up</Button>
              <Button variant="ghost" size="fit" disabled={disabled} onClick={() => setDraft((d) => d === null ? d : { ...d, rules: d.rules.filter((_, j) => j !== i) })}>Remove rule {i + 1}</Button>
            </div>
          </li>)}
        </ul>
        <Button variant="ghost" size="fit" disabled={disabled} onClick={() => setDraft((d) => d === null ? d : { ...d, rules: [...d.rules, { name: '', pattern: '', template: '' }] })}>Add rule</Button>
        <h4>Default branches</h4>
        {list.kind !== 'read' && <p className="settings-note">{list.kind === 'loading' ? 'Reading projects…' : 'The project list could not be read. Configured projects are still shown.'}</p>}
        <ul className="linear-list">{projects.map((project) => <li key={project} className="linear-add">
          <label className="settings-note">Default branch for {project}
            <TextInput aria-label={`Default branch for ${project}`} disabled={disabled} value={Object.hasOwn(draft.defaultBranches, project) ? draft.defaultBranches[project] : ''} onChange={(e) => {
              const value = e.target.value;
              setDraft((d) => {
                if (d === null) return d;
                const entries = Object.entries(d.defaultBranches).filter(([name]) => name !== project);
                if (value !== '') entries.push([project, value]);
                return { ...d, defaultBranches: Object.fromEntries(entries) };
              });
            }} />
          </label>
        </li>)}</ul>
        <p className="settings-note">Clear a branch to use the project's discovered default.</p>
        <Button variant="primary" size="fit" disabled={disabled || stepUp.needed} onClick={save}>Save Docs settings</Button>
        <ConfirmItsYou stepUp={stepUp} subject="Docs settings" />
      </>}
      <ResultLine line={result.line} />
    </Section>
  );
}
