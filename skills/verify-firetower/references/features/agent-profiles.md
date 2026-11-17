# Agent profiles

A profile is a saved way of working — "one with a team leads, one without is a
worker". The screen lists the profiles this Firetower has, says plainly that
every workspace can run without one, and offers to make one in two ways:
describe it and have an agent write it, or fill in the form by hand. A draft
opens under its own name, which starts as `New profile` and becomes whatever
is typed. It answers to three words, all of them current, and they belong to
three different surfaces:

| where | word | |
|---|---|---|
| the route, and the API | `roles` | `/configuration/roles` |
| the rail panel | **Agent profiles** | `desktop/src/ui/RailPanel.tsx:497` |
| the screen's own heading | **Agent profiles** | `desktop/src/ui/config/Roles.tsx:283` |
| the configuration index | **Profiles** | `desktop/src/ui/config/panes.ts:50` |

**Agent profiles** is the one this map drives, because it is the one on
screen and the one in the rail. **Profiles** is the configuration index's
word — a surface this recipe never drives, so do not expect it in a capture.
This file used to attribute `Profiles` to the rail panel, which contradicted
its own `How to get to it` two paragraphs below.

## Sub-features

- **The list**, and the empty state that says a profile is optional.
- **`New profile`**, which opens a menu rather than a form.
- **`Create with AI`** — describe it, an agent writes it. Not driven.
- **`Write it myself`**, which opens the draft.
- **A profile's detail**, its engine, its skills and who it is shared with.
  Not driven — there is no profile on a fresh install to open.

## How to get to it (user POV)

`Customize` in the destinations rail, then `Agent profiles` in the panel
beside it. Customize itself lands on Skills.

**What the capture actually shows**: the panel, headed `Customize` and
carrying `Skills`, `Agent profiles` and `Agents`. This file used to say that
path was "driven, and visible in the capture", which overstated it — the
panel being *present* is proved, and pressing `Agent profiles` to navigate is
not.

**Driven by route** (`#/configuration/roles`), not by pressing the rail: the rail's presence is in the snapshot, that pressing it navigates is not proved here.

## Driving it with control-firetower

**Preconditions:** the baseline in `README.md`. No profile has to exist — the
empty state is part of what this verifies — and nothing here needs a machine.

| User action | Command | Observable result |
|---|---|---|
| Go to Agent profiles | `control-firetower drive open profiles --feature agent-profiles` | the level-1 heading `Agent profiles`, the sentence about teams and workers, and on a fresh install `No profiles yet` |
| Press `New profile` | `control-firetower drive act start-a-new-profile --feature agent-profiles` | a menu, not a form: `Create with AI` and `Write it myself`, both `role="menuitem"` |
| Choose `Write it myself` | the same command | the draft, under the level-1 heading `New profile` |
| Read the library back | `control-firetower api GET /roles` | still empty — the draft is not saved until it is saved, which is the right answer and worth showing |

Proof: the empty screen, the menu, and the draft, with the `/roles` readback
confirming nothing was created by opening a form. **All four are in the
capture**: the menu is photographed alongside the draft because the gesture
asserts it, and the readback is embedded rather than left for the operator to
run by hand. Both of those used to be promised here and missing — a gesture's
`expect` photographed nothing, and only the first-run journeys embedded a
readback.

## Gotchas

- **The route's word is not the screen's word.** `/configuration/roles` is
  recorded in this bundle as a route that is not the screen its name
  suggests, *and* driven as a state whose landmark is `Agent profiles` — the
  two are checked against each other by a test, so the entry can never
  quietly claim the route renders "Roles". The API still says role, which is
  why the readback above is `GET /roles`.
- **`New profile` opens a menu.** Driving it is what established that: the
  first version of this entry expected the draft's heading and the draft was
  two clicks away. The menu's rows are `role="menuitem"`, not buttons, and
  their accessible names carry their subtitles — so they match on a
  substring.
- **`Create with AI` is not driven.** It starts an agent, which is Tier C —
  the layer this transport stubs nothing for and proves nothing about. The
  handle is asserted present by the gesture above; the path behind it is not
  exercised.
- **The draft is reachable and the list is not populated by driving it.** A
  sweep leaves an unsaved draft behind, which the next navigation discards.
  Nothing has to be cleaned up, and nothing was created.
- **A profile's detail has nothing to show on a fresh install**, so it is
  absent from the vocabulary rather than guessed at from the source. If a
  sweep needs one, create it over the API first and say in the proof that the
  precondition was seeded rather than driven.
