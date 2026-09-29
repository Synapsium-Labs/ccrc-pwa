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
export { LimitBar, limitBand, type LimitBand, type LimitBarProps } from './primitives/limit-bar';
export { Skeleton, type SkeletonProps } from './primitives/skeleton';
export { Sheet, type SheetProps } from './primitives/sheet';
export { QuickConfirm, type QuickConfirmProps } from './primitives/confirm';
export {
  toast,
  ToastHost,
  setToastSuppressor,
  type ToastKind,
  type ToastAction,
} from './primitives/toast';
export { cn } from './lib/cn';
