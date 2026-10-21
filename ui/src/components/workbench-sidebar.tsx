// WorkbenchSidebar — the desk's workspace tree: every project (or every status group) with its sessions, a
// coordinator's lanes and a lane's running subagents, in one column beside the working surface.
//
// IT ONLY DRAWS. The app groups, orders, filters and seeds the folds, and hands the result over as `sections`; the
// words that state app behaviour (state words, lane summaries, group labels) arrive as props. What this file owns is
// the tree's shape, its keyboard and its local fold state — nothing fetches, polls or persists.
//
// A FLAT TREE. Section heads, session rows, lanes and agents are SIBLING `treeitem`s carrying `aria-level`
// (1 section, 2 session, 3 lane, 4 agent), `aria-setsize` and `aria-posinset`. Wrappers are `role="none"`. Nested
// DOM groups would make a focus ring wrap a whole subtree, and the lanes' wrapper exists only to draw the tree rule.
//
// THE POINTER HELPERS. The `+` is a real, named button inside the head treeitem (`treeitem` does not have
// presentational children, so axe's `nested-interactive` stays quiet), untabbable because the head is the tab stop.
// Its keyboard and assistive-technology route is the head itself: Shift+Enter on a head that can create calls
// `onNewSession`, and that head declares it in `aria-keyshortcuts` — the same answer WorkbenchTabs gives its
// pointer-only close (Delete). The coordinator tag is an `aria-hidden` button with `tabIndex={-1}`: a pointer-only
// toggle whose state the row's own `aria-expanded` carries, and which ←/→ reach from the keyboard.
//
// LONG IDS NEVER BREAK THE COLUMN. Every chip's text sits in a `wb-side-clip` span so the chip can ellipsize (a
// Chip is `inline-flex`, and an anonymous flex item cannot): the pool and account chips shrink first, the label and
// the branch keep a floor, and the counts, the `+` and an agent's age never leave the column (the sheet). The head's
// label and pool share one `wb-side-title` line, so a pool with no room left wraps out of sight instead of
// squeezing the label.
import { useId, useRef, useState } from 'react';
import type { FocusEvent, KeyboardEvent, MouseEvent, ReactNode } from 'react';
import { cn } from '../lib/cn';
import { FOCUS_RING } from '../lib/focus';
import { Chip } from '../primitives/chip';
import { CountBadge } from '../primitives/count-badge';
import { Icon } from '../primitives/icon';
import { StatusDot, type StatusDotProps } from '../primitives/status-dot';
import { TextInput } from '../primitives/text-input';
import './workbench-sidebar.css';

/** The lamp's own vocabulary, derived from the primitive: this package takes nothing from `shared/` here. */
export type WorkbenchStatus = StatusDotProps['status'];

export type WorkbenchSidebarMode = 'projects' | 'status';

/** An account as the row shows it: its display name and the app's `accountHue(...)` result (`null` = unknown). */
export interface WorkbenchAccountTag { label: string; hue: string | null }

/** A running subagent, nested one step under its session. */
export interface WorkbenchAgentItem { id: string; name: string; task: string; age: string; running: boolean }

export interface WorkbenchSessionItem {
  id: string;
  /** Display name, never a raw id. */
  name: string;
  status: WorkbenchStatus;
  /** StatusDot's own prop: a `dead` row that is hibernated. */
  asleep?: boolean;
  /** Line two, the app's words: "waiting", "working · 04:12", "hibernated". */
  stateWord: string;
  /** Mono, e.g. `ws/feature-x`. */
  branch?: string | null;
  account?: WorkbenchAccountTag | null;
  /** `#123`. */
  pr?: string | null;
  /** Icon bot + count; 0 or absent draws no chip. */
  subagents?: number;
  /** Non-empty makes this row a coordinator. */
  lanes?: readonly WorkbenchSessionItem[];
  /** A folded coordinator's line two, in the app's words: "3 lanes · 2 working · 1 waiting". */
  laneSummary?: string;
  /** The coordinator's fold seed. */
  defaultFolded?: boolean;
  /** Running subagents, nested one step further. */
  agents?: readonly WorkbenchAgentItem[];
}

/** A project (projects mode) or a status group (status mode); the app shapes both. */
export interface WorkbenchSection {
  id: string;
  /** The project id, or the group label in the app's words ("Needs you", "Working", …). */
  label: string;
  /** Status mode: the group head's lamp. */
  lamp?: WorkbenchStatus;
  /** Projects mode: the project's pool, as a Chip. */
  pool?: string | null;
  /** "<n> waiting" only when > 0, shown even while folded. */
  waiting: number;
  total: number;
  /** The app seeds Idle/Cleanup/Archived/Dead folded. */
  defaultFolded?: boolean;
  /** Shows the `+`. */
  canCreate?: boolean;
  items: readonly WorkbenchSessionItem[];
}

export interface WorkbenchSidebarProps {
  mode: WorkbenchSidebarMode;
  onModeChange: (mode: WorkbenchSidebarMode) => void;
  query: string;
  onQueryChange: (query: string) => void;
  /** Already grouped, ordered and FILTERED by the app. */
  sections: readonly WorkbenchSection[];
  /** The open tab's session. */
  selectedId: string | null;
  onOpen: (sessionId: string) => void;
  onOpenAgent?: (sessionId: string, agentId: string) => void;
  onNewSession?: (sectionId: string) => void;
  /** The app passes its `<WorkbenchAccountRow …/>`. */
  foot?: ReactNode;
}

type Folds = Record<string, boolean>;

/** One visible treeitem, in document order: what the keys walk. */
interface TreeNode {
  key: string;
  parent: string | null;
  /** `true`/`false` for a head or coordinator, `null` for a leaf. */
  expanded: boolean | null;
  /** Sets a head's or coordinator's fold (`true` folds); a leaf's is a no-op. */
  fold: (folded: boolean) => void;
  activate: () => void;
  /** A head that can create: Shift+Enter's `onNewSession`. */
  create?: () => void;
}

const sectionKey = (id: string): string => `s:${id}`;
const rowKey = (id: string): string => `r:${id}`;
const agentKey = (sessionId: string, agentId: string): string => `a:${sessionId}:${agentId}`;

const isCoordinator = (item: WorkbenchSessionItem): boolean => (item.lanes?.length ?? 0) > 0;
const childCount = (item: WorkbenchSessionItem): number => (item.agents?.length ?? 0) + (item.lanes?.length ?? 0);
const isDim = (status: WorkbenchStatus): boolean => status === 'cleanup' || status === 'archived';

/** The head's key route to `onNewSession` — the `+` is pointer-only (header). */
const NEW_SESSION_KEY = 'Shift+Enter';

const MODES: readonly { id: WorkbenchSidebarMode; label: string }[] = [
  { id: 'projects', label: 'Projects' },
  { id: 'status', label: 'Status' },
];

function RowItem({ item, level, setSize, posInSet, selected, folded, tabStop, onToggle, onOpen }: {
  item: WorkbenchSessionItem;
  level: number;
  setSize: number;
  posInSet: number;
  selected: boolean;
  folded: boolean;
  tabStop: boolean;
  onToggle: () => void;
  onOpen: () => void;
}): ReactNode {
  const coordinator = isCoordinator(item);
  const dim = isDim(item.status) ? 'true' : undefined;
  const summary = coordinator && folded;
  const toggleTag = (e: MouseEvent): void => {
    e.stopPropagation();
    onToggle();
  };
  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-selected={selected}
      aria-expanded={coordinator ? !folded : undefined}
      tabIndex={tabStop ? 0 : -1}
      data-tree-id={rowKey(item.id)}
      className={cn('wb-side-row', FOCUS_RING)}
      onClick={onOpen}
    >
      <StatusDot status={item.status} asleep={item.asleep} />
      <span className="wb-side-name" data-dim={dim}>{item.name}</span>
      <span className="wb-side-chips">
        {item.pr ? <Chip className="wb-side-pr">{item.pr}</Chip> : null}
        {item.subagents ? (
          <span className="wb-side-subs">
            <Icon name="bot" />
            {item.subagents}
            <span className="sr-only">{item.subagents === 1 ? ' subagent' : ' subagents'}</span>
          </span>
        ) : null}
        {coordinator ? (
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className={cn('wb-side-ctag', FOCUS_RING)}
            onClick={toggleTag}
          >
            {`${folded ? '▸' : '▾'} coordinator · ${item.lanes?.length ?? 0}`}
          </button>
        ) : null}
      </span>
      <span className="wb-side-sub">
        {summary ? (
          <span className="wb-side-word" data-dim={dim}>{item.laneSummary}</span>
        ) : (
          <>
            <span className="wb-side-word" data-dim={dim} data-attention={item.status === 'attention' ? 'true' : undefined}>
              {item.stateWord}
            </span>
            {item.branch ? <span className="wb-side-branch">{item.branch}</span> : null}
          </>
        )}
        {item.account ? (
          <Chip className="wb-side-acct" data-acct={item.account.hue ?? 'unknown'}>
            <span className="wb-side-clip">{item.account.label}</span>
          </Chip>
        ) : null}
      </span>
    </div>
  );
}

function AgentItem({ agent, level, setSize, posInSet, tabStop, treeKey, onOpen }: {
  agent: WorkbenchAgentItem;
  level: number;
  setSize: number;
  posInSet: number;
  tabStop: boolean;
  treeKey: string;
  onOpen: () => void;
}): ReactNode {
  return (
    <div
      role="treeitem"
      aria-level={level}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-selected={false}
      tabIndex={tabStop ? 0 : -1}
      data-tree-id={treeKey}
      className={cn('wb-side-agent', FOCUS_RING)}
      onClick={onOpen}
    >
      <StatusDot status={agent.running ? 'working' : 'idle'} />
      <span className="wb-side-name">{agent.name}</span>
      <span className="wb-side-task">{agent.task}</span>
      <span className="wb-side-age">{agent.age}</span>
    </div>
  );
}

function HeadItem({ section, mode, setSize, posInSet, folded, tabStop, onToggle, onNewSession }: {
  section: WorkbenchSection;
  mode: WorkbenchSidebarMode;
  setSize: number;
  posInSet: number;
  folded: boolean;
  tabStop: boolean;
  onToggle: () => void;
  onNewSession?: (sectionId: string) => void;
}): ReactNode {
  const labelId = useId();
  const countsId = useId();
  const create = (e: MouseEvent): void => {
    e.stopPropagation();
    onNewSession?.(section.id);
  };
  const creates = section.canCreate === true && onNewSession !== undefined;
  return (
    <div
      role="treeitem"
      aria-level={1}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-expanded={!folded}
      aria-labelledby={`${labelId} ${countsId}`}
      aria-keyshortcuts={creates ? NEW_SESSION_KEY : undefined}
      tabIndex={tabStop ? 0 : -1}
      data-tree-id={sectionKey(section.id)}
      className={cn('wb-side-head', FOCUS_RING)}
      onClick={onToggle}
    >
      <span className="wb-side-fold" aria-hidden="true">{folded ? '▸' : '▾'}</span>
      {section.lamp ? <StatusDot status={section.lamp} /> : null}
      <span className="wb-side-title">
        <span id={labelId} className="wb-side-label" data-mono={mode === 'projects' ? 'true' : undefined}>
          {section.label}
        </span>
        {section.pool ? (
          <Chip className="wb-side-pool">
            <span className="wb-side-clip">{section.pool}</span>
          </Chip>
        ) : null}
      </span>
      <span id={countsId} className="wb-side-counts">
        {section.waiting > 0 ? <CountBadge>{`${section.waiting} waiting`}</CountBadge> : null}
        <span className="wb-side-total">
          {section.total}
          <span className="sr-only"> total</span>
        </span>
      </span>
      {creates ? (
        <button
          type="button"
          tabIndex={-1}
          aria-label={`New session on ${section.label}`}
          className={cn('wb-side-new', FOCUS_RING)}
          onClick={create}
        >
          +
        </button>
      ) : null}
    </div>
  );
}

export function WorkbenchSidebar({
  mode,
  onModeChange,
  query,
  onQueryChange,
  sections,
  selectedId,
  onOpen,
  onOpenAgent,
  onNewSession,
  foot,
}: WorkbenchSidebarProps): ReactNode {
  // Local UI state only: the folds (seeded lazily from each `defaultFolded`) and the last-focused item.
  const [folds, setFolds] = useState<Folds>({});
  const [focused, setFocused] = useState<string | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const isFolded = (key: string, seed: boolean | undefined): boolean => folds[key] ?? seed ?? false;
  const setFold = (key: string, seed: boolean | undefined, next?: boolean): void =>
    setFolds((f) => ({ ...f, [key]: next ?? !(f[key] ?? seed ?? false) }));

  // The visible items in document order — the one walk the keys and the roving tab stop read. The JSX below
  // renders the same sections under the same folds.
  const nodes: TreeNode[] = [];
  const walkRow = (item: WorkbenchSessionItem, parent: string): void => {
    const key = rowKey(item.id);
    const coordinator = isCoordinator(item);
    const folded = coordinator && isFolded(key, item.defaultFolded);
    nodes.push({
      key, parent, expanded: coordinator ? !folded : null,
      fold: (next) => { if (coordinator) setFold(key, item.defaultFolded, next); },
      activate: () => onOpen(item.id),
    });
    if (folded) return;
    for (const a of item.agents ?? []) {
      nodes.push({
        key: agentKey(item.id, a.id), parent: key, expanded: null,
        fold: () => undefined,
        activate: () => onOpenAgent?.(item.id, a.id),
      });
    }
    for (const l of item.lanes ?? []) walkRow(l, key);
  };
  for (const s of sections) {
    const key = sectionKey(s.id);
    const folded = isFolded(key, s.defaultFolded);
    nodes.push({
      key, parent: null, expanded: !folded,
      fold: (next) => setFold(key, s.defaultFolded, next),
      activate: () => setFold(key, s.defaultFolded),
      create: s.canCreate === true && onNewSession !== undefined ? () => onNewSession(s.id) : undefined,
    });
    if (!folded) for (const it of s.items) walkRow(it, key);
  }

  const visible = new Set(nodes.map((n) => n.key));
  const selectedKey = selectedId === null ? null : rowKey(selectedId);
  const tabStop =
    (focused !== null && visible.has(focused) && focused)
    || (selectedKey !== null && visible.has(selectedKey) && selectedKey)
    || nodes[0]?.key
    || null;

  const focusKey = (key: string): void => {
    const el = [...(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-id]') ?? [])]
      .find((e) => e.dataset['treeId'] === key);
    el?.focus();
    setFocused(key);
  };

  const onFocus = (e: FocusEvent<HTMLDivElement>): void => {
    const key = (e.target as HTMLElement).dataset['treeId'];
    if (key !== undefined) setFocused(key);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>): void => {
    // Keys belong to the focused treeitem itself, never to a helper button inside one.
    const key = (e.target as HTMLElement).dataset['treeId'];
    if (key === undefined) return;
    const at = nodes.findIndex((n) => n.key === key);
    const node = nodes[at];
    if (node === undefined) return;
    let handled = true;
    switch (e.key) {
      case 'ArrowDown': {
        const next = nodes[at + 1];
        if (next) focusKey(next.key);
        break;
      }
      case 'ArrowUp': {
        const prev = nodes[at - 1];
        if (prev) focusKey(prev.key);
        break;
      }
      case 'Home': {
        const first = nodes[0];
        if (first) focusKey(first.key);
        break;
      }
      case 'End': {
        const last = nodes[nodes.length - 1];
        if (last) focusKey(last.key);
        break;
      }
      case 'ArrowRight': {
        if (node.expanded === false) node.fold(false);
        else {
          const child = nodes[at + 1];
          if (child && child.parent === key) focusKey(child.key);
        }
        break;
      }
      case 'ArrowLeft': {
        if (node.expanded === true) node.fold(true);
        else if (node.parent !== null) focusKey(node.parent);
        break;
      }
      case 'Enter':
        if (e.shiftKey && node.create) node.create();
        else node.activate();
        break;
      default:
        handled = false;
    }
    if (handled) e.preventDefault();
  };

  const empty = sections.length === 0;

  return (
    <nav className="wb-side" aria-label="Workspaces">
      <div className="wb-side-tools">
        <div className="wb-side-search">
          <Icon name="search" />
          <TextInput
            type="search"
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            aria-label="Filter workspaces"
            placeholder="Filter"
            className="pl-8"
          />
        </div>
        <div role="group" aria-label="Group by" className="wb-side-modes">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              aria-pressed={mode === m.id}
              className={cn('wb-side-mode', FOCUS_RING)}
              onClick={() => onModeChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {empty ? (
        query !== '' ? <p className="wb-side-empty">{`No workspace matches “${query}”.`}</p> : null
      ) : (
        <div
          ref={treeRef}
          role="tree"
          aria-label="Workspaces"
          className="wb-side-tree"
          onKeyDown={onKeyDown}
          onFocus={onFocus}
        >
          {sections.map((s, si) => {
            const sKey = sectionKey(s.id);
            const folded = isFolded(sKey, s.defaultFolded);
            const renderRow = (item: WorkbenchSessionItem, level: number, setSize: number, pos: number): ReactNode => {
              const key = rowKey(item.id);
              const coordinator = isCoordinator(item);
              const rowFolded = coordinator && isFolded(key, item.defaultFolded);
              const agents = item.agents ?? [];
              const lanes = item.lanes ?? [];
              const kids = childCount(item);
              return (
                <div key={item.id} role="none">
                  <RowItem
                    item={item}
                    level={level}
                    setSize={setSize}
                    posInSet={pos}
                    selected={item.id === selectedId}
                    folded={rowFolded}
                    tabStop={tabStop === key}
                    onToggle={() => setFold(key, item.defaultFolded)}
                    onOpen={() => onOpen(item.id)}
                  />
                  {!rowFolded && kids > 0 ? (
                    <div role="none" className="wb-side-lanes">
                      {agents.map((a, ai) => (
                        <AgentItem
                          key={a.id}
                          agent={a}
                          level={level + 1}
                          setSize={kids}
                          posInSet={ai + 1}
                          tabStop={tabStop === agentKey(item.id, a.id)}
                          treeKey={agentKey(item.id, a.id)}
                          onOpen={() => onOpenAgent?.(item.id, a.id)}
                        />
                      ))}
                      {lanes.map((l, li) => renderRow(l, level + 1, kids, agents.length + li + 1))}
                    </div>
                  ) : null}
                </div>
              );
            };
            return (
              <div key={s.id} role="none">
                <HeadItem
                  section={s}
                  mode={mode}
                  setSize={sections.length}
                  posInSet={si + 1}
                  folded={folded}
                  tabStop={tabStop === sKey}
                  onToggle={() => setFold(sKey, s.defaultFolded)}
                  onNewSession={onNewSession}
                />
                {folded ? null : s.items.map((it, ii) => renderRow(it, 2, s.items.length, ii + 1))}
              </div>
            );
          })}
        </div>
      )}
      {foot}
    </nav>
  );
}
