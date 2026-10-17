/**
 * The ask lane's notification bodies, built in one module (coordinator-first
 * routing spec §9). Task 3 (D-5302) adds `askPushBody`, the raise sites' body
 * from the hook envelope, beside these; the coordinator's replacement bodies
 * live here so every surface that rewrites an ask's notification spells it
 * the same way.
 */

/**
 * D-5289, late answer wins: the body that replaces the operator's lapsed ask
 * notification, under the same tag, once the child's parent answers after the
 * deadline. Names the principal and nothing else: the question is already on
 * the notification it replaces, and the parent's choice is in the feed.
 */
export function answeredByBody(parent: string): string {
  return `answered by ${parent}`;
}
