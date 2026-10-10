// @ccrc/ui — the Phosphor & Ink design system. The APP consumes source: the
// consuming app's vite compiles these files, and `exports['.']` points here, so
// there is no dist for pwa to stale.
//
// `npm run build` does emit `dist/`, for one reader only — the /design-sync
// converter, which bundles a built entry and reads its `.d.ts` tree. Nothing in
// pwa resolves it. See `.design-sync/NOTES.md`.
//
// Styles are one entry point, styles/theme.css, which pulls tokens.css in
// itself. Import that and nothing else — see the header of that file for why
// the order is load-bearing.
export { Button, buttonVariants, type ButtonProps } from './primitives/button';
export { StatusDot, dotVariants, type StatusDotProps, statusLabel } from './primitives/status-dot';
export { LimitBar, limitBand, fillVariants, TRACK as LIMIT_TRACK, type LimitBand, type LimitBarProps } from './primitives/limit-bar';
export { Skeleton, type SkeletonProps } from './primitives/skeleton';
export { Sheet, type SheetProps } from './primitives/sheet';
export { OptionRow, type OptionRowProps } from './primitives/option-row';
export { CollapsibleStrip, type CollapsibleStripProps } from './primitives/collapsible-strip';
export { Banner, bannerVariants, type BannerProps } from './primitives/banner';
export {
  TextInput, TEXT_INPUT, TEXT_INPUT_INLINE, TEXT_INPUT_STACKED, type TextInputProps,
} from './primitives/text-input';
export { BackButton, BACK_BUTTON, type BackButtonProps } from './primitives/back-button';
export { Door, DOOR, DOOR_GLYPH, type DoorProps } from './primitives/door';
export { Well, WELL, type WellProps } from './primitives/well';
export { Chip, CHIP, CHIP_DOT, type ChipProps } from './primitives/chip';
export {
  ControlRow, CONTROL_ROW, CONTROL_ROW_NOTE, type ControlRowProps,
} from './primitives/control-row';
export { ListRow, LIST_ROW, type ListRowProps } from './primitives/list-row';
export { CoverScreen, COVER_SCREEN, type CoverScreenProps } from './primitives/cover-screen';
export { BareRow, BARE_ROW, type BareRowProps } from './primitives/bare-row';
export { CountBadge, COUNT_BADGE, type CountBadgeProps } from './primitives/count-badge';
export { Keycap, KEYCAP, type KeycapProps } from './primitives/keycap';
// Two constants with no component of their own: each is a handful of
// utilities that two or three app rules spelled identically, and wrapping
// either in a `<span>` would add an element nobody asked for.
export {
  MONO_PATH, ATTENTION_DOT, EYEBROW, RESET_LIST,
  MAIL_GLYPH, WARN_GLYPH, SETTINGS_GLYPH,
} from './lib/text';
export { PRESS_FEEDBACK, PRESS_TRANSFORM } from './lib/press';
export { QuickConfirm, QC_CONSEQUENCE, QC_ACTIONS, type QuickConfirmProps } from './primitives/confirm';
export {
  toast,
  ToastHost,
  setToastSuppressor,
  type ToastKind,
  type ToastAction,
} from './primitives/toast';

// — composites —
// Built FROM the primitives above, and the line between the two groups is not
// size: a primitive has no opinion about what it is showing, a composite does.
// `TypedLabel` knows that a label which CHANGED is the event worth marking.
export { TypedLabel, TYPE_MS } from './components/typed-label';
export { AttachButton, type AttachButtonProps } from './components/attach-button';
export { AttachTray, type AttachTrayProps, type StagedImage } from './components/attach-tray';
export { MailCard, runLabel } from './components/mail-card';
export { TaskCard } from './components/task-card';
export { MailStrip, summarizeMail, heldGate } from './components/mail-strip';
export {
  ToolCard,
  askState,
  ASK_WORD,
  ASK_GLYPH,
  type AskState,
  type ToolUseEvent,
  type ToolResultEvent,
} from './components/tool-card';
export { TaskStrip, orderTasks, summarize } from './components/task-strip';
// `BuildLine` knows that a box whose version it cannot vouch for is the thing
// to say loudly; it reads a `NodeWire[]` and nothing else.
export { BuildLine } from './components/build-line';
// `Prose` is the one composite that renders no tree of its own: what makes
// prose prose is seventy-six rules, and the app still owns the react-markdown
// map that decides which element each token becomes.
export { Prose, PROSE } from './components/prose';

// — themes —
// The palettes themselves live in styles/tokens.css and are DISCOVERED by the
// gates; this exports only the labels and the stamping helpers.
export {
  THEMES, THEME_STORAGE_KEY, PHOSPHOR, SYSTEM, resolveTheme, applyTheme, type ThemeChoice,
} from './styles/themes';

export { cn } from './lib/cn';
export { FOCUS_RING } from './lib/focus';
// Pure utilities the composites above brought with them. `useNow` is the one
// shared re-render tick for live readouts, and `elapsedWords` the one spelling
// of "how long has this been going on" — both had app consumers before the
// migration and keep them, because a second copy of either is the drift
// `single-definition.test.ts` exists to stop.
export { useNow } from './lib/use-now';
export { elapsedWords, elapsedShort } from './lib/elapsed';
export { prefersReducedMotion } from './lib/use-reduced-motion';
