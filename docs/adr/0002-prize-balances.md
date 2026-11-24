# Track prize redemptions separately from activity scores

Parents redeem a prize by entering its name and a positive whole-number star cost for one child. Existing running totals are available immediately. The available balance is the running total minus active redemption costs.

Keep each redemption and its final void in a dedicated record. This preserves earned activity totals and daily summaries while allowing spending to be reversed with its history retained. Using ordinary one-off deductions would mix prize spending into activity reviews and daily results.

A redemption must fit the available balance when the database accepts the write. The balance guard and debit share one SQL write, protecting against concurrent spending. Each redemption has a stable client-generated ID so an uncertain retry recovers the original spend. Voiding a redemption restores its cost once. Later corrections to activity scores can make the balance negative, and future earnings cover that balance.

The first version uses a parent-entered prize label and cost at redemption time. A parent confirms spending with the Redeem button after seeing the resulting balance. These decisions were agreed in the points and prizes design interview.

Superseded in part by ADR 0005: parents can also pick a prize from the household catalog, which locks the cost to the catalog cost.
