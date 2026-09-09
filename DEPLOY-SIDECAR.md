# Turning on the Balanced engine

Vercel runs JavaScript. OR-Tools is C++ with Python bindings, so it runs
somewhere else and the app talks to it over HTTPS.

This guide uses **Google Cloud Run**, which is free for a tool at this scale:
the container sleeps when nobody is planning, and you are not billed while it
sleeps. Waking takes a few seconds, which the app tolerates.

**Time:** about 15 minutes. **Cost:** nothing, within the free allowance.

No code changes — the app enables the engine when it sees `ORTOOLS_URL`.

---

## Step 1 — Get a Google Cloud account

Go to <https://console.cloud.google.com>. You will need a card on file even
though this stays inside the free allowance; Google uses it to verify you.

Create a project and note its **Project ID** (something like
`routeplan-472913` — not the display name).

## Step 2 — Install the command-line tool

```bash
brew install --cask google-cloud-sdk
gcloud auth login
```

Without Homebrew: <https://cloud.google.com/sdk/docs/install>

## Step 3 — Deploy

From the project folder, with your Project ID:

```bash
./sidecar/deploy-cloud-run.sh YOUR-PROJECT-ID
```

The first run takes a few minutes — it builds the container and uploads it.
When it finishes it prints two values. **Keep them.**

## Step 4 — Tell the app where it is

In Vercel → your project → **Settings → Environment Variables**, add the two
values the script printed:

| Name | Value |
|---|---|
| `ORTOOLS_URL` | the `https://...run.app` URL |
| `ORTOOLS_TOKEN` | the long random string |

Then **Deployments → ⋯ → Redeploy**. Environment variables are read at build
time, so an existing deployment will not pick them up.

## Step 5 — Check

```bash
curl https://your-app.vercel.app/api/health
```

You want `"ortools": true`. In the app, **Balanced** is now selectable and
**Compare engines** shows both.

---

## What the settings do, and why

The deploy script is tuned to stay free and to fail safely:

| Setting | Why |
|---|---|
| `--min-instances 0` | Sleeps when idle, so idle costs nothing. This is the whole reason it is free. |
| `--cpu 1 --memory 512Mi` | OR-Tools imports in under half a second and these problems are small. More costs more per second and solves no faster. |
| `--concurrency 2` | A solve pins a core. More requests on one instance make each slower rather than serving more. |
| `ORTOOLS_MAX_BUDGET_MS=5000` | Caps how long any single solve may run, whatever the app asks for. Bounds both your bill and the wait. |
| `ORTOOLS_TOKEN` | The service is reachable from the internet and spends CPU on any request. Without a token it is free compute for whoever finds it. |

**On waking up.** With `min-instances 0`, the first request after a quiet spell
waits for the container to start — 2–4 seconds, then the solve. Measured
locally, OR-Tools itself imports in 0.44s, so most of that is the platform.
If the wait bothers you, `--min-instances 1` removes it entirely and starts
costing a few dollars a month. That is the only real trade here.

## If it does not work

**`"ortools": false` after redeploying.** `ORTOOLS_URL` missing or empty. An
empty variable counts as unset.

**"rejected our credentials".** `ORTOOLS_TOKEN` differs between Cloud Run and
Vercel. Print the deployed one:

```bash
gcloud run services describe routeplan-solver --region europe-west1 \
  --format 'value(spec.template.spec.containers[0].env)'
```

**"took too long".** Two possible causes: the container was cold, or Vercel's
own function limit is shorter than the solve. Lower `ORTOOLS_MAX_BUDGET_MS`, or
set `--min-instances 1`.

**"Billing account not found."** A project needs a billing account attached
before Google will enable any service, free tier included. Link the one you
already have:

```bash
gcloud billing accounts list
gcloud billing projects link YOUR-PROJECT-ID --billing-account=THE-ACCOUNT-ID
```

**"the default service account is missing required IAM permissions."** On
projects created after mid-2024 Google no longer grants these automatically.
The deploy script now does it for you, but if you hit it by hand:

```bash
PROJECT_NUMBER=$(gcloud projects describe YOUR-PROJECT-ID --format='value(projectNumber)')
gcloud projects add-iam-policy-binding YOUR-PROJECT-ID \
  --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
  --role="roles/cloudbuild.builds.builder"
```

**"container failed to start"** in the Cloud Run logs. The service must listen
on the `PORT` Cloud Run injects — it does, but this is the first thing to check
if you change how it starts.

```bash
gcloud run services logs read routeplan-solver --region europe-west1 --limit 50
```

## Other hosts

Any host that runs a container works. Two requirements:

1. **It must listen on `$PORT`** — the sidecar already does.
2. **It must not sleep for ~50 seconds.** Free tiers that take that long to
   wake will time out on the first solve after a quiet period, which looks like
   a broken feature rather than a sleeping one.

`sidecar/fly.toml` is kept for Fly.io, which does not sleep but is not free.
[DEPLOY.md](DEPLOY.md) puts everything on one VM instead, which also gets you
self-hosted road distances and lifts the 99-stop cap.
