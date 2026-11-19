// The Flows screen (flows design 2026-11-19 §9, wave 1): `/flows` lists the operator's flows and the templates;
// `/flows/:id` edits one. Ring L4: a screen. It keeps the draft, runs `validateFlow` on every edit so its problems are
// always on screen, and saves and publishes through the doors (`lib/api.ts`). Nothing here runs a flow.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Button, Chip, EmptyState, ListRow, PageScaffold, QuickConfirm, SECTION_PURPOSE, Section, Select, TextInput } from '@ccrc/ui';
import {
  FLOW_LIMITS, FLOW_ROLES, FLOW_VARS, GATE_KINDS, GATE_PR_STATES, canonicalFlowJson, flowExportJson, readFlowFile, validateFlow,
  type BlockKind, type FlowAnswer, type FlowBlock, type FlowDoc, type FlowProblem, type FlowRole, type FlowsListAnswer,
  type GateKind, type GatePrState,
} from '../../../shared/flows';
import { saveBytes } from '../docs/objectUrls';
import { api } from '../lib/api';
import { ApiError } from '../lib/apiError';
import { navigate } from '../lib/router';
import { FlowDiagram } from './FlowDiagram';
import './flows.css';
import {
  EDITABLE_KINDS, KIND_WORD, addOutcome, addStepAfter, flowFileName, outlineOrder, protocolNote, removeOutcome, removeStep, setBlock,
  setTarget, targetOf,
} from './flowEdits';

const flowPath = (id: number): string => `/flows/${id}`;
/** The machine's voice for a step's facts. */
const MONO_META = 'font-mono text-meta text-ink-tertiary';
/** A field: its label word above its control. */
const FIELD = 'grid gap-1 text-meta text-ink-secondary';
const STACK = 'grid gap-2';
/** A row of buttons. */
const ACTIONS = 'flex flex-wrap gap-2';
/** A line of text with its button at the end. */
const LINE = 'flex flex-wrap items-center justify-between gap-3';
/** A refusal's word, with the server's detail when it sent one (wave 2: "conflict: pinned by 1 programme"). */
const failWord = (e: unknown): string => {
  const detail = e instanceof ApiError ? (e.body as { detail?: unknown } | null)?.detail : undefined;
  const word = e instanceof Error ? e.message : String(e);
  return typeof detail === 'string' && detail !== '' ? `${word}: ${detail}` : word;
};
/** Wave 2: how many programmes pin a flow. */
const pinnedWord = (n: number): string => `pinned by ${n} programme${n === 1 ? '' : 's'}`;

export function FlowsScreen(p: { readonly openId?: number }): ReactNode {
  return p.openId === undefined ? <FlowsList /> : <FlowEditor key={p.openId} id={p.openId} />;
}

function FlowsList(): ReactNode {
  const [list, setList] = useState<FlowsListAnswer | 'loading' | { failed: string }>('loading');
  const [busy, setBusy] = useState(false);
  const [review, setReview] = useState<{ doc: FlowDoc; name: string } | null>(null);
  const [importNote, setImportNote] = useState('');
  const file = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let live = true;
    api.listFlows().then((l) => { if (live) setList(l); }, (e: unknown) => { if (live) setList({ failed: failWord(e) }); });
    return () => { live = false; };
  }, []);
  const create = (body: { template?: string; import?: FlowDoc }): void => {
    setBusy(true);
    api.createFlow(body).then((r) => navigate(flowPath(r.id)), (e: unknown) => { setBusy(false); setList({ failed: failWord(e) }); });
  };
  // A shared file is untrusted (§14.1): the byte cap, the shape and the rules are checked here, and the operator reads every
  // prompt before the draft is made; the door checks all three again.
  const pick = (f: File | undefined): void => {
    if (f === undefined) return;
    setReview(null);
    if (f.size > FLOW_LIMITS.fileBytes) { setImportNote(`${f.name} can't be imported: it is over ${FLOW_LIMITS.fileBytes} bytes.`); return; }
    f.text().then((text) => {
      const r = readFlowFile(text);
      if (!r.ok) { setImportNote(`${f.name} can't be imported: ${r.reason}.`); return; }
      const problems = validateFlow(r.doc);
      if (problems.length > 0) { setImportNote(`${f.name} breaks the flow rules: ${problems.map((x) => x.message).join(' ')}`); return; }
      setImportNote('');
      setReview({ doc: r.doc, name: f.name });
    }, (e: unknown) => setImportNote(`${f.name} could not be read: ${failWord(e)}`));
  };
  return (
    <PageScaffold title="Flows" actions={(
      <>
        <Button variant="ghost" size="fit" disabled={busy} onClick={() => file.current?.click()}>Import a file</Button>
        <Button variant="ghost" size="fit" disabled={busy} onClick={() => create({})}>New flow</Button>
      </>
    )}>
      <input ref={file} type="file" accept=".json,application/json" hidden aria-label="Flow file"
             onChange={(e) => { pick(e.currentTarget.files?.[0]); e.currentTarget.value = ''; }} />
      <p className={SECTION_PURPOSE}>
        A flow is the method a programme follows: steps, the gates between them, and the prompt each step gives a session.
        ccrc&apos;s own steps are locked. Flows are definitions for now; programmes start following them in a later release.
      </p>
      {importNote !== '' && <p role="alert">{importNote}</p>}
      {review !== null ? (
        <Section title="Read before you import" scope={review.name}
                 purpose="A shared prompt becomes what a session is told. The import makes a draft; publishing it stays yours.">
          <ol className="m-0 grid gap-3 p-0">
            {outlineOrder(review.doc).map((b) => (
              <li key={b.id} className="grid list-none gap-1 border-t border-edge-subtle pt-2 first:border-t-0 first:pt-0">
                <span className="text-ink-primary">{b.title}</span>
                <span className={MONO_META}>{`${KIND_WORD[b.kind].toLowerCase()} · ${b.role}`}</span>
                {b.kind === 'protocol' ? <span className={SECTION_PURPOSE}>ccrc&apos;s own step, locked.</span>
                  : <p className="m-0 whitespace-pre-wrap text-ink-secondary">{b.prompt === undefined || b.prompt === '' ? '(no prompt)' : b.prompt}</p>}
              </li>
            ))}
          </ol>
          <div className={ACTIONS}>
            <Button size="fit" disabled={busy} onClick={() => create({ import: review.doc })}>Import as a draft</Button>
            <Button variant="ghost" size="fit" disabled={busy} onClick={() => setReview(null)}>Cancel</Button>
          </div>
        </Section>
      )
        : list === 'loading' ? <p role="status">Loading…</p>
        : 'failed' in list ? <p role="alert">The flows could not be read: {list.failed}</p>
        : (
          <>
            <Section title="Your flows" scope={`${list.flows.length}`}>
              {list.flows.length === 0
                ? <EmptyState>No flow yet. Start from a template below, or from an empty flow.</EmptyState>
                : list.flows.map((f) => (
                  <ListRow key={f.id} onClick={() => navigate(flowPath(f.id))}>
                    <span className="min-w-0 flex-1 truncate text-left">{f.title}</span>
                    {f.source !== null && <Chip>{`from ${f.source.template} v${f.source.version}`}</Chip>}
                    <Chip>{f.latestVersion === null ? 'draft' : `v${f.latestVersion}`}</Chip>
                    {f.id === list.defaultFlowId && <Chip>new programmes</Chip>}
                    {(f.pinnedBy ?? 0) > 0 && <Chip>{pinnedWord(f.pinnedBy ?? 0)}</Chip>}
                  </ListRow>
                ))}
            </Section>
            <Section title="Templates" purpose="Shipped with ccrc. Use one to make your own copy; a template itself never changes here.">
              {list.templates.map((t) => (
                <div key={`${t.id}@${t.version}`} className={LINE}>
                  <span className="grid min-w-0 gap-1">
                    <span className="text-ink-primary">{t.title} <span className={MONO_META}>v{t.version}</span></span>
                    <span className={SECTION_PURPOSE}>{t.note}</span>
                  </span>
                  <Button variant="ghost" size="fit" disabled={busy} onClick={() => create({ template: t.id })}>Use template</Button>
                </div>
              ))}
            </Section>
          </>
        )}
    </PageScaffold>
  );
}

type Loaded = { answer: FlowAnswer; doc: FlowDoc | null; saved: string };

function FlowEditor(p: { readonly id: number }): ReactNode {
  const [state, setState] = useState<Loaded | 'loading' | { failed: string }>('loading');
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<string>('');
  const [serverProblems, setServerProblems] = useState<FlowProblem[] | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    api.getFlow(p.id).then((answer) => {
      const doc = answer.draft.ok ? answer.draft.doc : null;
      setState({ answer, doc, saved: doc === null ? '' : canonicalFlowJson(doc) });
    }, (e: unknown) => setState({ failed: e instanceof ApiError && e.status === 404 ? 'There is no such flow.' : failWord(e) }));
  };
  useEffect(load, [p.id]);

  const doc = typeof state === 'object' && 'answer' in state ? state.doc : null;
  const problems = useMemo(() => (doc === null ? [] : validateFlow(doc)), [doc]);
  if (state === 'loading') return <PageScaffold title="Flow"><p role="status">Loading…</p></PageScaffold>;
  const back = { label: 'Flows', onClick: () => navigate('/flows') };
  if ('failed' in state) return <PageScaffold title="Flow" back={back}><p role="alert">{state.failed}</p></PageScaffold>;
  const { answer } = state;
  const dirty = doc !== null && canonicalFlowJson(doc) !== state.saved;
  const edit = (next: FlowDoc): void => { setState({ ...state, doc: next }); setServerProblems(null); setNote(''); };

  const save = async (): Promise<boolean> => {
    if (doc === null) return false;
    try {
      await api.saveFlowDraft(p.id, doc);
      setState({ ...state, saved: canonicalFlowJson(doc) });
      setNote('Draft saved.');
      return true;
    } catch (e) { setNote(`Not saved: ${failWord(e)}`); return false; }
  };
  const publish = async (): Promise<void> => {
    setBusy(true);
    if (dirty && !(await save())) { setBusy(false); return; }
    try {
      const r = await api.publishFlow(p.id);
      setNote(`Published as version ${r.version}.`);
      load();
    } catch (e) {
      const body = e instanceof ApiError ? (e.body as { problems?: FlowProblem[] } | null) : null;
      if (body?.problems) setServerProblems(body.problems);
      setNote(`Not published: ${failWord(e)}`);
    }
    setBusy(false);
  };
  const exportVersion = (v: number): void => {
    api.getFlowVersion(p.id, v).then((r) => {
      if (!r.doc.ok) { setNote(`v${v} can't be read: ${r.doc.reason}`); return; }
      saveBytes(flowFileName(r.doc.doc.title, v), new TextEncoder().encode(flowExportJson(r.doc.doc, v)));
    }, (e: unknown) => setNote(`Not saved: ${failWord(e)}`));
  };
  const setDefault = (on: boolean): void => {
    setBusy(true);
    api.setDefaultFlow(on ? p.id : null).then(() => { setBusy(false); load(); },
      (e: unknown) => { setBusy(false); setNote(`Not changed: ${failWord(e)}`); });
  };
  const remove = (): void => {
    api.deleteFlow(p.id).then(() => navigate('/flows'), (e: unknown) => setNote(`Not deleted: ${failWord(e)}`));
  };

  const next = (answer.versions.at(-1)?.version ?? 0) + 1;
  const shown = serverProblems ?? problems;
  const block = doc?.blocks.find((b) => b.id === selected) ?? null;
  return (
    <PageScaffold
      title={doc?.title ?? answer.flow.title} back={back} wide
      actions={(
        <>
          <Button variant="ghost" size="fit" disabled={!dirty || busy} onClick={() => { void save(); }}>Save draft</Button>
          <Button size="fit" disabled={doc === null || problems.length > 0 || busy} onClick={() => { void publish(); }}>{`Publish v${next}`}</Button>
        </>
      )}>
      <div className="flex flex-wrap items-center gap-2">
        {answer.flow.source !== null && <Chip>{`copy of ${answer.flow.source.template} v${answer.flow.source.version}`}</Chip>}
        <Chip>{dirty ? 'unsaved changes' : answer.versions.length === 0 ? 'draft, never published' : `published v${answer.versions.at(-1)!.version}`}</Chip>
        {(answer.flow.pinnedBy ?? 0) > 0 && <Chip>{pinnedWord(answer.flow.pinnedBy ?? 0)}</Chip>}
        <p className={SECTION_PURPOSE} role="status">{note}</p>
      </div>
      {doc === null ? (
        <Section title="This draft can't be read">
          <p className={SECTION_PURPOSE}>{answer.draft.ok ? '' : answer.draft.reason}. Its published versions are kept.</p>
        </Section>
      ) : (
        <>
          {shown.length > 0 && (
            <Section title="Problems" scope={`${shown.length}`} purpose="A flow with problems can be saved as a draft, but not published.">
              <ul className="m-0 grid gap-1 p-0 pl-4">
                {shown.map((pr, i) => (
                  <li key={i} className={SECTION_PURPOSE}>
                    {pr.message}
                    {pr.block !== undefined && <Button variant="ghost" size="fit" className="ml-2" onClick={() => setSelected(pr.block!)}>Show step</Button>}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Flow">
            <label className={FIELD}>Title
              <TextInput value={doc.title} onChange={(ev) => edit({ ...doc, title: ev.target.value })} />
            </label>
          </Section>
          <div className="grid gap-4 @min-[900px]:grid-cols-[minmax(0,1fr)_360px] @min-[900px]:items-start">
            <div className="grid min-w-0 gap-4">
              <Section title="Diagram" purpose="Dashed steps are ccrc's own and locked; an amber arrow is a fix round. Edit a step from the outline.">
                <FlowDiagram doc={doc} selected={selected} />
              </Section>
              <Section title="Steps" scope="outline">
                <ol className="m-0 grid gap-0 p-0">
                  {outlineOrder(doc).map((b) => (
                    <li key={b.id} className="list-none border-t border-edge-subtle first:border-t-0">
                      <ListRow aria-pressed={b.id === selected} onClick={() => setSelected(b.id)} className="flow-step">
                        <span className="text-ink-primary">{b.title}{b.kind === 'protocol' && <span className="text-ink-tertiary"> · locked</span>}</span>
                        <span className={MONO_META}>
                          {`${KIND_WORD[b.kind].toLowerCase()} · ${b.role}`}
                          {b.outcomes.map((o) => ` · ${o} → ${doc.blocks.find((x) => x.id === targetOf(doc, b.id, o))?.title ?? 'nowhere'}`).join('')}
                        </span>
                      </ListRow>
                    </li>
                  ))}
                </ol>
              </Section>
            </div>
            {block === null
              ? <Section title="Step"><p className={SECTION_PURPOSE}>Select a step in the outline.</p></Section>
              : <Inspector doc={doc} block={block} onEdit={edit} onSelect={setSelected} />}
          </div>
          <Section title="Versions" scope={`${answer.versions.length}`} purpose="A published version never changes. A programme pins one when it starts. Save one as a file to share it.">
            {answer.versions.length === 0
              ? <p className={SECTION_PURPOSE}>Nothing published yet.</p>
              : answer.versions.map((v) => (
                <div key={v.version} className={LINE}>
                  <span className={MONO_META}>{`v${v.version} · ${new Date(v.publishedAt).toLocaleString()}`}</span>
                  <Button variant="ghost" size="fit" aria-label={`Save v${v.version} as a file`} onClick={() => exportVersion(v.version)}>Save as file</Button>
                </div>
              ))}
            {answer.isDefault === true ? (
              <div className={LINE}>
                <span className={SECTION_PURPOSE}>New programmes pin this flow's newest version.</span>
                <Button variant="ghost" size="fit" disabled={busy} onClick={() => setDefault(false)}>Stop using for new programmes</Button>
              </div>
            ) : answer.versions.length > 0 && (
              <Button variant="ghost" size="fit" disabled={busy} onClick={() => setDefault(true)}>Use for new programmes</Button>
            )}
            <Button variant="danger-ghost" size="fit" onClick={() => setConfirmDelete(true)}>Delete this flow</Button>
          </Section>
        </>
      )}
      <QuickConfirm open={confirmDelete} onClose={() => setConfirmDelete(false)} tone="danger" title="Delete this flow?"
                    consequence={['Its draft and every published version are removed.', 'Templates are not touched.']}
                    confirmLabel="Delete" onConfirm={remove} />
    </PageScaffold>
  );
}

function Inspector(p: { readonly doc: FlowDoc; readonly block: FlowBlock; readonly onEdit: (d: FlowDoc) => void; readonly onSelect: (id: string) => void }): ReactNode {
  const { doc, block: b } = p;
  const [outcome, setOutcome] = useState('');
  const locked = b.kind === 'protocol';
  const patch = (x: Parameters<typeof setBlock>[2]): void => p.onEdit(setBlock(doc, b.id, x));
  return (
    <Section title={b.title} scope={`step · ${KIND_WORD[b.kind].toLowerCase()}`}>
      {locked ? <p className={SECTION_PURPOSE}>{protocolNote(b)}</p> : (
        <>
          <label className={FIELD}>Title<TextInput value={b.title} onChange={(ev) => patch({ title: ev.target.value })} /></label>
          <SelectField label="Kind" value={b.kind} options={EDITABLE_KINDS.map((k) => [k, KIND_WORD[k]])} onChange={(v) => patch({ kind: v as BlockKind })} />
          <SelectField label="Role" value={b.role} disabled={b.kind === 'gate' && b.gate?.kind === 'approval'}
                       options={FLOW_ROLES.map((r) => [r, r])} onChange={(v) => patch({ role: v as FlowRole })} />
          {b.kind === 'skill' && (
            <label className={FIELD}>Skill to invoke
              <TextInput value={b.skill ?? ''} placeholder="plugin:skill" className="font-mono" onChange={(ev) => patch({ skill: ev.target.value })} />
            </label>
          )}
          {b.kind === 'gate' && (
            <SelectField label="Check" value={b.gate?.kind ?? 'approval'} options={GATE_KINDS.map((g) => [g, GATE_WORD[g]])}
                         onChange={(v) => patch({ gate: { kind: v as GateKind, ...(v === 'pr-state' ? { prState: 'merged' as const } : {}) } })} />
          )}
          {b.kind === 'gate' && b.gate?.kind === 'pr-state' && (
            <SelectField label="PR state" value={b.gate.prState ?? 'merged'} options={GATE_PR_STATES.map((x) => [x, x])}
                         onChange={(v) => patch({ gate: { kind: 'pr-state', prState: v as GatePrState } })} />
          )}
          {b.kind !== 'gate' && (
            <label className={FIELD}>Prompt, sent when a programme reaches this step
              <textarea value={b.prompt ?? ''} rows={8} onChange={(ev) => patch({ prompt: ev.target.value })} className="flow-prompt" />
              <span className="text-ink-tertiary">{`Variables: ${FLOW_VARS.map((v) => `{{${v}}}`).join(' ')}. ccrc's protocol for the role is always sent with it.`}</span>
            </label>
          )}
        </>
      )}
      <div className={STACK}>
        <span className={FIELD}>Outcomes</span>
        {b.outcomes.length === 0 && <span className={MONO_META}>None: the programme ends here.</span>}
        {b.outcomes.map((o) => (
          <div key={o} className="flex items-center gap-2">
            <Chip>{o}</Chip>
            <span aria-hidden="true" className="text-ink-tertiary">→</span>
            <Select aria-label={`Where ${o} leads`} value={targetOf(doc, b.id, o) ?? ''} onChange={(ev) => p.onEdit(setTarget(doc, b.id, o, ev.target.value))}>
              <option value="" disabled>nowhere yet</option>
              {doc.blocks.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}
            </Select>
            {!locked && <Button variant="ghost" size="fit" aria-label={`Remove the outcome ${o}`} onClick={() => p.onEdit(removeOutcome(doc, b.id, o))}>Remove</Button>}
          </div>
        ))}
        {!locked && (
          <form className="flex gap-2" onSubmit={(ev) => { ev.preventDefault(); if (outcome.trim() !== '') { p.onEdit(addOutcome(doc, b.id, outcome.trim())); setOutcome(''); } }}>
            <TextInput aria-label="New outcome" placeholder="new outcome, e.g. blocked" value={outcome} onChange={(ev) => setOutcome(ev.target.value)} />
            <Button type="submit" variant="ghost" size="fit">Add</Button>
          </form>
        )}
      </div>
      <div className={ACTIONS}>
        {b.outcomes.length > 0 && (
          <Button variant="ghost" size="fit" onClick={() => { const r = addStepAfter(doc, b.id); if (r !== null) { p.onEdit(r.doc); p.onSelect(r.id); } }}>Add a step after</Button>
        )}
        {!locked && doc.start !== b.id && (
          <Button variant="danger-ghost" size="fit" onClick={() => { p.onEdit(removeStep(doc, b.id)); p.onSelect(doc.start); }}>Remove this step</Button>
        )}
      </div>
    </Section>
  );
}

const GATE_WORD: Readonly<Record<GateKind, string>> = {
  approval: 'Operator approves', 'pr-state': 'PR reaches a state', attested: 'Session attests, with evidence',
};

/** One labelled choice: the inspector's every select. */
function SelectField(p: {
  readonly label: string; readonly value: string; readonly options: readonly (readonly [string, string])[];
  readonly onChange: (v: string) => void; readonly disabled?: boolean;
}): ReactNode {
  return (
    <label className={FIELD}>{p.label}
      <Select value={p.value} disabled={p.disabled} onChange={(ev) => p.onChange(ev.target.value)}>
        {p.options.map(([v, w]) => <option key={v} value={v}>{w}</option>)}
      </Select>
    </label>
  );
}
