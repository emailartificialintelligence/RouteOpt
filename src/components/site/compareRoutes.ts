/**
 * The crossing-routes problem, from real data.
 *
 * Forty stops across three vans, the same set in both panels. The left runs one
 * global nearest-neighbour sweep, opening a new vehicle whenever the current
 * one fills — the approach BUILD_PLAN.md warns against. The right clusters
 * first, then sequences each cluster.
 *
 * Straight lines between stops, not road geometry: the point is the shape of
 * the assignment, and road detail would bury it.
 *
 * Generated, not drawn. The naive routes really do overlap.
 */

export const COMPARE_VIEWBOX = { width: 300, height: 250 } as const;
export const COMPARE_DEPOT = { x: 181.6, y: 155.3 } as const;

export const COMPARE_STOPS: readonly { x: number; y: number }[] = [
  { x: 79.0, y: 163.9 },
  { x: 63.9, y: 92.2 },
  { x: 120.3, y: 117.4 },
  { x: 147.6, y: 222.2 },
  { x: 133.4, y: 226.7 },
  { x: 67.4, y: 219.6 },
  { x: 209.1, y: 141.9 },
  { x: 92.9, y: 207.8 },
  { x: 232.3, y: 97.4 },
  { x: 126.3, y: 108.4 },
  { x: 58.9, y: 20.9 },
  { x: 105.7, y: 46.7 },
  { x: 72.6, y: 203.3 },
  { x: 207.0, y: 167.3 },
  { x: 161.9, y: 195.3 },
  { x: 121.6, y: 94.8 },
  { x: 62.1, y: 114.8 },
  { x: 89.6, y: 221.9 },
  { x: 132.2, y: 85.7 },
  { x: 162.6, y: 166.1 },
  { x: 107.7, y: 135.6 },
  { x: 184.5, y: 60.7 },
  { x: 160.5, y: 181.4 },
  { x: 218.4, y: 119.8 },
  { x: 105.4, y: 75.0 },
  { x: 72.7, y: 20.0 },
  { x: 195.7, y: 143.3 },
  { x: 144.1, y: 201.6 },
  { x: 178.6, y: 226.3 },
  { x: 160.2, y: 67.3 },
  { x: 110.3, y: 43.0 },
  { x: 164.3, y: 82.5 },
  { x: 137.8, y: 107.8 },
  { x: 231.8, y: 50.7 },
  { x: 177.8, y: 131.0 },
  { x: 185.0, y: 221.6 },
  { x: 241.1, y: 93.0 },
  { x: 104.7, y: 54.7 },
  { x: 178.6, y: 150.3 },
  { x: 138.8, y: 230.0 },
] as const;

/** One global sweep: vans interleave and cover the same ground. */
export const NAIVE_PATHS: readonly string[] = [
  "M181.6,155.3 L178.6,150.3 L195.7,143.3 L209.1,141.9 L218.4,119.8 L232.3,97.4 L241.1,93.0 L231.8,50.7 L184.5,60.7 L160.2,67.3 L164.3,82.5 L132.2,85.7 L121.6,94.8 L126.3,108.4 L120.3,117.4 L181.6,155.3",
  "M181.6,155.3 L162.6,166.1 L160.5,181.4 L161.9,195.3 L144.1,201.6 L147.6,222.2 L138.8,230.0 L133.4,226.7 L89.6,221.9 L92.9,207.8 L72.6,203.3 L67.4,219.6 L79.0,163.9 L107.7,135.6 L137.8,107.8 L181.6,155.3",
  "M181.6,155.3 L177.8,131.0 L207.0,167.3 L185.0,221.6 L178.6,226.3 L62.1,114.8 L63.9,92.2 L105.4,75.0 L104.7,54.7 L105.7,46.7 L110.3,43.0 L72.7,20.0 L58.9,20.9 L181.6,155.3",
] as const;

/** Cluster first, then sequence: each van keeps to its own area. */
export const CLUSTERED_PATHS: readonly string[] = [
  "M181.6,155.3 L79.0,163.9 L92.9,207.8 L72.6,203.3 L67.4,219.6 L89.6,221.9 L133.4,226.7 L138.8,230.0 L147.6,222.2 L178.6,226.3 L185.0,221.6 L144.1,201.6 L161.9,195.3 L160.5,181.4 L162.6,166.1 L181.6,155.3",
  "M181.6,155.3 L137.8,107.8 L126.3,108.4 L121.6,94.8 L132.2,85.7 L105.4,75.0 L104.7,54.7 L58.9,20.9 L72.7,20.0 L110.3,43.0 L105.7,46.7 L63.9,92.2 L62.1,114.8 L107.7,135.6 L120.3,117.4 L181.6,155.3",
  "M181.6,155.3 L207.0,167.3 L209.1,141.9 L177.8,131.0 L164.3,82.5 L160.2,67.3 L184.5,60.7 L231.8,50.7 L241.1,93.0 L232.3,97.4 L218.4,119.8 L195.7,143.3 L178.6,150.3 L181.6,155.3",
] as const;

export const COMPARE_STATS = { naiveKm: 64.9, clusteredKm: 59.0 } as const;
