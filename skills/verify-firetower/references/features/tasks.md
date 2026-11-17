# Tasks

Tasks are the work a tracker already knows about — "starting one opens a
workspace on its repository with the task attached". On a Firetower with no
tracker connected, that is the whole screen: a heading, a sentence, and one
way forward reading **Connect your task tracker**, which goes to the place
where a tracker is connected. The empty state is the state every fresh
install is in, and it is the one this map drives: it is the screen a person
meets first, and the one a release is most likely to break without anybody
noticing.

## Sub-features

- **The screen with no tracker connected**, and its one action.
- **The sentence under it** — signing in once covers both a provider's code
  and its issues.
- **Mine / everyone**, the filter beside the list. Not driven — there is no
  list without a tracker.
- **A task's row, and starting one.** Not driven: it needs a connected
  tracker, which needs a real account on a real provider.

## How to get to it (user POV)

`Tasks` in the destinations rail, which lands on `/tasks`. The configuration
index also lists `Trackers` under **Work**, which is where the button here
goes.

**Driven by route** (`#/tasks`), not by pressing the rail: the rail's presence is in the snapshot, that pressing it navigates is not proved here.

## Driving it with control-firetower

**Preconditions:** the baseline in `README.md`, and **no tracker connected**,
which is what a fresh `up` gives. Nothing to seed.

| User action | Command | Observable result |
|---|---|---|
| Open Tasks | `control-firetower drive open tasks --feature tasks` | the level-1 heading `Tasks`, the sentence about the tracker knowing the work, and the level-2 heading `No tracker connected` |
| Follow the way out | `control-firetower drive act connect-your-task-tracker --feature tasks` | the button `Connect your task tracker` is pressed and the app lands on the level-1 heading `Trackers` |
| Read the state back | `control-firetower api GET /trackers` | every tracker the server knows about, each answering `connected: false` — so the screen and the server agree about *why* the list is empty |

Proof: the empty state, the screen it leads to, and the `/trackers` readback.

## Gotchas

- **An empty list and a failed request look identical on screen**, and the
  app knows it: this screen draws its empty state only when nothing is in
  trouble, because "an onboarding screen is for an install with nothing in
  it, not for an install we cannot see". The readback is what tells the two
  apart from outside, so do not skip it.
- **`No tracker connected` is drawn in more than one place on this screen** —
  the list has two faces depending on which filter is up, and both carry the
  same heading and the same button. A capture proves the one that was on
  screen; it does not prove the other.
- **Connecting a tracker is not drivable here.** It needs an OAuth
  application and a real account on a provider, which an isolated run cannot
  supply. **That precondition cannot be met, so the journey beyond this
  button is reported as unreachable rather than approximated** — and
  everything past it (a task list, starting a task, the workspace it opens)
  is out of this map's reach for the same reason.
- **The word `Connect` is alive here.** `Connect your task tracker` is a real
  current handle, which is why "the connect screen's button was renamed to
  Continue" must never be applied as a global substitution: this button, the
  git host one and the account one all still say Connect.
- **Tasks is a destination, not a configuration pane**, so it is at `/tasks`
  rather than under `/configuration`. The tracker pane it sends you to is the
  other way round.
