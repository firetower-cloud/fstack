# The Skills library

A skill is "a folder of instructions an agent reads when it decides it is
relevant", and this screen is where they live. It is two lists under one
search box: **Yours**, which starts empty, and **From Firetower**, which
carries the skills shipped with the product — on by default, not deletable,
and switchable off for a single session in the composer. Opening one shows
its detail: who it is by, its version, when it changed, who it is shared
with, and its instructions rendered in full, with its files and its versions
behind their own tabs. Skills can also be added — a button beside the heading,
or by dropping a folder anywhere on the page.

## Sub-features

- **The two lists**, each with its own count, and a line saying what the
  group is.
- **Search**, by name or description.
- **A skill's detail** — the instructions as the agent reads them, plus
  `Files`, `Versions` and who can use it.
- **`Add a skill`**, and the drop target behind the sentence `Or drop a
  folder anywhere on this page`. Not driven — see `Gotchas`.
- **Sharing**, the `d/firetower` directory a built-in is shared in.

## How to get to it (user POV)

`Customize` in the destinations rail lands here: Skills is where that
destination opens. The panel beside it lists `Skills`, `Agent profiles` and
`Agents`, and the skills themselves appear under `Your skills` in that panel.

## Driving it with control-firetower

**Preconditions:** the baseline in `README.md`. A fresh install already has
the skills the server ships with, so nothing has to be seeded — and nothing
should be: `reset` drops and recreates the database rather than truncating
it, because a `TRUNCATE … CASCADE` reaches the skill tables and leaves the
library reading as empty in a way a restart does not repair. A run against
that would verify emptiness and report it as the product's behaviour.

| User action | Command | Observable result |
|---|---|---|
| Open the library | `control-firetower drive open skills --as skills-library --feature skills-library` | the level-1 heading `Skills`, the search box `Search by name or description`, and the two level-2 headings `Yours` and `From Firetower`, each with its count |
| Open one of them | `control-firetower drive act open-a-skill --feature skills-library` | the detail: a level-1 heading naming the skill, `by Firetower`, a version, when it was updated, the directory it is shared in, the tabs `Instructions`, `Files` and `Versions`, and the instructions themselves |
| Read the library back | `control-firetower api GET /skills` | the same skills, by name — which is the check that the list is the library rather than a cached shape |

Proof: the library, the detail, and the `/skills` readback. The accessibility
snapshot is the part that matters here: a row's accessible name carries the
skill's whole description, so the snapshot shows what an agent would read and
a screenshot shows only that something was listed.

## Gotchas

- **Do not write down how many skills ship.** The gesture matches a built-in
  by name (`skill-creator`, which the screen itself says cannot be deleted)
  rather than by position or by count, and the counts on screen are read
  rather than asserted. A number here is a measurement with a date, not a
  property of the product.
- **A row's accessible name is enormous.** It is the monogram, the name, the
  origin, the whole description and the directory. The handle therefore
  matches on a substring; an exact match fails on every row.
- **Dropping a folder is not drivable here.** The drop path exists because
  Tauri's own drag-drop handler is off, and it is one of the things a browser
  run cannot prove — the native file drop needs a human. `Add a skill` opens
  a dialog that is not driven either; the handle is on screen in the capture
  and the path behind it is not exercised.
- **The detail's `Files` tab reads content the server stores.** A reset that
  truncated rather than dropped would leave those rows gone while the skill
  still listed, which is the failure mode the reset note above exists for.
- **`Customize` is the rail's word for this.** The older label `Configuration`
  is gone from the rail; a harness that still looks for it finds nothing. The
  route under it is still `/configuration/skills`.
