# Store child balances and running totals

Persist each child's balance and running total in a database row, as requested in the parent discussion. Backfill existing rows from score history and redemptions once during migration, then apply score revision deltas, redemption debits, and void credits through database triggers in the same transaction as their source changes.

This adds derived state that must stay consistent with history. Keeping updates inside the database covers the existing scoring and redemption write paths, including retries and concurrent writes, while profile and balance reads fetch stored values. Daily activity summaries continue to use their selected activity date.
