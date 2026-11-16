// The fleet host for a suite that renders `FleetScreen` alone (D-5468, D-5676). Since the lift the screen reads its
// polls and sheets from `FleetChromeProvider`, and the sheets render from `FleetFlows` beside it, as `app.tsx` mounts
// them. `renderFleet` is `render` with that host as its wrapper, so a call site changes its function name and nothing
// else: the store the host acts on is the one the element under test was given (the first `store` prop in the tree),
// or the app's own store when none was.
import { Children, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { render, type RenderResult } from '@testing-library/react';
import { FleetChromeProvider } from '../src/fleet/FleetChrome';
import { FleetFlows } from '../src/fleet/FleetFlows';
import { useFleetStore, type FleetStore } from '../src/stores/fleet';

const findStore = (node: ReactNode): FleetStore | null => {
  for (const child of Children.toArray(node)) {
    if (!isValidElement(child)) continue;
    const props = child.props as { store?: FleetStore; children?: ReactNode };
    if (props.store !== undefined) return props.store;
    const inner = findStore(props.children);
    if (inner !== null) return inner;
  }
  return null;
};

export function FleetHost({ store, children }: { store: FleetStore; children?: ReactNode }): ReactNode {
  return (
    <FleetChromeProvider store={store}>
      {children}
      <FleetFlows />
    </FleetChromeProvider>
  );
}

export function renderFleet(ui: ReactElement, store: FleetStore = findStore(ui) ?? useFleetStore): RenderResult {
  return render(ui, { wrapper: ({ children }) => <FleetHost store={store}>{children}</FleetHost> });
}
