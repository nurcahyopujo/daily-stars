# Issue tracker: GitHub

Issues and specs live in nurcahyopujo/daily-stars on GitHub.
Use the gh CLI from this repo.

## Conventions

- Before creating issues, verify the target with
  `gh repo view --json nameWithOwner`.
- Create: `gh issue create --title "..." --body-file <file>`.
  Write multiline bodies to a temporary file first.
- Read: `gh issue view <number> --json number,title,body,labels,comments`.
- List: `gh issue list --state open --json number,title,body,labels`.
  Add label and state filters as needed.
- Comment: `gh issue comment <number> --body-file <file>`.
- Labels: `gh issue edit <number> --add-label "..."` or
  `--remove-label "..."`. Use docs/agents/triage-labels.md.
- Close: post the explanation as a comment, then run
  `gh issue close <number>`.

Use native GitHub sub-issues and blocking dependencies when supported
by the installed CLI and repository. Consult gh help for syntax.
Otherwise, put `Part of #<parent>` and `Blocked by: #<number>`
at the top of child issue bodies, and list children in the parent.
A ticket is startable when all blockers are closed.

## Pull requests as a triage surface

**PRs as a request surface: no.**

## Skill operations

"Publish to the issue tracker" means create a GitHub issue.
"Fetch the relevant ticket" means read the GitHub issue.

## Wayfinding

A map is one issue labelled wayfinder:map. Its child issues use
wayfinder:research, wayfinder:prototype, wayfinder:grilling, or
wayfinder:task. Create these labels when needed.

Choose the first open child in map order with no open blocker or
assignee. Claim it with `gh issue edit <number> --add-assignee @me`.
Resolve by commenting with the answer, closing the child, and adding
the result and link to the map's Decisions-so-far.
