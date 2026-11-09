# Frontend standards

Apply these rules when implementing or reviewing frontend components, styles,
or interactions. Product behavior and module responsibilities remain defined in
[the MVP spec](../../mvp-spec.md#9-implementation-handoff-approved-in-issue-5).

## Before changing the UI

1. Read the relevant product behavior in the spec and inspect the affected screen,
   components, and styles. Search for an existing component or pattern that fits.
2. Choose reuse, a small extension, or a new component. Explain a new shared
   abstraction in terms of its actual consumers and common responsibility.
3. Identify the interaction states and browser scenarios affected by the change.
   Use the rules below to implement and verify them.

## Components and ownership

Use the existing React/TypeScript stack. Keep `src/main.tsx` as the entry point;
move application composition and feature behavior into modules as they grow.
Create directories when code needs them, using these placement conventions:

| Location | Responsibility |
| --- | --- |
| `src/components/` | UI shared across features; typed props and callbacks, with no feature data fetching or points rules. |
| `src/features/<feature>/` | Screens, feature-specific components, and their UI state. Keep components here until another feature needs them. |
| Frontend requests/save-state module | The single owner of requests, action IDs, submitted intent, and save/recovery transitions specified in the implementation handoff. |

Reuse an existing component before adding another implementation of the same
behavior or visual pattern. Extract the common part when multiple places need
it. A single-use component is also appropriate when it gives a complex screen
a clear, focused responsibility. Similar-looking markup alone does not establish
a shared responsibility.

Give components explicit typed props for their data and callbacks for user
actions. Keep state with the nearest owner that needs to coordinate it. Prefer
focused components and composition over a generic component with unrelated
boolean modes. A shared button or field may have named visual variants; a
component that switches between unrelated feature workflows belongs in separate
feature components.

Screens consume the requests/save-state module and render server-confirmed
results. Shared UI renders the supplied state and emits user intent. Keep domain
calculations in the plain TypeScript rule modules, as required by the spec.
When extracting a shared component, migrate its actual consumers together so
the duplicated implementation is removed.

## Styling

Use plain CSS. Establish shared CSS custom properties for recurring colors,
spacing, typography, and radii as UI is added, and reuse existing tokens before
introducing new values. Keep tokens and global defaults in `src/styles.css`;
keep component styles beside their component with a component-specific class
prefix so selectors do not affect unrelated screens. Reserve global element
selectors for application-wide defaults.

Use existing component styles for the same pattern. Add a named variant when
the shared responsibility remains clear. Treat a styling framework or component
library as a separate design decision. The disposable phone prototype supplies
interaction references; it is not a production component system or an approved
design-token catalog.

## Accessibility and interaction states

Use semantic HTML and native controls, including the spec's native child
dropdown. Interactive controls must work by keyboard, have accessible names,
and show visible focus. Associate labels and validation feedback with their
fields. Announce asynchronous status or errors appropriately, without moving
focus for routine saves; restore useful focus when a temporary interaction
closes. Convey outcomes and signed points with text as well as color.

For each data-driven interaction, implement the applicable loading, empty,
error, saving, and success states. For mutations, preserve the spec's retry,
uncertain-save, and stale-edit behavior beside the relevant control. The
requests/save-state module owns those transitions; components must not invent
their own retry or action-ID lifecycle. Follow the spec's memory-only,
network-only v1 behavior.

Make layouts usable on small phones and with long labels and growing lists.
Allow content to wrap, keep controls reachable, and prevent horizontal overflow.
Four children and eight activities in the prototype are examples, not limits.

## Verification and completion

- Test changed user behavior at the appropriate boundary. Use browser flows for
  interactions and the existing rule tests for domain calculations. For a shared
  component change, verify affected consumers and meaningful variants. Prefer
  behavior assertions over snapshots of internal markup or props.
- Run the repository's `check` script from `package.json` for frontend code
  changes. Add relevant scenarios as features arrive; a passing skeleton test
  does not verify a new workflow.
- Inspect affected screens in the configured phone Chromium and WebKit browsers.
  Check long content, empty/error states, focus and keyboard operation where
  applicable. Screenshots need visual inspection; capture alone is not a visual
  regression check. Preserve the spec's separate installed-phone acceptance gates.
- Report what was reused or extracted, verification performed, and remaining
  gaps. If a check cannot run, state the blocker and the unverified behavior.

For documentation-only changes, check links and consistency with the spec;
runtime checks are unnecessary. New tooling is a separate change. The initial
[gap review](../verification/frontend-standards-review.md) records the starting
point and is not an ongoing component inventory.
