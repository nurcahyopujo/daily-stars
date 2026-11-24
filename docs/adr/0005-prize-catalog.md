# Keep a household prize catalog with copied redemptions and remote images

Parents keep a household-wide catalog of prizes. Each prize has a name, a star cost, a one-time or repeatable flag, an optional store link, and an optional image URL. When redeeming, a parent either picks a catalog prize, which locks the cost to the catalog cost, or enters a name and cost on the spot as before. This supersedes the last paragraph of ADR 0002.

A redemption keeps its own copy of the prize name and cost, plus an optional reference to the prize. Editing or archiving a prize never changes past redemptions, balances, or the balance triggers from ADR 0003. Prizes are archived, never deleted, so the references stay valid and the one-time rule can still be checked.

Each child can redeem a one-time prize only once. A sibling can still redeem it, and voiding the redemption lets that child redeem it again. The check counts the child's redemptions of that prize that are still in effect, so a prize that switches from repeatable to one-time counts any existing redemption.

Images are stored only as remote URLs and load directly from the store's image server, with no referrer and a placeholder if loading fails. Shopee pages are built in the browser and its item API rejects requests without its own signed headers, so an automatic image lookup is best-effort. Pasting an image URL by hand always works. We chose this over storing image files, which would add storage and copy store images into the app, and over fetching the image on every view, which is slow and breaks whenever Shopee blocks the request.
