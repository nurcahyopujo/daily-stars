# Frontend standards gap review

Baseline reviewed on 2026-11-09 against the agreed
[frontend standards](../agents/frontend.md). This is a snapshot of the skeleton,
not evidence that future feature or launch gates have passed.

| Area | Evidence at review | Work as features arrive |
| --- | --- | --- |
| Agent guidance | `AGENTS.md` now routes frontend work to the standards. | Apply the guide during implementation and review. |
| Component reuse | `src/main.tsx` contains one static welcome screen; there are no shared React components or repeated feature consumers yet. | Extract application composition as it grows; keep feature components local and share components when actual consumers need them. No speculative component library is needed for the skeleton. |
| Styles | `src/styles.css` uses literal colors and dimensions with global element selectors. | Introduce shared tokens and scope component styles when building production screens; preserve intentional application defaults. |
| Request/save ownership | No frontend request/save-state module is implemented. | Establish the single owner required by the spec before wiring mutations; shared UI receives state and callbacks. |
| Accessibility and responsive behavior | The skeleton uses semantic landmarks and headings and hides decorative stars from assistive technology. It has no interactive forms or save flows. | Verify accessible controls, keyboard/focus behavior, asynchronous feedback, long content, and applicable interaction states with each feature. |
| Automated verification | `package.json` defines the combined check script. `tests/browser/skeleton.spec.ts` covers the shell, runtime errors, overflow, and HTTP routing; `playwright.config.ts` configures phone Chromium and WebKit. | Extend coverage for implemented journeys and shared behavior. Existing shell checks do not cover future feature interactions. |
| Visual and device evidence | `docs/verification/milestone-1.md` records skeleton checks and screenshot inspection. | Inspect affected screens after UI changes; retain separate installed-device checks required by the spec. |

No lint/formatter, automated accessibility analyzer, component showcase, or
visual regression comparison is configured. Those tools were not required by
this agreement; adding them would be a separate proposal. Screenshot capture
does not imply automated visual comparison.

`prototypes/phone-flow.html` remains a disposable interaction reference. Its
rendering helpers and styles are not production React components. Follow the
approved spec interactions when implementing production modules.

This change adds guidance and this review only. It does not refactor components,
introduce tokens, add dependencies, or claim new runtime verification. These
reversible conventions add no domain vocabulary and do not warrant an ADR.
