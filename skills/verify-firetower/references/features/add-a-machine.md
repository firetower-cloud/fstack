# Compute → Add a machine

Nothing in Firetower can run until there is a machine to run it on, and the
machines screen says so: an empty fleet is one sentence and one button. **Add
a machine** opens a dialog asking for an address, an ssh account and a name,
and showing the public key this Firetower will connect with. Pressing
**Add it** makes the control plane open an ssh connection to the address that
was typed — the probe — and the dialog turns into whatever it found. The
ordinary answer on a bare machine is "connected, and there is no worker on
it yet", with an offer to put one there over the same connection. Afterwards
the machine's row carries its vCPU count, its memory and the worker's
version, and the fleet stops being empty. This is the map's Tier B entry —
the one whose subject *is* a machine, and the one that supplies the machine
the repositories entry then borrows, since the probe behind a pasted remote
is answered by a machine rather than by the control plane.

## Sub-features

- **The empty fleet**, and the sentence that says nothing can run yet.
- **The dialog**: address, ssh account, name, and the key to authorise.
- **The probe**, and the diagnoses it comes back with — a refused key, a
  changed host key, a reachable machine with no worker.
- **Installing the worker**, over the connection that was just made.
- **Readiness**, which is not the same question as being online.
- **The machine's row**, carrying what the worker reported.
- **Draining, renaming, removing.** Not driven.

## How to get to it (user POV)

`Machines` in the destinations rail — one of the buttons in the navigation
landmark called `Destinations`; the configuration index lists the same pane
under **Compute**. Both land on `/configuration/machines`. The `Add a machine`
button is beside the heading once there is a fleet, and inside the empty state
before that.

## Driving it with control-firetower

**Preconditions:** the baseline in `README.md`, plus an ssh endpoint this run
started. firetower#332 established that an Alpine sshd container is one — "a
reachable ssh endpoint with the right key is genuinely all it asks" — and
that the developer's own Mac never has to be touched.

```sh
# 1. the key this Firetower will connect with. Needs the gates open: every
#    authenticated route answers 403 until the forced password change is cleared
control-firetower api GET /ssh-key --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["body"]["publicKey"])' > sshbox/authorized_keys

# 2. the machine. `adduser -D` leaves the account password-LOCKED and sshd
#    refuses it even for key auth, so `*` is set instead of `!`
cat > sshbox/Dockerfile <<'EOF'
FROM alpine:3.21
RUN apk add --no-cache openssh-server git tmux curl tar ca-certificates
RUN adduser -D -s /bin/sh editor && mkdir -p /home/editor/.ssh && chmod 700 /home/editor/.ssh
COPY authorized_keys /home/editor/.ssh/authorized_keys
RUN sed -i 's/^editor:!/editor:*/' /etc/shadow \
 && chmod 600 /home/editor/.ssh/authorized_keys && chown -R editor:editor /home/editor/.ssh \
 && ssh-keygen -A \
 && sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config \
 && sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
CMD ["/usr/sbin/sshd","-D","-e"]
EOF
docker build -t ft-sshbox-$FIRETOWER_SESSION sshbox
docker run -d --name ft-machine-$FIRETOWER_SESSION \
  --label com.firetower.session=$FIRETOWER_SESSION -p 127.0.0.1:<free port>:22 ft-sshbox-$FIRETOWER_SESSION
```

The label is what the session's teardown reaps, and it is also what
`control-firetower` checks before it will press the probe: an address it
cannot see as a container of this run's is refused.

| User action | Command | Observable result |
|---|---|---|
| See a fleet with nothing in it | `control-firetower drive act start-something-new --feature add-a-machine` | the composer's start button is present, disabled, and reads `Add a machine first` |
| Open the dialog and type an address | `control-firetower drive act add-a-machine` | the level-2 heading `Add a machine`, the field, and `Add it` present and unpressed — this one stops before the probe |
| Add the machine this run started | `control-firetower drive act add-this-runs-machine --at editor@127.0.0.1:<port> --feature add-a-machine` | the dialog's second stage: `Connected to <name> as editor.`, `There is no worker on it yet.`, and `Install the worker`. That stage is only drawn when ssh **got in**, which is what makes it proof rather than a pressed button |
| Install the worker | `control-firetower api POST /hosts/<id>/worker` | `{"version":"firetower-worker 0.55.0"}` — measured at 2.9s on 2026-11-17 |
| See the machine as a person sees it | `control-firetower drive open machines --as machine-online --feature add-a-machine` | the row reads `<name> 12 vCPU · 0 GB · worker 0.55.0 … ready` |
| Ask whether a session could actually run there | `control-firetower api GET /hosts/<id>/readiness` | five checks, every `required` one `available`: worker, git, tmux, shell, worker state directory |

Proof: the dialog's second stage, the machines screen afterwards, and the
readiness answer — not `state: "Online"` on its own.

## Gotchas

- **Two traps cost firetower#332's run real time, and both are still here.**
  Alpine's `adduser -D` leaves the account password-locked, and sshd refuses
  a locked account even for key auth — while the diagnosis says
  `127.0.0.1 refused the key`, which sends you to inspect a key that is
  byte-identical on both sides. `docker logs` is what actually says it:
  *"User editor not allowed because account is locked"*. And `ssh-keygen -A`
  runs at build time, so **rebuilding the image changes the host key** and
  the next probe fails with `HostKeyChanged`.
- **The control plane's own ssh key rotates when the database is dropped**,
  so every `control-firetower reset` leaves the container's
  `authorized_keys` stale. Measured 2026-11-17: the key before and after a
  reset differ. Push the new one in with
  `docker exec` rather than rebuilding the image — a rebuild trips the host
  key trap above. The reset also removes `$FIRETOWER_HOME/ssh/known_hosts`,
  which is the other half of the same cleanup.
- **`state: "Online"` does not mean a session can run there.** A machine with
  no git and no tmux is `Online` with `diagnosis: null`, because online means
  "the worker answered". Read `/readiness` and assert every required check is
  `available`; trusting the state would start a session on a machine that
  cannot clone.
- **A worker built on macOS cannot be installed on a Linux machine.**
  `just build-worker` derives its target from `uname`, so
  `FIRETOWER_WORKER_ARTIFACTS` never matches a Linux container and the
  install **silently downloads a release instead** — a run would verify the
  released worker while believing it verified the branch. Assert which path
  was taken before claiming a worker change was tested. On 2026-11-17 this
  run's install took the download path, and it only worked because the
  checkout's version matched a published release; between releases it fails.
- **The row says `0 GB`.** The worker reports no disk and no memory inside
  this container, which is a property of the container rather than a bug in
  the screen. Expect it, and do not assert memory here.
- **Adding the same machine twice is refused**, so this journey is one-shot
  per machine per instance. `drive audit` checks the fleet before driving it
  and reports it as not re-checkable rather than failing.
- **`Install the worker` is asserted, not pressed.** The button only exists
  inside the dialog that the add just produced, and a gesture starts from a
  fresh page. The install is performed over the API in the recipe above and
  the machines screen is then captured — so what is driven is the dialog and
  the probe, and what is read back is the machine.
- **Never press `Add it` at an address this run did not start.** It makes the
  control plane open an ssh connection to whatever is in the field. The CLI
  refuses anything `docker ps` does not show as a container carrying this
  session's label, and the gesture that types `10.4.0.22` — copied from the
  mock harness, where a fake server answers — deliberately stops before the
  button.
