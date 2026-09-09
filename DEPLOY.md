# Deploying RoutePlan to a virtual machine

Everything runs on one machine with Docker: the app, the OR-Tools engine, your
own road-routing server, and a reverse proxy that handles HTTPS for you.

**Time:** about 30 minutes, plus however long the map data takes to process.

---

## What you need first

- A virtual machine running Ubuntu. **4 GB RAM minimum**, 8 GB if you route
  anything bigger than a city. DigitalOcean, Hetzner and AWS Lightsail all work.
- A domain name (e.g. `routes.yourcompany.com`) with a DNS **A record** pointing
  at the machine's IP address. Set this up first — the certificate step needs it.
- Ports **80** and **443** open.

---

## Step 1 — Install Docker

SSH into the machine, then:

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER
```

Log out and back in (so the group change takes effect), then check it worked:

```bash
docker run --rm hello-world
```

## Step 2 — Get the code

```bash
git clone <your-repo-url> routeplan
cd routeplan
```

## Step 3 — Write your settings

```bash
cp .env.production.example .env
nano .env
```

Three lines must be right:

| Setting | What to put |
|---|---|
| `DOMAIN` | your domain, e.g. `routes.yourcompany.com` |
| `GEOCODER_USER_AGENT` | a real email or project URL — address lookups are **refused** without one |
| `OSRM_REGION` | leave for now; step 4 prints the value |

Save with `Ctrl+O`, `Enter`, then `Ctrl+X`.

## Step 4 — Prepare the map data

This downloads your region and builds a routing graph. **Start small** — use
Monaco to prove the setup works, then redo this with your real region.

```bash
./scripts/prepare-osrm.sh https://download.geofabrik.de/europe/monaco-latest.osm.pbf
```

Find your own region at <https://download.geofabrik.de>. Take the smallest
extract that covers your delivery area.

| Region | Download | Processing | RAM needed |
|---|---|---|---|
| Monaco | 2 MB | seconds | 100 MB |
| Île-de-France | 400 MB | ~10 min | 4 GB |
| France | 4 GB | 1–2 hours | 16 GB |

Preprocessing needs roughly **ten times the extract size in RAM**. If the
machine is too small, run this on a bigger one and copy the `osrm-data` folder
across — the result is portable.

When it finishes it prints a line like `OSRM_REGION=monaco-latest`. Put that in
your `.env`.

## Step 5 — Start everything

```bash
docker compose up -d --build
```

The first build takes a few minutes. Then check all four services are healthy:

```bash
docker compose ps
```

You want `running (healthy)` next to each. If something says `starting`, wait
30 seconds and look again — OSRM takes a minute to load its graph.

## Step 6 — Open it

Go to **https://your-domain**. The certificate is issued automatically on the
first request, so the very first load can take a few seconds.

Check the app agrees with itself:

```bash
curl https://your-domain/api/health
```

```json
{ "status": "ok", "maxStops": 99, "geocoder": "photon",
  "routing": "configured", "engines": { "greedy": true, "ortools": true } }
```

`"ortools": true` means the OR-Tools engine is connected. `"routing":
"configured"` means it is using your own OSRM, not the public demo.

---

## Everyday commands

```bash
docker compose logs -f app      # watch the app's logs
docker compose restart app      # restart just the app
docker compose down             # stop everything
docker compose up -d --build    # deploy new code
```

## When something is wrong

**The site does not load at all.** Check DNS actually points here
(`dig +short your-domain`) and that ports 80 and 443 are open. Caddy cannot get
a certificate otherwise: `docker compose logs caddy`.

**"Balanced" says it needs a sidecar.** The OR-Tools container is not healthy:
`docker compose logs sidecar`.

**Routes appear but distances look wrong,** and the app warns they are
estimates. It cannot reach OSRM, so it fell back to straight lines. That
fallback is deliberate — a plan with approximate distances beats no plan — but
check `docker compose logs osrm`. Usually `OSRM_REGION` does not match the file
in `osrm-data`.

**Addresses will not resolve.** `GEOCODER_USER_AGENT` is missing or a
placeholder. Photon and Nominatim both refuse unattributed requests.

---

## After it is live

**Raise the stop limit.** `MAX_STOPS` is 99 because the public OSRM demo caps
distance tables at 100 coordinates and the depot uses one. Your own OSRM has no
such limit: raise `OSRM_MAX_TABLE_SIZE` in `.env` *and* `MAX_STOPS` in
`src/lib/schema.ts` together. Be aware a table is N-squared work — 500 stops is
250,000 cells and a noticeably slower solve.

**Take backups.** There is no database, so there is nothing to lose except
`osrm-data` (rebuildable from the script) and your `.env`. That is the whole
backup story, by design.

**Refresh the map data** every few months by re-running step 4 and
`docker compose restart osrm`. Roads change.

**Watch the rate limits.** Defaults are 20 solves per IP per minute. They are
process-local, so if you ever run more than one app container each gets its own
allowance — move `src/lib/rate-limit.ts` to Redis before scaling out.
