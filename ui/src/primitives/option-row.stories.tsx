import type { Meta, StoryObj } from '@storybook/react-vite';
import { OptionRow } from './option-row';

const meta = {
  title: 'Primitives/OptionRow',
  component: OptionRow,
  parameters: { layout: 'padded' },
  args: { label: 'Forward-fill per class', onClick: () => {} },
} satisfies Meta<typeof OptionRow>;
export default meta;

type Story = StoryObj<typeof meta>;

/** The bare row: one label, nothing else. CHECK that it is at least 52px tall
 *  — the row is a phone tap target before it is a line of text — and that it
 *  carries its own bottom rule, which is what separates it from its sibling
 *  in a list. */
export const Plain: Story = {};

/** A list, which is the only honest way to look at this row: alignment
 *  BETWEEN rows is the thing to check, not any one row.
 *
 *  CHECK: (1) the three labels start at the same x even though only the first
 *  wears the ❯ — unselected rows pass `glyph=""` to reserve that column, and
 *  dropping it is how a selected list goes ragged. (2) Only the selected row
 *  is tinted and only it wears the ↵. (3) The mono digits are the ones ccd's
 *  own TUI menu answers to, so they are the caller's numbers, not an
 *  auto-incrementing index this row invented. */
export const InAList: Story = {
  render: () => (
    <div style={{ borderTop: '1px solid var(--edge-subtle)' }}>
      <OptionRow selected glyph="❯" index={1} enter="↵" label="Forward-fill per class" onClick={() => {}} />
      <OptionRow glyph="" index={2} label="Emit only complete rows" onClick={() => {}} />
      <OptionRow glyph="" index={3} label="Chat about this" onClick={() => {}} />
    </div>
  ),
};

/** With and without the sublabel, side by side. CHECK that the sublabel reads
 *  as BODY COPY rather than as meta — it is the sentence the 3-line TUI box
 *  had to throw away, so it is the row's whole reason to be legible — and
 *  that a row without one does not reserve empty space for it. */
export const WithAndWithoutSublabel: Story = {
  render: () => (
    <div style={{ borderTop: '1px solid var(--edge-subtle)' }}>
      <OptionRow
        glyph=""
        index={1}
        label="Forward-fill per class"
        sublabel="Inherits the last rate seen for that class, so a gap never reads as zero."
        onClick={() => {}}
      />
      <OptionRow glyph="" index={2} label="Emit only complete rows" onClick={() => {}} />
    </div>
  ),
};

/** Long label, long sublabel, no spaces to break on. CHECK that BOTH wrap
 *  inside the body and nothing overflows the row horizontally: the real
 *  content here is paths, URLs and snake_case identifiers on a phone, which
 *  is why the body wraps `anywhere` rather than on word boundaries. The
 *  columns either side must stay put while the body grows. */
export const LongLabelWraps: Story = {
  render: () => (
    <div style={{ maxWidth: 320, borderTop: '1px solid var(--edge-subtle)' }}>
      <OptionRow
        selected
        glyph="❯"
        index={1}
        enter="↵"
        label="Rewrite docs/superpowers/specs/2026-08-10-architecture-ddd-clean-solid.md"
        sublabel="src/coord/store.ts::parkSupersededDeliveries — replaces the inline UPDATE with a single-line-signature method so the writer census attributes it correctly."
        onClick={() => {}}
      />
    </div>
  ),
};

/** The trailing slot, in use. This row owns the ↵; it does NOT own what a
 *  caller hangs here instead. CHECK that each marker sits where the ↵ would
 *  have, that it never shares the slot with one, and that a note belonging to
 *  the OPTION rather than to the slot (the third row) wraps with the body
 *  instead — two different facts, never one line. The marker classes here are
 *  the app's, spelled out so this story stands alone. */
export const TrailingMarkers: Story = {
  render: () => (
    <div style={{ borderTop: '1px solid var(--edge-subtle)' }}>
      <OptionRow
        glyph=""
        index={1}
        label="Emit only complete rows"
        busy
        marker={<span style={{ flex: 'none', font: 'var(--weight-regular) var(--fs-xs)/1 var(--family-mono)', color: 'var(--status-busy-text)' }}>answering…</span>}
        onClick={() => {}}
      />
      <OptionRow
        selected
        glyph="❯"
        label="Opus 5"
        marker={<span style={{ flex: 'none', font: 'var(--weight-regular) var(--fs-2xs)/1 var(--family-mono)', color: 'var(--ink-tertiary)' }}>inert on this lane</span>}
        onClick={() => {}}
      />
      <OptionRow selected glyph="❯" label="Sonnet 4.5" enter="●" onClick={() => {}}>
        <span style={{ font: 'var(--weight-regular) var(--fs-2xs)/1.3 var(--family-mono)', color: 'var(--ink-tertiary)' }}>
          serving Haiku (share ceiling)
        </span>
      </OptionRow>
    </div>
  ),
};

/** The two inert shapes. CHECK that both recede to --ink-disabled INCLUDING
 *  their leading columns, and then check the DOM: the first is a disabled
 *  <button> and the second a <div aria-disabled>, because a row with no
 *  handler must not be offered to a screen reader as tappable at all. The
 *  stylesheet needs both spellings; passing `onClick` is what picks one. */
export const Disabled: Story = {
  render: () => (
    <div style={{ borderTop: '1px solid var(--edge-subtle)' }}>
      <OptionRow glyph="" index={1} label="Allow once" disabled onClick={() => {}} />
      <OptionRow
        index={2}
        label="Answer this one in the terminal"
        sublabel="Only the first question of an envelope is ever tappable."
        disabled
      />
    </div>
  ),
};
