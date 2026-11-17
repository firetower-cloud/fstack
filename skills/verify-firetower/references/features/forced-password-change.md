# The forced password change

A password somebody else chose cannot become the permanent one. The first
administrator's password comes out of a file or is invented at first start,
and the account is created carrying a flag that says so — so signing in with
it does not open the app. The desktop stops at a screen headed **Replace this
password**, explains that the password was set by an administrator who has
seen it, and offers two things: `Open <address>`, which leaves for the
control plane's own interface in a browser, and `Sign in again`, for when
you have come back. The app deliberately carries no password form of its own.
Until the flag is cleared, every authenticated route answers 403 — a token
alone is not a usable session.

## Sub-features

- **Being stopped at the door.** Signing in with a temporary password lands
  here instead of on the app.
- **Being told why**, in the person's own terms: an administrator set it and
  has seen it.
- **The way to change it** — `Open <address>`, which opens the control plane
  in the system browser.
- **`Sign in again`**, which returns to the sign-in form rather than
  reloading or guessing.
- **`Use a different address`**, back to the first screen.
- **The same flag, years later.** An administrator resetting somebody's
  password raises it mid-session, and the app draws a different screen for
  that case. Not driven — see `Gotchas`.

## How to get to it (user POV)

Sign in as an account whose password was set by somebody else: the first
administrator of a fresh Firetower, or anybody an administrator has just
reset. There is no other way in, and no menu item that leads here.

## Driving it with control-firetower

**Preconditions:** an instance with its gates still standing —
`control-firetower up --first-run`, or `reset --first-run` on a run that is
already up (2.7s, measured 2026-11-17). That mode does the first three steps
of `up`, seeds the administrator through `ADMIN_INITIAL_PASSWORD` so the
account still carries the flag, takes one token and stops. **A prepared
instance cannot show this screen**: `up`'s step 4 exists to clear it.

| User action | Command | Observable result |
|---|---|---|
| Make an instance that has never been through this | `control-firetower reset --first-run` | `phase claimed`, and a line saying both gates stand |
| Sign in with the temporary password | `control-firetower drive act replace-the-temporary-password --feature forced-password-change` | the journey asserts the level-1 heading `Replace this password` and the button `Sign in again`, and photographs that screen on the way through |
| Choose a new password where the panel sends you | the same command performs it as `POST /api/v1/auth/password` and says so on the capture and in the posted comment | **this step is not driven through the app** — see `Gotchas` |
| Press `Sign in again` and sign in with the new one | the same command | the next gate: the level-1 heading `Name this Firetower`. Reaching it is the proof, because that screen can only be drawn once the password flag is clear and setup is not finished |
| Read the side effect back | included in the capture as `GET /setup` | `needsPassword: false`, with `needsOrganization: true` still |

Proof: two screenshots from one journey — `Replace this password` on the way
through, and the screen it ended on — plus the `/setup` readback and the
sentence naming the step that was done off-stage.

## Gotchas

- **One step of this journey is not driven through the app, and the proof
  says so.** The desktop does not carry a password form on purpose: replacing
  a password happens on the control plane's web interface, which this
  effort put out of scope. The journey performs that step over the API,
  records what it did and why on the capture, and the posted comment prints
  it as **Not driven through the app**. Pretending otherwise would report the
  web interface as verified; skipping the journey would leave this gate
  exercised by nothing, which is where firetower#336 started.
- **Each journey is one-shot.** Driving it clears the gate it is about, so
  the second run against the same instance lands on the setup wizard and
  reports that its precondition was not met — which is the journey working,
  not failing. `reset --first-run` makes another instance.
- **There are two of these screens, with different headings.** The one this
  file drives is reached at the door and is headed `Replace this password`.
  The other is drawn when an administrator resets a password under a running
  app; it is headed **`Your password has to be replaced`** and offers
  `I've replaced it`. **Not driven, and therefore not in the vocabulary**: it
  needs a remembered server whose account is locked mid-session, which is a
  second account and a second browser context. A run that knows only one of
  these headings will report the other as an application bug.
- **`Open <address>` leaves the app through a native module.** In Chrome that
  is a different gesture from the one Tauri performs, and a passing click
  here proves nothing about whether a browser actually opened. The button is
  asserted present; it is not pressed.
- **Everything 403s until this is cleared** — including `GET /ssh-key`, which
  is how a machine's authorised key is fetched. A sweep that wants a machine
  has to open this gate first.
- **Do not read the screen to decide which gate you are on.** `Gate.tsx`
  draws the app while its own queries are in flight, so about one time in
  four a run that looks first sees the wrong thing. Ask `api GET /setup`.
