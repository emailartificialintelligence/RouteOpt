# Deploying RoutePlan to Vercel

The quick path. About 10 minutes, no servers to manage.

Read the trade-offs at the bottom before you rely on it — two of them matter.

---

## Step 1 — Put the code on GitHub

If it is not there already:

```bash
cd /Users/saurabh/Downloads/Studio/RouteOpt
git init
git add .
git commit -m "RoutePlan"
```

Create an empty repository on GitHub, then:

```bash
git remote add origin https://github.com/YOUR-USERNAME/routeplan.git
git branch -M main
git push -u origin main
```

## Step 2 — Import it into Vercel

1. Go to <https://vercel.com/new>
2. Choose your `routeplan` repository
3. Leave every build setting alone — Vercel detects Next.js correctly
4. **Do not click Deploy yet.** Open **Environment Variables** first.

## Step 3 — Add three environment variables

Still on the import screen, add these:

| Name | Value |
|---|---|
| `GEOCODER_PROVIDER` | `photon` |
| `GEOCODER_USER_AGENT` | `RoutePlan/1.0 (your-email@example.com)` |
| `TRUST_PROXY` | `true` |

All three matter:

- **`GEOCODER_PROVIDER=photon`** is not optional here. Nominatim requires one
  second between lookups, so ten addresses take eleven seconds — longer than
  Vercel's free plan allows a function to run, and the request is killed.
  Photon needs no such gap and does the same ten in about a second.
- **`GEOCODER_USER_AGENT`** must be a real address or URL. Geocoders refuse
  unattributed requests outright.
- **`TRUST_PROXY=true`** lets rate limiting see the real client IP. It is only
  safe because Vercel always sits in front.

Now click **Deploy**.

## Step 4 — Check it

Open the URL Vercel gives you, then:

```
https://your-app.vercel.app/api/health
```

You should see:

```json
{ "status": "ok", "maxStops": 99, "geocoder": "photon",
  "routing": "default (public demo)",
  "engines": { "greedy": true, "ortools": false } }
```

`"geocoder": "photon"` confirms step 3 took effect. `"ortools": false` is
expected — see below.

Then try a real plan: set a depot, paste a few addresses, click **Plan routes**.

---

## What you give up, and what to do about it

### The Balanced engine is off

Vercel runs JavaScript functions, not long-lived Python processes, so the
OR-Tools sidecar cannot live there. The selector shows **Balanced** as needing
a sidecar, and planning uses **Fast**. Nothing breaks.

Fast is genuinely good — 66% shorter than list order on the 40-stop test. On
that same test OR-Tools found a route about 16% shorter still, taking five
seconds instead of seven milliseconds.

**To get it back later:** run the sidecar anywhere with a public URL (a $5 VM,
Fly.io, Railway) and add one environment variable in Vercel:

```
ORTOOLS_URL=https://your-sidecar-host
```

The app picks it up and enables the engine. No code change.

### Road distances come from a public demo server

This is the one I would keep an eye on. `router.project-osrm.org` is a
demonstration service, explicitly not intended for production use. It is
rate-limited and can refuse requests under load.

When it does, the app **does not fail** — it falls back to straight-line
distances and tells the user the numbers are approximate. That is a deliberate
design choice, and it is still a degraded plan: straight lines ignore rivers,
one-way systems and motorways, so they are wrong in every city.

It also caps you at **99 stops**, because its distance tables take 100
coordinates and the depot uses one.

If real drivers start depending on this, self-host OSRM — that is what
[DEPLOY.md](DEPLOY.md) sets up, and it also lifts the stop limit.

### Rate limiting becomes best-effort

The built-in limiter keeps its counts in memory. On Vercel each cold function
starts empty, so it will stop a naive script hammering one warm instance but
not a distributed one.

If the app is public and you care, turn on Vercel's own firewall rate limiting
in the project dashboard — that runs at the edge, before your code, and is the
real boundary.

---

## Deploying changes

Push to `main`. Vercel rebuilds and deploys automatically.

```bash
git add . && git commit -m "your change" && git push
```

## If something is wrong

**Build fails.** Read the Vercel build log — it is the same `npm run build`
that works locally, so it is almost always a missing environment variable.

**Addresses will not resolve.** `GEOCODER_USER_AGENT` is missing or still a
placeholder.

**Address lookups time out.** `GEOCODER_PROVIDER` is not set to `photon`, so
each batch is taking eleven seconds.

**Distances are marked approximate.** The public OSRM server refused the
request. Wait and retry, or self-host.
