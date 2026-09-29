// @ccrc/ui — the Phosphor & Ink design system. Ships SOURCE, not a build: the
// consuming app's vite compiles these files, so there is no dist to stale.
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
