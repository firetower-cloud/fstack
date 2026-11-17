# Sign in as the first administrator

Once an address has turned into a server, the app asks *Who are you here?* —
a username, a password, and a button that says `Sign in`. The first
administrator exists before the control plane answers its first request, so
there is no sign-up: somebody always owns a fresh Firetower. A correct
password lands on the app's home; a wrong one says so under the field it was
typed in, and says it without claiming the account does not exist. A password
that was set by somebody else lands somewhere else again — that is
`forced-password-change.md`.

## Sub-features

- **The form**, with the found server's card still above it, so you can see
  which Firetower you are about to hand a password to.
- **Signing in**, which remembers the server on this Mac and opens the app.
- **A wrong password**, reported under the field rather than as a page error.
  Not driven — see `Gotchas`.
- **Forgotten it?** — one line pointing at an administrator, because this app
  cannot reset a password.
- **The way out**, the card's × , back to the address screen.

## How to get to it (user POV)

Type an address on the first screen and press `Continue`. From inside the
app, the same form is reached by signing out under the avatar, or by
connecting a second Firetower from the switcher.

## Driving it with control-firetower

**Preconditions:** the baseline in `README.md`, including `up` having cleared
the forced password change at its step 4. This run's administrator password
lives only in the run lock; it is generated per run and is never derived, so
a command that cannot read it refuses rather than guessing.

| User action | Command | Observable result |
|---|---|---|
| Type the address, then the username and password, and press `Sign in` | `control-firetower drive signin --as sign-in --feature sign-in` | the app's home: the level-1 heading ending `what should we work on?`, the destinations rail, and the workspaces panel saying `Nothing running yet` |
| Confirm the account that was signed in | `control-firetower api GET /auth/me` | `admin`, with the organisation this run named |
| Confirm it was not a gate that opened | the same `drive signin` run | it asserts both first-run screens are absent before it captures, and fails with the gate named if either is on screen |

Proof: the `sign-in` capture, its accessibility snapshot, and the `/auth/me`
readback.

## Gotchas

- **Signing in is the only part of this that is cheap to get wrong.** The
  handles are `Username`, `Password` (exactly — there is a second field whose
  placeholder begins with the same word on other screens) and the button
  `Sign in`. All five of the sign-in handles are driven by `drive audit`,
  which uses them rather than merely looking for them: if one is wrong,
  nothing after it runs, and that is the report.
- **`Gate.tsx` draws the app while its own queries are still in flight.** A
  run that reads the screen to decide which gate it is on skips one about one
  time in four. Ask the server — `api GET /setup` — or wait on an observable
  end state. Never a fixed sleep.
- **A successful sign-in has a side effect in the browser**: the server is
  remembered in `localStorage`, so the address screen does not come back in
  that context. This is why each first-run journey gets a context of its own.
- **A wrong password is not driven.** Typing one would be typing a credential
  this run invented into a real sign-in form, and the failure message is a
  claim about rate limiting and lockout that this transport cannot establish
  from one attempt. The handle for the message is not in the vocabulary.
- **`drive signin` is not a lighter `up`.** It signs in through the screens;
  it does not create anything. An instance that has not had `up`'s steps 4
  and 6 will land on a gate, and the command will say which one.
