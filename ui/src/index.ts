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
export { StatusDot, dotVariants, type StatusDotProps } from './primitives/status-dot';
export { LimitBar, limitBand, fillVariants, TRACK as LIMIT_TRACK, type LimitBand, type LimitBarProps } from './primitives/limit-bar';
export { Skeleton, type SkeletonProps } from './primitives/skeleton';
export { Sheet, type SheetProps } from './primitives/sheet';
export { OptionRow, type OptionRowProps } from './primitives/option-row';
export { CollapsibleStrip, type CollapsibleStripProps } from './primitives/collapsible-strip';
export { Banner, bannerVariants, type BannerProps } from './primitives/banner';
export { QuickConfirm, type QuickConfirmProps } from './primitives/confirm';
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

// — themes —
// The palettes themselves live in styles/tokens.css and are DISCOVERED by the
// gates; this exports only the labels and the stamping helpers.
export {
  THEMES, THEME_STORAGE_KEY, PHOSPHOR, SYSTEM, resolveTheme, applyTheme, type ThemeChoice,
} from './styles/themes';

export { cn } from './lib/cn';
// Pure utilities the composites above brought with them. `useNow` is the one
// shared re-render tick for live readouts, and `elapsedWords` the one spelling
// of "how long has this been going on" — both had app consumers before the
// migration and keep them, because a second copy of either is the drift
// `single-definition.test.ts` exists to stop.
export { useNow } from './lib/use-now';
export { elapsedWords } from './lib/elapsed';
