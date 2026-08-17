/**
 * Rebuild `src/data/sweatbox/` from the `Sector/` repository.
 *
 *   SECTOR_REPO=~/Documents/Dev/CeruleanAviationNetwork/Sector \
 *     node scripts/build-sweatbox.mjs
 *
 * The SweatBox generator at `/instr/sweatbox` writes EuroScope simulator
 * scenarios, and almost every line of one is navigation data: an aircraft sits
 * on a *stand*, lines up on a *runway threshold*, enters over a *fix*, leaves
 * on a *SID* and files an *airway*. All of it already exists, hand-maintained,
 * in the sector packages — so this pulls it out rather than inventing a second
 * copy that would drift the moment an apron is repainted or an AIRAC lands.
 *
 * Sources, all from `Sector/`:
 *
 *   <FIR>/<FIR>.sct    [AIRPORT] [RUNWAY] [FIXES] [VOR] [NDB]
 *                      [HIGH AIRWAY] [LOW AIRWAY]
 *   <FIR>/<FIR>.ese    [SIDSSTARS]
 *   <FIR>/Plugins/GRplugin/GRpluginStands.txt   STAND: / WINGSPAN:
 *
 * and, optionally, `NavData/Airports.xml` for field elevation — the `.sct`
 * `[AIRPORT]` section carries `0.000` for every field, and a ground scenario
 * needs the real number because that is the altitude every parked aircraft is
 * written at. Absent, elevation is left null and the form asks for it.
 *
 * **This does not travel.** The output is derived from a commercial AIRAC
 * cycle and from a sector package that is not ours to republish, which is the
 * same rule `data/navdata` lives under: it is committed here only because this
 * repository is private. Never copy it into can-radar, can-dev or any other
 * public component.
 *
 * Layout, and why it is three shapes rather than one:
 *
 *   airports/<ICAO>.json  runways, stands, SIDs and STARs — per airport,
 *                         because none of it is shared.
 *   firs/<FIR>.json       every fix in the FIR. Writing each airport's usable
 *                         fixes into its own file was the first shape this
 *                         took and it produced 10 MB for 344 airports, because
 *                         ZGGG, ZGSZ and ZGOW between them wrote the Pearl
 *                         River Delta out three times.
 *   airways.json          the airway network, once, for the whole country. A
 *                         route from ZGGG to ZBAA crosses four FIRs, and a
 *                         graph cut at the boundary can only plan to the edge
 *                         of the one it was handed.
 *
 * Encoding: the sector packages are GBK, not UTF-8. Stand names are Chinese
 * (`东航机坪试车位`), so decoding as UTF-8 silently mangles them into replacement
 * characters and the generator offers stands nobody can identify.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = join(root, "src", "data", "sweatbox");

const sectorRepo = (
  process.env.SECTOR_REPO ??
  join(process.env.HOME ?? "", "Documents/Dev/CeruleanAviationNetwork/Sector")
).replace(/^~/, process.env.HOME ?? "~");

const navDataDir = (
  process.env.NAVDATA_REPO ??
  join(process.env.HOME ?? "", "Documents/Dev/CeruleanAviationNetwork/NavData")
).replace(/^~/, process.env.HOME ?? "~");

if (!existsSync(sectorRepo)) {
  console.error(
    `Sector repository not found at ${sectorRepo}.\n` +
      `Set SECTOR_REPO to the checkout — the default matches Ground/tools/common.py,\n` +
      `which has the same wrong default and the same override.`,
  );
  process.exit(1);
}

const gbk = new TextDecoder("gbk");
const readGbk = (path) => gbk.decode(readFileSync(path));

/**
 * `N023.22.50.491` → 23.380692. The sector format is degrees.minutes.seconds
 * and *thousandths of a second*, so the last group is not a decimal fraction
 * of the seconds field — it is a fourth field, and reading `50.491` as seconds
 * happens to be right only because they were printed adjacent.
 */
function parseSctCoord(text) {
  const match = /^([NSEW])(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text.trim());
  if (!match) return null;
  const [, hemisphere, deg, min, sec, milli] = match;
  const value =
    Number(deg) +
    Number(min) / 60 +
    (Number(sec) + Number(milli) / 1000) / 3600;
  return hemisphere === "S" || hemisphere === "W" ? -value : value;
}

const round = (n, places = 6) => Number(n.toFixed(places));

/** Lexicographic compare of two equal-length number tuples. */
function compareScores(a, b) {
  for (let at = 0; at < a.length; at++) {
    if (a[at] !== b[at]) return a[at] - b[at];
  }
  return 0;
}

/** Great-circle distance in nautical miles. */
function distanceNm(aLat, aLon, bLat, bLon) {
  const toRad = Math.PI / 180;
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return 3440.065 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

// ---------------------------------------------------------------------------
// Sector packages
// ---------------------------------------------------------------------------

/** Every `<FIR>.sct` / `.sct2` under the repo, keyed by the directory above it. */
function findSectorFiles() {
  const found = [];
  for (const entry of readdirSync(sectorRepo, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const fir = entry.name;
    const dir = join(sectorRepo, fir);
    const sct = findFirst(dir, /\.sct2?$/i, 3);
    if (!sct) continue;
    const stands = findFirst(dir, /^GRpluginStands\.txt$/i, 4);
    const ese = findFirst(dir, /\.ese$/i, 3);
    found.push({ fir, sct, stands, ese });
  }
  return found;
}

function findFirst(dir, pattern, depth) {
  if (depth < 0) return null;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (entry.isFile() && pattern.test(entry.name))
      return join(dir, entry.name);
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const hit = findFirst(join(dir, entry.name), pattern, depth - 1);
    if (hit) return hit;
  }
  return null;
}

/**
 * Split a `.sct` into its `[SECTION]` blocks. Comments (`;`) and blank lines go
 * — every consumer below would have to strip them otherwise.
 */
function parseSct(path) {
  const sections = {};
  let current = "";
  for (const raw of readGbk(path).split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trimEnd();
    if (!line.trim()) continue;
    if (line.startsWith("[")) {
      current = line.trim().toUpperCase();
      sections[current] ??= [];
      continue;
    }
    if (current) sections[current].push(line);
  }
  return sections;
}

/**
 * `[INFO]`: nine lines, of which the eighth is the **magnetic variation
 * EuroScope itself applies** to this sector file.
 *
 * That makes it the number that matters, not NavData's per-airport figure.
 * EuroScope carries one variation for the whole file and uses it to turn the
 * true heading in a position packet into the magnetic one it draws; so a
 * scenario written with any other value lands a degree or two off no matter
 * how accurate the other value is. ZGZU says 3.3 where NavData says ZGGG is
 * −3, ZBPE says 6.8 where NavData says ZBAA is −8.
 *
 * Sign: the packages record west variation **positive**, the opposite of
 * NavData. The geometry says which way round it goes — the true bearing
 * between ZGGG 01L's two thresholds is 13.9° against a published course of
 * 17°, and 13.9 + 3.3 = 17.2. So `magnetic = true + info`, and therefore
 * `true = magnetic − info`.
 *
 * The other eight lines are the file's name, default callsign, default
 * airport, centre latitude and longitude, and the two nm-per-degree scales.
 */
function parseInfoVariation(lines) {
  const rows = lines.map((line) => line.trim()).filter(Boolean);
  if (rows.length < 8) return null;
  const value = Number(rows[7]);
  return Number.isFinite(value) ? value : null;
}

/** `[AIRPORT]`: `ICAO freq lat lon class`. */
function parseAirports(lines) {
  const airports = new Map();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 4) continue;
    const [icao, , lat, lon] = parts;
    if (!/^[A-Z]{4}$/.test(icao)) continue;
    const latitude = parseSctCoord(lat);
    const longitude = parseSctCoord(lon);
    if (latitude === null || longitude === null) continue;
    airports.set(icao, { icao, lat: latitude, lon: longitude });
  }
  return airports;
}

/**
 * `[RUNWAY]`: `id1 id2 hdg1 hdg2 lat1 lon1 lat2 lon2 ICAO Name…`.
 *
 * One physical strip, both directions. The scenario format wants each
 * direction separately — `ILS02L:` is the 02L threshold looking at the 20R
 * threshold — so this emits two entries per line, each with its own threshold,
 * the opposite threshold as the far end, and the published magnetic course.
 */
function parseRunways(lines) {
  const byAirport = new Map();
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 9) continue;
    const [id1, id2, hdg1, hdg2, lat1, lon1, lat2, lon2, icao] = parts;
    if (!/^[A-Z]{4}$/.test(icao)) continue;

    const a = { lat: parseSctCoord(lat1), lon: parseSctCoord(lon1) };
    const b = { lat: parseSctCoord(lat2), lon: parseSctCoord(lon2) };
    if (a.lat === null || a.lon === null || b.lat === null || b.lon === null)
      continue;

    const list = byAirport.get(icao) ?? [];
    list.push(
      {
        id: id1,
        opposite: id2,
        hdg: Number(hdg1),
        lat: round(a.lat),
        lon: round(a.lon),
        endLat: round(b.lat),
        endLon: round(b.lon),
      },
      {
        id: id2,
        opposite: id1,
        hdg: Number(hdg2),
        lat: round(b.lat),
        lon: round(b.lon),
        endLat: round(a.lat),
        endLon: round(a.lon),
      },
    );
    byAirport.set(icao, list);
  }
  return byAirport;
}

/**
 * `[SIDSSTARS]` out of the `.ese`: `SID:<ICAO>:<RWY>:<NAME>:<points>` and the
 * same shape for `STAR`.
 *
 * These are the published procedures, per runway — which is exactly the grain
 * a scenario needs, because which SID a departure gets is decided by the
 * runway in use. The `RV` entries (`SID:ZGDY:26:RV:ZGDY`) are EuroScope's
 * radar-vector placeholders rather than procedures, and are dropped: filing
 * `RV` on a strip says nothing.
 */
function parseProcedures(path) {
  const byAirport = new Map();
  let section = "";
  for (const raw of readGbk(path).split(/\r?\n/)) {
    const line = raw.replace(/;.*$/, "").trim();
    if (!line) continue;
    if (line.startsWith("[")) {
      section = line.toUpperCase();
      continue;
    }
    if (section !== "[SIDSSTARS]") continue;

    const [kind, icao, runway, name, points = ""] = line.split(":");
    if (kind !== "SID" && kind !== "STAR") continue;
    if (!/^[A-Z]{4}$/.test(icao ?? "")) continue;
    if (!name || name === "RV") continue;

    const list = points.trim().split(/\s+/).filter(Boolean);
    // A procedure whose only point is the field itself carries no track.
    if (list.length < 2) continue;

    const entry = byAirport.get(icao) ?? { sids: [], stars: [] };
    (kind === "SID" ? entry.sids : entry.stars).push({
      name,
      runway,
      points: list,
    });
    byAirport.set(icao, entry);
  }
  return byAirport;
}

/**
 * `[HIGH AIRWAY]` / `[LOW AIRWAY]`: `<NAME> <lat1> <lon1> <lat2> <lon2>`.
 *
 * The segments are geometry, not names — the sector format draws airways as
 * lines and never says which fix an end sits on. Resolving them back into fix
 * names is what makes a *filed* route possible (`YIN A461 ZHO`), so each end
 * is matched to the nearest known fix.
 *
 * **The match has to be by proximity, not by string.** The coordinates are
 * round-tripped through a float somewhere upstream and come back a thousandth
 * of a second out (`E108.51.02.999` for a fix published at `…03.000`), so
 * exact matching resolves 97 segments out of 704 while a 0.6 NM tolerance
 * resolves 7302 of 7614 nationally.
 */
function parseAirways(lines) {
  const segments = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const a = parseSctCoord(parts[1]);
    const b = parseSctCoord(parts[2]);
    const c = parseSctCoord(parts[3]);
    const d = parseSctCoord(parts[4]);
    if (a === null || b === null || c === null || d === null) continue;
    segments.push({ name: parts[0], from: [a, b], to: [c, d] });
  }
  return segments;
}

/** `[FIXES]`: `NAME lat lon`. `[VOR]`/`[NDB]`: `NAME freq lat lon`. */
function parsePoints(lines, coordAt) {
  const points = [];
  for (const line of lines) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < coordAt + 2) continue;
    const lat = parseSctCoord(parts[coordAt]);
    const lon = parseSctCoord(parts[coordAt + 1]);
    if (lat === null || lon === null) continue;
    points.push({ name: parts[0], lat: round(lat, 5), lon: round(lon, 5) });
  }
  return points;
}

/**
 * `GRpluginStands.txt`: `STAND:ICAO:name:lat:lon:heading`, optionally followed
 * by `WINGSPAN:metres` on the next line. The wingspan belongs to the stand
 * above it, so this is a two-line record and not two records.
 */
function parseStands(path) {
  const byAirport = new Map();
  let last = null;
  for (const raw of readGbk(path).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("STAND:")) {
      const [, icao, name, lat, lon, hdg] = line.split(":");
      const latitude = parseSctCoord(lat);
      const longitude = parseSctCoord(lon);
      if (!icao || latitude === null || longitude === null) {
        last = null;
        continue;
      }
      last = {
        name,
        lat: round(latitude),
        lon: round(longitude),
        hdg: Number(hdg) || 0,
      };
      const list = byAirport.get(icao) ?? [];
      list.push(last);
      byAirport.set(icao, list);
      continue;
    }
    if (line.startsWith("WINGSPAN:") && last) {
      const span = Number(line.slice("WINGSPAN:".length));
      if (Number.isFinite(span)) last.span = span;
      last = null;
    }
  }
  return byAirport;
}

// ---------------------------------------------------------------------------
// Field elevation (optional)
// ---------------------------------------------------------------------------

/**
 * `<Airport ID="ZGGG" Name="…" Elevation="50" MagVar="-2.6" …>` — one regex
 * over 11 MB rather than an XML parser, because four attributes off a flat
 * element list is not a tree problem and this keeps the script dependency-free.
 */
function readElevations() {
  const path = join(navDataDir, "Airports.xml");
  if (!existsSync(path)) return new Map();
  const xml = readFileSync(path, "latin1");
  const map = new Map();
  const pattern =
    /<Airport\s+ID="([A-Z0-9]{4})"[^>]*?Elevation="(-?\d+)"[^>]*?MagVar="(-?[\d.]+)"/g;
  let match;
  while ((match = pattern.exec(xml)) !== null) {
    map.set(match[1], { elev: Number(match[2]), magVar: Number(match[3]) });
  }
  return map;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

const elevations = readElevations();
const index = [];
const firIndex = [];
let standTotal = 0;
let bytes = 0;

for (const sub of ["airports", "firs"]) {
  rmSync(join(outDir, sub), { recursive: true, force: true });
  mkdirSync(join(outDir, sub), { recursive: true });
}

/**
 * Airports are claimed by more than one package, so collect every candidate
 * first and pick per ICAO afterwards rather than writing as we go.
 *
 * The overlap is not incidental: `PRC_FSS/` is the national overview and its
 * `[AIRPORT]` section lists **every** field in the country, while each FIR
 * package draws only its own aprons. Writing straight to disk therefore let
 * whichever package happened to be read last win, which put ZBAA in the index
 * four times — three of them saying it has no stands — and made the file on
 * disk depend on directory order. Prefer the package with the most stands,
 * then the most runways: that is the one that actually owns the field.
 */
const candidates = new Map();
const fixesByFir = new Map();
/** Every fix in the country, for resolving airway geometry back into names. */
const nationalFixes = [];
const rawAirways = [];

for (const { fir, sct, stands, ese } of findSectorFiles()) {
  const sections = parseSct(sct);
  const airports = parseAirports(sections["[AIRPORT]"] ?? []);
  const runways = parseRunways(sections["[RUNWAY]"] ?? []);
  const standsByAirport = stands ? parseStands(stands) : new Map();
  const procedures = ese ? parseProcedures(ese) : new Map();
  // EuroScope's own variation for this file — see parseInfoVariation.
  const sectorVariation = parseInfoVariation(sections["[INFO]"] ?? []);

  const points = [
    ...parsePoints(sections["[FIXES]"] ?? [], 1),
    ...parsePoints(sections["[VOR]"] ?? [], 2),
    ...parsePoints(sections["[NDB]"] ?? [], 2),
  ];
  nationalFixes.push(...points);
  rawAirways.push(
    ...parseAirways(sections["[HIGH AIRWAY]"] ?? []),
    ...parseAirways(sections["[LOW AIRWAY]"] ?? []),
  );

  // The same name can appear in [FIXES] and again as a VOR on the field. The
  // first wins, which is [FIXES] — the two agree on position to within metres
  // and disagreeing on which one to draw would be a distinction without one.
  const seen = new Set();
  fixesByFir.set(
    fir,
    points
      .filter((point) =>
        seen.has(point.name) ? false : (seen.add(point.name), true),
      )
      .sort((a, b) => a.name.localeCompare(b.name)),
  );

  // An airport is worth shipping when it has runways — that is the minimum a
  // scenario needs. Stands are what make a *ground* scenario possible, so they
  // are counted separately and the UI says which kind an airport supports.
  for (const [icao, airport] of airports) {
    const airportRunways = runways.get(icao);
    if (!airportRunways?.length) continue;

    const airportStands = standsByAirport.get(icao) ?? [];
    const airportProcedures = procedures.get(icao) ?? { sids: [], stars: [] };
    const record = {
      icao,
      fir,
      lat: round(airport.lat),
      lon: round(airport.lon),
      elev: elevations.get(icao)?.elev ?? null,
      // The value EuroScope applies, as the package declares it (west
      // positive). NavData's per-airport figure is kept beside it for
      // reference, negated to the same convention where the package is silent.
      variation:
        sectorVariation ??
        (elevations.get(icao)?.magVar != null
          ? -elevations.get(icao).magVar
          : null),
      magVar: elevations.get(icao)?.magVar ?? null,
      runways: airportRunways.sort((a, b) => a.id.localeCompare(b.id)),
      stands: airportStands.sort((a, b) =>
        a.name.localeCompare(b.name, "zh-Hans-CN", { numeric: true }),
      ),
      sids: airportProcedures.sids.sort((a, b) => a.name.localeCompare(b.name)),
      stars: airportProcedures.stars.sort((a, b) =>
        a.name.localeCompare(b.name),
      ),
    };

    // Procedures come from the `.ese` and stands from the ground plugin, so a
    // package can win on one and lose on the other. Ranking on stands first
    // keeps the ground picture authoritative — but a package with procedures
    // beats one with none at the same stand count, because a departure with no
    // SID files a route that says nothing.
    const held = candidates.get(icao);
    const score = (entry) => [
      entry.stands.length,
      entry.sids.length + entry.stars.length,
      entry.runways.length,
    ];
    if (!held || compareScores(score(record), score(held)) > 0) {
      candidates.set(icao, record);
    }
  }
}

let dropped = 0;
for (const [icao, record] of [...candidates].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  const json = JSON.stringify(record);
  writeFileSync(join(outDir, "airports", `${icao}.json`), json);
  bytes += json.length;
  standTotal += record.stands.length;
  index.push({
    icao,
    fir: record.fir,
    elev: record.elev,
    runways: record.runways.map((runway) => runway.id),
    stands: record.stands.length,
  });
}

// Only FIRs that ended up owning an airport need their fixes shipping — the
// endpoint loads them by the `fir` on the winning airport record.
const owningFirs = new Set(index.map((entry) => entry.fir));
for (const [fir, fixes] of [...fixesByFir].sort(([a], [b]) =>
  a.localeCompare(b),
)) {
  if (!owningFirs.has(fir)) {
    dropped++;
    continue;
  }
  const firJson = JSON.stringify({ fir, fixes });
  writeFileSync(join(outDir, "firs", `${fir}.json`), firJson);
  bytes += firJson.length;
  firIndex.push({
    fir,
    fixes: fixes.length,
    airports: index.filter((entry) => entry.fir === fir).length,
  });
}

/**
 * The national airway graph.
 *
 * Segments are geometry in the sector packages, so each end is snapped to the
 * nearest fix. The tolerance is a shade over half a mile: the coordinates come
 * back a thousandth of a second out from a float round-trip somewhere
 * upstream, so exact matching resolves about one segment in seven, while this
 * resolves 96% of them. A segment whose ends cannot both be named is dropped
 * rather than guessed at — an airway leg to the wrong fix is a route that
 * reads fine and flies somewhere else.
 *
 * One file, not one per FIR: a route from ZGGG to ZBAA crosses four of them,
 * and a graph split at the FIR boundary can only ever plan to the edge of the
 * one it was handed.
 */
const SNAP_NM = 0.6;

const fixGrid = new Map();
const gridKey = (lat, lon) => `${Math.round(lat * 10)},${Math.round(lon * 10)}`;
for (const fix of nationalFixes) {
  const key = gridKey(fix.lat, fix.lon);
  if (!fixGrid.has(key)) fixGrid.set(key, []);
  fixGrid.get(key).push(fix);
}

function nearestFix(lat, lon) {
  let best = null;
  let bestNm = Infinity;
  const baseLat = Math.round(lat * 10);
  const baseLon = Math.round(lon * 10);
  for (let dLat = -1; dLat <= 1; dLat++) {
    for (let dLon = -1; dLon <= 1; dLon++) {
      const cell = fixGrid.get(`${baseLat + dLat},${baseLon + dLon}`);
      if (!cell) continue;
      for (const fix of cell) {
        const nm = distanceNm(lat, lon, fix.lat, fix.lon);
        if (nm < bestNm) {
          bestNm = nm;
          best = fix;
        }
      }
    }
  }
  return bestNm <= SNAP_NM ? best : null;
}

const airwayFixes = {};
const seenSegments = new Set();
const airwaySegments = [];
let unresolvedSegments = 0;

for (const segment of rawAirways) {
  const from = nearestFix(segment.from[0], segment.from[1]);
  const to = nearestFix(segment.to[0], segment.to[1]);
  if (!from || !to || from.name === to.name) {
    unresolvedSegments++;
    continue;
  }
  // The same leg is drawn in both FIR packages either side of a boundary.
  const key = [segment.name, from.name, to.name].sort().join(" ");
  if (seenSegments.has(key)) continue;
  seenSegments.add(key);

  airwaySegments.push([segment.name, from.name, to.name]);
  airwayFixes[from.name] = [round(from.lat, 5), round(from.lon, 5)];
  airwayFixes[to.name] = [round(to.lat, 5), round(to.lon, 5)];
}

airwaySegments.sort(
  (a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]),
);
const airwaysJson = JSON.stringify({
  fixes: airwayFixes,
  segments: airwaySegments,
});
writeFileSync(join(outDir, "airways.json"), airwaysJson);
bytes += airwaysJson.length;

const withStands = index.filter((entry) => entry.stands > 0).length;
console.log(
  `sweatbox airways: ${airwaySegments.length} segments over ` +
    `${Object.keys(airwayFixes).length} fixes, ` +
    `${new Set(airwaySegments.map((s) => s[0])).size} airways, ` +
    `${unresolvedSegments} segment(s) unresolved and dropped, ` +
    `${(airwaysJson.length / 1024).toFixed(0)} KB`,
);
console.log(
  `sweatbox: ${index.length} airports (${withStands} with stands) across ` +
    `${firIndex.length} FIRs, ${standTotal} stands, ` +
    `${firIndex.reduce((sum, entry) => sum + entry.fixes, 0)} fixes, ` +
    `${(bytes / 1024).toFixed(0)} KB` +
    (dropped ? `, ${dropped} FIR(s) owned no airport and were skipped` : "") +
    (elevations.size ? "" : " — NavData absent, elevations left null"),
);

writeFileSync(
  join(outDir, "index.json"),
  JSON.stringify({ airports: index, firs: firIndex }),
);
