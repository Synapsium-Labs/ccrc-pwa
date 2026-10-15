// The one error boundary (native Docs reader, design 2026-10-01 section 4.12; it fixes section 0's defect 3: before
// it, a throw while rendering unmounted the whole root and left a blank page). Three mounts in W4, each with its own
// reset key and fallback: `main.tsx` around `<App/>` (a constant key, so it never resets; `RootFallback`), `app.tsx`
// around the detail ladder INSIDE `.shell-detail` (key `path + search`, so any navigation resets it; `ScreenFallback`;
// the sidebar, the login overlay and the toasts are outside it and survive), and `session/ChatList.tsx`'s
// `ChatItemView` per chat item (key the message text or the item key; its two fallbacks live there). W5 adds a
// fourth around the Docs body.
//
// A class because React offers error boundaries only as classes. Declared fields only: the tsconfig's
// `erasableSyntaxOnly` forbids constructor parameter properties.
//
// No overloaded null: `failed` says whether the subtree threw, and `error` is whatever was thrown, which may itself
// be `undefined` or `null` (a `throw undefined` still shows the fallback). `key` is the `resetKey` the state was
// derived for; a different one clears `failed`.
//
// Styles: `.render-fallback` in styles/shell.css, beside `.block-screen`, imported here so the root fallback, which
// replaces the whole app, never depends on another module having loaded it. The buttons are `<Button>` from
// @ccrc/ui (its utilities carry the `min-h-tap` floor; its hook class `.btn-primary` is what shell.css gives its
// width back through), and those utilities ride `@ccrc/ui/styles/theme.css`, which `main.tsx` imports through
// `styles/base.css` before the root boundary mounts.
import { Component } from 'react';
import type { ReactNode } from 'react';
import { Button } from '@ccrc/ui';
import { navigate } from '../lib/router';
import '../styles/shell.css';

export interface RenderBoundaryProps {
  /** Names the mount in the log line: `'root'`, `'detail'` or `'chat item'` in W4. */
  readonly where: string;
  /** A change of this value clears a caught failure and renders the children again; an unchanged one keeps the
   *  fallback. Compared with `===`. */
  readonly resetKey: string | number;
  /** What to draw instead of the children once they threw; called with the thrown value, whatever it was. */
  readonly fallback: (error: unknown) => ReactNode;
  readonly children?: ReactNode;
}

interface RenderBoundaryState {
  /** The children threw while rendering under the current `key`. */
  readonly failed: boolean;
  /** The thrown value. Meaningful only while `failed`; it may be `undefined` or `null` when that is what was thrown. */
  readonly error: unknown;
  /** The `resetKey` this state belongs to. */
  readonly key: string | number;
}

export class RenderBoundary extends Component<RenderBoundaryProps, RenderBoundaryState> {
  state: RenderBoundaryState = { failed: false, error: undefined, key: this.props.resetKey };

  static getDerivedStateFromError(error: unknown): Partial<RenderBoundaryState> {
    return { failed: true, error };
  }

  static getDerivedStateFromProps(
    props: RenderBoundaryProps,
    state: RenderBoundaryState,
  ): Partial<RenderBoundaryState> | null {
    if (props.resetKey === state.key) return null;
    return { failed: false, error: undefined, key: props.resetKey };
  }

  componentDidCatch(error: unknown): void {
    console.warn('ccrc: render error in ' + this.props.where, error);
  }

  render(): ReactNode {
    return this.state.failed ? this.props.fallback(this.state.error) : this.props.children;
  }
}

/** The root mount's fallback: the whole app could not draw. `reload` defaults to reloading the page; tests inject
 *  it, because jsdom implements no navigation. */
export function RootFallback({ reload = () => location.reload() }: { reload?: () => void }): ReactNode {
  return (
    <div className="render-fallback render-fallback--root" role="alert">
      <p className="render-fallback-copy">ccrc could not draw this screen.</p>
      <Button variant="primary" onClick={() => reload()}>
        Reload
      </Button>
    </div>
  );
}

/** The detail pane's fallback: one screen could not draw; the sidebar beside it still works. */
export function ScreenFallback(): ReactNode {
  return (
    <div className="render-fallback" role="alert">
      <p className="render-fallback-copy">This screen could not be shown.</p>
      <Button variant="primary" onClick={() => navigate('/')}>
        Back to the fleet
      </Button>
    </div>
  );
}
