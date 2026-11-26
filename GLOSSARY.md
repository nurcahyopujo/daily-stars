# Kids’ Points Tracker

A private household's record of children's daily activities and point changes.

## Language

**Child**:
A child profile whose activities and points parents track independently.

**Parent**:
An approved adult who can manage household routines and record or correct points.

**Template**:
A named, ordered set of one or more activities that can be shared by multiple children.

**Activity**:
A routine item with a reward, an optional penalty, and scheduled weekdays.

**Assignment**:
A child's dated selection of templates, including their display order.

**Pause**:
A period with a start and end date, both included, during which one template in a child's assignment adds no activities to that child's checklist. The template returns automatically after the end date. Its place in the assignment's order doesn't change. A pause can't start before tomorrow. It always has an end date: removing a template indefinitely is an assignment change, not a pause.
_Avoid_: suspension, skip

**Activity date**:
The household calendar date to which an activity outcome or one-off entry belongs, distinct from when a parent records or corrects it.

**Effective date**:
The first household calendar date on which a rule change applies. A scheduled rule change applies on the day after its acceptance date, which may differ from the date the parent pressed Save.

**Outcome**:
An activity's recorded result: done correctly, needs improvement, or unrecorded.

**One-off entry**:
An independent award or deduction for a child and activity date, with a required reason.

**Void**:
A final reversal of a one-off entry or redemption while preserving its history. Voiding a redemption returns its cost to the child's balance.

**Running total**:
The sum of a child's latest effective point contributions across all activity dates.

**Star**:
One point in a child’s score. Awards add stars and deductions subtract them.

**Balance**:
A child's running total minus the cost of redemptions still in effect. Later score corrections can bring the balance below zero.

**Prize**:
A household-wide reward that any child can redeem. It has a name, a cost in stars, and an optional store link and product image. A prize is either one-time or repeatable. Each child can redeem a one-time prize only once. Voiding that redemption lets the child redeem it again. Parents archive prizes rather than deleting them: an archived prize can't be redeemed but stays in history and can be restored.

**Redemption**:
A parent's record of a child spending stars. The parent either picks a *Prize* or names one and sets its cost on the spot. The redemption keeps its own copy of the name and cost, so later changes to the prize never alter it.

**Today's net**:
The sum of a child's latest effective point contributions for today's activity date.

**Pending count**:
The number of today's scheduled activities whose effective outcome is unrecorded.

**Pending save**:
An in-flight parent mutation tracked for recovery. It carries an idempotency action id and moves through saving, uncertain, rejected, conflict, and success. Memory only: it survives screen unmount and resume, never a reload. One pending save exists per key — a child create or edit, a template or assignment change, a day's activity outcome, or a redemption.

**Activity review**:
A parent's summary of one child's scheduled activity outcomes over a period, used to choose a routine to praise or practice.

**Save flow**:
The client module owning a single parent mutation's lifecycle over a *Pending save*: optimistic update, settle (success, rejected, conflict, or uncertain), reconcile to server truth, and recovery. It presents one derived phase to a screen so no screen re-implements the settle, lock, or retry handling.

**Idempotent mutation**:
The worker module owning a parent write's server contract: action-id receipt replay, optimistic-concurrency revision check, guarded retry, and the status outcomes a *Save flow* interprets (stale edit, unconfirmed save). Each write route supplies only its revision lookup and its storage write.
