# Adding the Balanced engine to a Vercel deployment

Vercel runs JavaScript functions, not long-lived Python processes, so the
OR-Tools engine cannot live there. It runs as a small service somewhere else,
and the app talks to it over HTTPS.

**Time:** about 15 minutes. **Cost:** a few dollars a month.

The app needs no code change — it enables the engine when it sees `ORTOOLS_URL`.

---

## Step 1 — Install the Fly CLI

```bash
curl -L https://fly.io/install.sh | sh
fly auth signup      # or: fly auth login
```

## Step 2 — Create the app

```bash
cd /Users/saurabh/Downloads/Studio/RouteOpt/sidecar
fly launch --no-deploy
```

It will ask a few questions. Accept the detected Dockerfile, pick a region near
your Vercel one, and **say no** to databases and to deploying now.

## Step 3 — Set a shared secret

This service does real CPU work on any request it receives, and on Fly it is on
the public internet. Without a token, anyone who finds the URL can spend your
CPU.

```bash
fly secrets set ORTOOLS_TOKEN="$(openssl rand -hex 32)"
```

Print it — you need the same value in Vercel:

```bash
fly ssh console -C "printenv ORTOOLS_TOKEN"
```

Or generate it yourself first and paste the same string into both places.

## Step 4 — Deploy

```bash
fly deploy
```

Then check it is alive:

```bash
curl https://your-app-name.fly.dev/health
```

```json
{ "status": "ok", "engine": "ortools" }
```

## Step 5 — Point the app at it

In Vercel → your project → **Settings → Environment Variables**, add two:

| Name | Value |
|---|---|
| `ORTOOLS_URL` | `https://your-app-name.fly.dev` |
| `ORTOOLS_TOKEN` | the same secret from step 3 |

Then **Deployments → ⋯ → Redeploy**. Environment variables are read at build
time, so an existing deployment will not pick them up.

## Step 6 — Confirm

```bash
curl https://your-vercel-app.vercel.app/api/health
```

You want `"ortools": true`. In the app, **Balanced** is now selectable and
**Compare engines** shows both.

---

## What you should expect

On a 40-stop, 3-van test with real road distances:

| Engine | Total | Longest route | Time |
|---|---|---|---|
| Fast | 90.0 km | 32.1 km | 7 ms |
| Balanced | 76.0 km | — (one van) | 5 s |
| Balanced (even workload) | 90.6 km | 30.3 km | 5 s |

Balanced finds materially shorter routes and takes about a thousand times
longer. Fast stays the default; Balanced is there for when the plan matters
more than the wait.

## If it does not work

**`"ortools": false` after redeploying.** `ORTOOLS_URL` is missing or empty. An
empty variable counts as unset.

**"rejected our credentials".** `ORTOOLS_TOKEN` differs between Fly and Vercel.

**"took too long".** The machine cold-started. Check `min_machines_running = 1`
in `fly.toml` — a stopped machine has to boot OR-Tools before it can solve, and
that overruns the app's budget.

**"isn't responding".** `fly logs` will say why; `fly status` shows whether the
machine is up.

## Cheaper and other options

Any host that runs a container works — Railway, Render, a $5 VM. Two
requirements:

1. **It must not sleep.** Free tiers that spin down after inactivity will cold
   start into a timeout on the first solve after a quiet period.
2. **It must be HTTPS**, or browsers will block the call from an HTTPS app.

If you would rather not run a second service at all, [DEPLOY.md](DEPLOY.md)
puts everything on one VM instead.
