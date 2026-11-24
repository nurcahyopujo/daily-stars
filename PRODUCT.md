# Daily Stars

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two approved parents in one private household use the app from their phones to manage their children's routines and record points. Both parents have the same permissions and share the same family data.

## Product Purpose

Daily Stars records each child's scheduled activity outcomes and one-off point changes. Parents can see a child's running total and daily breakdown, correct past entries, and understand who made a change. Success means both parents can record and review the same accurate history from their phones.

## Positioning

It is a private household record built around dated routines: changes to a routine take effect on the correct household date without rewriting earlier days.

## Operating Context

Parents use an English-language phone web app. The household calendar uses Asia/Jakarta dates. Parents sign in through Cloudflare Access with an approved email and one-time code. The app requires an internet connection.

## Capabilities and Constraints

- Each child has an independent profile and point history. Parents can share activity templates across children.
- Scheduled activities support rewards, optional penalties, weekdays, and dated rule changes. One-off awards and deductions require a reason.
- Parents can correct scores and one-off entries; history preserves earlier revisions and the acting parent.
- The MVP has no child accounts, public registration, push notifications, or offline entry.
- Parents keep a household prize list (name, star cost, one-time or repeatable, optional store link and image address) that they can search, filter, and sort. They redeem a prize from the list or by entering a label and star cost. Available balances account for spending, and voiding a redemption returns the stars.
- Family records remain out of browser storage. The app uses network-only data and keeps uncertain save recovery state in memory while the page remains open.
- The implementation follows the approved [MVP specification](mvp-spec.md) and [domain glossary](GLOSSARY.md). Current feature availability is tracked in the spec's milestones and the [README](README.md).

## Brand Commitments

The product name is Daily Stars. Existing interface copy is in English. No visual identity is established by this product record.

## Evidence on Hand

The [MVP specification](mvp-spec.md) records approved behavior and acceptance cases. Local fixtures use synthetic children and routines; they are not real family data or evidence of production use.

## Product Principles

- Preserve the history of what applied on each activity date.
- Keep each child's points and routines distinct, even when templates are shared.
- Make saved, conflicting, and uncertain changes clear to the parent.
- Keep access and family records private to the approved household.
