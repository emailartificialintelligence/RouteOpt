#!/usr/bin/env bash
#
# Prepare an OSRM routing graph from an OpenStreetMap extract.
#
# This is the one genuinely slow step in deployment, and it only has to be done
# once per region (and again when you want fresher map data). It downloads a
# region, then runs OSRM's three preprocessing stages over it.
#
#   ./scripts/prepare-osrm.sh https://download.geofabrik.de/europe/monaco-latest.osm.pbf
#
# Pick your region from https://download.geofabrik.de — take the smallest
# extract that covers your delivery area. Size matters a lot here:
#
#   Monaco       ~2 MB     seconds, ~100 MB RAM      good for a first test
#   Île-de-France ~400 MB  ~10 min,  ~4 GB RAM
#   France       ~4 GB     ~1-2 hrs, ~16 GB RAM
#
# Preprocessing needs roughly ten times the extract size in RAM. If the machine
# is small, prepare the graph on a bigger one and copy ./osrm-data across —
# the output is portable.

set -euo pipefail

URL="${1:-}"
if [[ -z "$URL" ]]; then
  echo "usage: $0 <url-to-.osm.pbf>" >&2
  echo "example: $0 https://download.geofabrik.de/europe/monaco-latest.osm.pbf" >&2
  exit 1
fi

DATA_DIR="$(cd "$(dirname "$0")/.." && pwd)/osrm-data"
PBF_NAME="$(basename "$URL")"
# osrm-extract names its output after the input file, so the region name is
# whatever precedes the first dot. This must match OSRM_REGION in .env.
REGION="${PBF_NAME%%.*}"
IMAGE="osrm/osrm-backend:latest"

mkdir -p "$DATA_DIR"

if [[ -f "$DATA_DIR/$PBF_NAME" ]]; then
  echo "==> $PBF_NAME already downloaded, skipping"
else
  echo "==> downloading $URL"
  curl -L --fail --progress-bar -o "$DATA_DIR/$PBF_NAME" "$URL"
fi

run_osrm() {
  docker run --rm -t -v "$DATA_DIR:/data" "$IMAGE" "$@"
}

# The three stages of the MLD pipeline. car.lua is the driving profile; swap it
# for bicycle.lua or foot.lua if you ever route something other than vans.
echo "==> extracting road network (the slow one)"
run_osrm osrm-extract -p /opt/car.lua "/data/$PBF_NAME"

echo "==> partitioning"
run_osrm osrm-partition "/data/$REGION.osrm"

echo "==> customising"
run_osrm osrm-customize "/data/$REGION.osrm"

echo
echo "==> done. Graph written to ./osrm-data"
echo
echo "    Put this in your .env so compose loads the right graph:"
echo
echo "        OSRM_REGION=$REGION"
echo
