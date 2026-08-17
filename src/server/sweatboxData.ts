/**
 * Server-side access to the SweatBox reference data.
 *
 * The JSON under `src/data/sweatbox/` is built from the sector packages by
 * `scripts/build-sweatbox.mjs` and is ~1.7 MB across 350-odd files. It is
 * reached through `import.meta.glob` rather than `fs`, so Vite bundles each
 * airport as its own chunk and the page loads exactly the one it was asked
 * for — reading the directory at runtime would work in `astro dev` and then
 * find nothing beside `dist/server/entry.mjs`.
 *
 * **This data is deliberately not in `public/`.** It is derived from a
 * commercial AIRAC cycle and from a sector package that is not ours to
 * republish, and anything under `public/` is served to the open internet with
 * no session in front of it. `public/airports.json` next door is VATSpy's open
 * data and is a different case. The consumer here is
 * `src/pages/instr/sweatbox/[icao].json.ts`, which checks the caller's rating
 * before answering.
 */
import type {
  AirwayGraph,
  SweatboxAirport,
  SweatboxFix,
  SweatboxIndexEntry,
} from "@/lib/sweatbox";

import index from "@/data/sweatbox/index.json";

const airportFiles = import.meta.glob<SweatboxAirport>(
  "../data/sweatbox/airports/*.json",
  { import: "default" },
);
const firFiles = import.meta.glob<{ fir: string; fixes: SweatboxFix[] }>(
  "../data/sweatbox/firs/*.json",
  { import: "default" },
);

export interface SweatboxIndex {
  airports: SweatboxIndexEntry[];
  firs: { fir: string; fixes: number; airports: number }[];
}

/** Every airport the generator can build a scenario for. Small; safe to inline. */
export function readIndex(): SweatboxIndex {
  return index as SweatboxIndex;
}

/** Runways and stands for one airport, or null when it is not in the packages. */
export async function readAirport(
  icao: string,
): Promise<SweatboxAirport | null> {
  const key = `../data/sweatbox/airports/${icao.toUpperCase()}.json`;
  const load = airportFiles[key];
  return load ? await load() : null;
}

/**
 * Every fix in a FIR. Shared rather than per-airport: writing each airport's
 * usable fixes into its own file cost 10 MB, because the neighbours all wrote
 * the same terminal area out again.
 */
/**
 * The national airway network. Loaded lazily — 134 KB that only the generator
 * wants, and only once it has an airport to plan from.
 */
export async function readAirways(): Promise<AirwayGraph> {
  const module = await import("@/data/sweatbox/airways.json");
  // Through `unknown`: TypeScript infers the JSON's arrays as `number[]` and
  // `string[][]`, which do not overlap with the fixed-length tuples the graph
  // declares. The file is generated to that shape by build-sweatbox.mjs.
  return module.default as unknown as AirwayGraph;
}

export async function readFirFixes(fir: string): Promise<SweatboxFix[]> {
  const key = `../data/sweatbox/firs/${fir.toUpperCase()}.json`;
  const load = firFiles[key];
  if (!load) return [];
  return (await load()).fixes;
}
