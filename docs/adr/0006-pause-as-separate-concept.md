# Model a pause as a separate dated concept, not scheduled assignment edits

Parents need to stop a child's routine for a few days, for example during a holiday or a temporary change in priorities, and have it come back on its own. We model this as a **Pause**: a period with a start and end date, both included, attached to one template in a child's assignment. During that period the template adds no activities to the child's checklist. The assignment itself doesn't change.

## Considered options

The alternative was a pair of scheduled assignment edits: remove the template effective on the start date and add it back after the end date. We rejected it for four reasons:

- The current model keeps only today's assignment and one next scheduled version. Planning ahead would need several future assignment versions.
- An assignment edit made during the holiday would fight with the scheduled re-add.
- The re-add would have to restore the template's original position in the order.
- The record would show "removed", not "paused for a holiday", so the reason would be lost.

## Rules

- A pause starts tomorrow at the earliest and never covers past dates, so past checklists can still be reconstructed.
- A pause must have an end date and can be at most 90 days long.
- Pauses for the same child and template can't overlap.
- A running pause can be ended or extended. The earliest new end date is today.
- Unassigning a template ends its pause from the unassignment's effective date and cancels pauses scheduled after it. Assigning the template again starts with no pause.
- Saving a pause advances the child's assignment revision, so pauses and assignment changes conflict the same way and can't race. A save that pauses several children or templates succeeds or fails as a whole.
- On a paused date, the template's activities aren't scheduled, so they're left out of the pending count and the activity review.
