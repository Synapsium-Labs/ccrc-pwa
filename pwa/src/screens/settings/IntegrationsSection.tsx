// Settings › Integrations (D-8932): the services ccrc works with, a section of their own. The
// Linear card and Project linking sat on Security, beside the sign-in gate and the box token, where an operator looking
// for "how do I connect Linear" did not look. They moved here whole: the same cards, the same routes and the same writes.
// The GitHub card is new and read-only.
//
// The order: the Linear keys, then how each project links to a Linear team (which reads those keys' workspaces), then
// GitHub. The Linear read is the frame's (`SettingsDataProvider`); the project list is this section's one read
// (`useProjectList`), handed to both cards that draw from it.
import type { ReactNode } from 'react';
import type { LinearWorkspacesPoll } from '../../fleet/useLinearWorkspaces';
import { LinearSection } from '../LinearSection';
import { GitHubCard } from './GitHubCard';
import { ProjectLinkingCard } from './ProjectLinkingCard';
import { useProjectList } from './useProjectList';

export function IntegrationsSection({ linear }: { linear: LinearWorkspacesPoll }): ReactNode {
  const list = useProjectList();
  return (
    <>
      <LinearSection poll={linear} />
      {/* Project linking (D-8147) follows Linear: it takes the Linear card's one workspace list and its legacy row (the
          workspace picker's source) from the frame's read, so it waits on no poll of its own. */}
      <ProjectLinkingCard workspaces={linear.view?.workspaces ?? null} legacy={linear.view?.legacy ?? null} list={list} />
      <GitHubCard list={list.read} />
    </>
  );
}
