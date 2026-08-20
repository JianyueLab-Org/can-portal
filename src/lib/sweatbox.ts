/**
 * The EuroScope SweatBox scenario format, as a builder.
 *
 * Browser-safe and dependency-free: the island at `/instr/sweatbox` composes a
 * scenario in the form, this turns it into the `.txt` EuroScope loads, and the
 * instructor saves the file. Nothing is stored — a scenario is a training
 * artefact an instructor carries to a session, not network data.
 *
 * ## What the format is
 *
 * A scenario is a header of global settings followed by one block per
 * aircraft, blocks separated by a blank line. Both halves are line-oriented
 * `KEY:value:value` records; EuroScope reads by index and ignores what it does
 * not recognise, which is why a malformed line is silently *dropped* rather
 * than reported. That is the single most important thing to know about editing
 * one by hand, and the reason this exists.
 *
 * Header records:
 *
 *   AIRPORT_ALT:<feet>              field elevation; parked aircraft sit at it
 *   ILS<rwy>:<lat>:<lon>:<course>   threshold + magnetic course
 *   ILS<rwy>:<lat>:<lon>:<lat>:<lon>  threshold + far end (decimal degrees)
 *   HOLDING:<fix>:<inbound>:<±1>    published hold; 1 right, -1 left
 *   METAR:<full METAR>              what the ATIS and the pilots read
 *   CONTROLLER:<callsign>:<freq>    a position the scenario expects staffed
 *   ROUTE:<name>:<fix fix fix>      a named ground/departure route
 *   PERFAC / PERFLINE               see sweatboxPerf.ts
 *
 * Aircraft block:
 *
 *   PSEUDOPILOT:ALL                 who flies it until a controller takes it
 *   @N:<callsign>:<squawk>:<rating>:<lat>:<lon>:<alt>:<gs>:<pbh>:<qnh delta>
 *   $FP<callsign>:*A:…              the filed flight plan
 *   SIMDATA:<callsign>:*:*:…        simulator handling overrides
 *   $ROUTE:<fix fix fix>            what the pseudopilot actually flies
 *   DELAY:<min>:<max>               minutes before it comes alive
 *   START:<minutes>                 delays activation from scenario start
 *   REQALT::<feet>                  the level it will ask for
 *   INITIALPSEUDOPILOT:<callsign>   hands it to a named position, not ALL
 *
 * ## Two things that are easy to get wrong
 *
 * **The `@N` line has two field counts in the wild.** The FSD position packet
 * it is copied from carries nine values after the mode, and the approach
 * scenarios in `SweatBox/` match that exactly; six of the tower scenarios
 * carry a tenth trailing `0`. EuroScope accepts both because it reads by
 * index. This writes the nine-value form — the one the protocol defines, and
 * the one a reader can check against `can-fsd/docs/protocol.md`.
 *
 * **Heading is packed into ten bits, and it is a _true_ heading.** The field is
 * FSD's pbh — `heading / 360 * 1024`, shifted left two — so the multiplier is
 * `1024 / 360` ≈ 2.8444. `SweatBox/ES模拟机机组航向计算.py` used to say 2.88,
 * which walks the nose round by up to 4.5° at the top of the range; the
 * scenarios themselves were always written with the correct constant (ZUUU's
 * approach set encodes 3696, which is 324.8° under the ten-bit reading and a
 * meaningless 320.8° under 2.88), so the script was the thing that was wrong.
 * It has been corrected and now agrees with `encodeHeading` below on every
 * tenth of a degree round the circle.
 *
 * True, not magnetic, is the other half of that: the sector packages publish
 * runway courses magnetic, and writing one of those into this field leaves the
 * aircraft skew by the local variation. See `magneticToTrue`.
 *
 * **An aircraft on the ground is written at altitude 0, not at the field
 * elevation.** `AIRPORT_ALT` is what puts the ground where it belongs; the
 * position line then says 0 and lets it. Every hand-written set in `SweatBox/`
 * does this, at fields from ZSPD's 12 ft to ZBYN's 2578 ft, and those are the
 * scenarios that have actually been flown — so 0 is the form that is known to
 * work at a high field, and repeating the elevation in both places is not.
 * This generator used to write the elevation and parked aircraft came out
 * wrong.
 *
 * It applies to the ground only. An airborne aircraft's altitude is MSL, which
 * is why the ZUUU approach set carries 13800 against `AIRPORT_ALT:1681.0`.
 */

import { PERFORMANCE } from "@/lib/sweatboxPerf";
import { joinAircraft } from "@/lib/flightplan";

// ---------------------------------------------------------------------------
// The data the generator draws on (see scripts/build-sweatbox.mjs)
// ---------------------------------------------------------------------------

export interface SweatboxRunway {
  id: string;
  opposite: string;
  /** Published magnetic course, degrees. */
  hdg: number;
  /** Threshold. */
  lat: number;
  lon: number;
  /** Opposite threshold — the far end of the same strip. */
  endLat: number;
  endLon: number;
}

/**
 * A parking stand.
 *
 * **There is no nose heading here, and there used to be.** The fifth field of
 * `GRpluginStands.txt`'s `STAND:` record was read as one, which put every
 * parked aircraft at the same heading across a whole field — ZBSJ's 88 stands
 * all came out at 30° magnetic. The field is a **wingspan in metres**: across
 * the ten packages it takes exactly two values on the mainland (30 for 10064
 * stands, 25 for 605, blanket figures nobody varied) and on RCAA it takes the
 * real ones — 79.8, 68.4, 64.8, 35.79, which are the A380, the 747, the 777
 * and the 737. A heading takes 360 values, not two.
 *
 * Nothing in the tree publishes a stand heading, so the generator does not
 * invent one; see `generateTraffic`'s GND block.
 */
export interface SweatboxStand {
  name: string;
  lat: number;
  lon: number;
  /** Wingspan in metres, where the ground plugin records one. */
  span?: number;
}

/**
 * A published SID or STAR, per runway, out of the sector package's `.ese`.
 *
 * `points` is the whole track. What a filed route actually uses is one end of
 * it: a departure's route begins at the SID's **last** point (the SID itself
 * is not named — EuroScope derives it from the runway), and an arrival's ends
 * with the STAR's name and runway after its **first** point. That asymmetry is
 * the house style, taken from the hand-written scenarios: departures read
 * `YIN A461 ZHO …` and arrivals `… ELKAL W179 IGNAK IGNAK9J/02R`.
 */
export interface SweatboxProcedure {
  name: string;
  runway: string;
  points: string[];
}

export interface SweatboxAirport {
  icao: string;
  fir: string;
  lat: number;
  lon: number;
  /** Field elevation in feet; null when NavData was absent at build time. */
  elev: number | null;
  /**
   * The variation the sector file declares (`.sct` `[INFO]` line 8), **west
   * positive** — the one EuroScope applies, and therefore the one that
   * cancels. See `magneticToTrue`.
   */
  variation: number | null;
  /** NavData's per-airport figure, west negative. Kept for reference only. */
  magVar: number | null;
  runways: SweatboxRunway[];
  stands: SweatboxStand[];
  sids: SweatboxProcedure[];
  stars: SweatboxProcedure[];
}

/**
 * One city pair's route, as can-db planned it.
 *
 * **This replaces the airway graph this file used to plan over.** The generator
 * downloaded the national network (134 KB) and ran its own A* — a second
 * implementation of `can-db/internal/aip/route.go` that never agreed with it,
 * and never said so:
 *
 *   - **Direction.** 32% of the country's segments are one-way. The local graph
 *     was undirected, so it produced routes that read perfectly and contain a
 *     dozen legs flown backwards. Not one of them is filable.
 *   - **Published routings.** The compilation publishes 13,904 city-pair
 *     routings covering 10,367 airport pairs. That is the authoritative answer
 *     to "how should this be flown"; a shortest path is not. The local planner
 *     did not know they existed.
 *   - **Airways that are not cruise airways.** `J`-prefixed terminal connectors
 *     and the L888 corridor's `FANS-*` escape routes are excluded from can-db's
 *     graph. The local one spliced them in as ordinary legs.
 *
 * So the whole of it is can-db's now, and this file only rewrites the answer
 * into the scenario's house style.
 */
export interface SweatboxRoutePlan {
  from: string;
  to: string;
  /** Filable route string: SID, then airways and fixes, then STAR. */
  route: string;
  /** The procedures the search chose; empty when the field publishes none. */
  sid: string;
  star: string;
  /** `published` when the compilation publishes this pair, else `computed`. */
  source: string;
  /** Every place the planner had to fall back, in order. */
  notes: string[];
}

export interface SweatboxFix {
  name: string;
  lat: number;
  lon: number;
}

export interface SweatboxIndexEntry {
  icao: string;
  fir: string;
  elev: number | null;
  runways: string[];
  stands: number;
}

// ---------------------------------------------------------------------------
// The scenario model
// ---------------------------------------------------------------------------

/**
 * Which position the traffic is *for*. A scenario ticks any combination, and
 * each one contributes a different slice of the picture:
 *
 *   GND  aircraft on stands, engines off, about to ask for pushback. Ground
 *        movement and nothing else — they stop at the holding point.
 *   TWR  arrivals on final, 3 NM to 20 NM, descending the glide. This is the
 *        one that puts landing traffic in front of the tower.
 *   DEP  departures at the departure runway threshold, stopped, waiting for a
 *        take-off clearance. Departures only. (They used to be strung out
 *        along the upwind already airborne; `START` spaces them instead, so
 *        the exercise begins where a departure begins.)
 *   APP  arrivals at level, 15 NM to 70 NM out on a radial, inbound.
 *
 * They compose: GND+TWR is a tower/ground session, all four is the whole
 * field. They are separate rather than one "ground or approach" flag because a
 * scenario is written for a *seat*, and a departure controller training alone
 * wants nothing on the aprons.
 */
export type ScenarioProfile = "GND" | "TWR" | "DEP" | "APP";

export const SCENARIO_PROFILES: readonly ScenarioProfile[] = [
  "GND",
  "TWR",
  "DEP",
  "APP",
];

/**
 * How busy.
 *
 * The three named levels are a starting point, not the setting — `custom` is a
 * first-class value and the per-profile counts are always editable. An
 * instructor building a session knows what they want to put in front of a
 * particular trainee far better than a preset does; the levels exist so the
 * common case is one click rather than four number fields.
 */
export type TrafficLevel = "low" | "medium" | "high" | "custom";

/** The presets, in order. `custom` is deliberately absent — it is not a preset. */
export const TRAFFIC_LEVELS: readonly Exclude<TrafficLevel, "custom">[] = [
  "low",
  "medium",
  "high",
];

export type TrafficCounts = Record<ScenarioProfile, number>;

/**
 * Aircraft per profile at each preset.
 *
 * The high row is calibrated against the hand-written sets rather than picked:
 * the ZGGG tower scenario runs 82 aircraft on the ground, and the ZUUU
 * approach set 16 inbound. Ground tolerates far more than the air does,
 * because a stand costs a controller one instruction and an inbound costs
 * continuous attention.
 */
export const TRAFFIC_COUNTS: Record<
  Exclude<TrafficLevel, "custom">,
  TrafficCounts
> = {
  low: { GND: 8, TWR: 4, DEP: 4, APP: 5 },
  medium: { GND: 20, TWR: 7, DEP: 7, APP: 9 },
  high: { GND: 40, TWR: 11, DEP: 11, APP: 14 },
};

/**
 * The level an arrival is handed over at, entering the terminal area.
 *
 * 9800 ft is 3000 m — a metric level, like everything else filed in China, and
 * a common one to be given crossing into approach control's airspace.
 */
export const APP_ENTRY_ALTITUDE = 9800;

/** Upper bound per profile, so a slipped keypress cannot ask for 9000 aircraft. */
export const MAX_PER_PROFILE = 120;

export interface ScenarioController {
  callsign: string;
  frequency: string;
}

export interface ScenarioHolding {
  fix: string;
  /** Inbound course, degrees. */
  inbound: number;
  /** 1 right-hand, -1 left-hand. */
  turn: 1 | -1;
}

export interface ScenarioNamedRoute {
  name: string;
  points: string;
}

export interface ScenarioAircraft {
  /** Which profile put it here. Carried so the table can group and re-place. */
  profile: ScenarioProfile;
  callsign: string;
  /**
   * ICAO type designator, bare. **The equipment suffix does not live here** —
   * this is the key the `PERFAC` block is looked up under, and `B738/L` finds
   * nothing, which silently drops the aircraft onto EuroScope's generic
   * performance model. They are joined only when the `$FP` line is written.
   */
  type: string;
  /**
   * Equipment suffix (`L`, `Z`, `W`, …), joined onto the type on the strip as
   * `B738/L`. The house format is `src/lib/flightplan.ts`'s, because that is
   * what a member's own filed plan looks like and what a controller reads.
   */
  equipment: string;
  squawk: string;
  rules: "I" | "V";
  departure: string;
  destination: string;
  /** Filed cruise level, in feet as written on the strip (e.g. `33100`). */
  cruise: string;
  /** Filed TAS. */
  tas: string;
  /** Filed route. */
  route: string;
  remarks: string;
  /** Departure time, `HHMM`; blank for an aircraft already airborne. */
  departureTime: string;

  lat: number;
  lon: number;
  /** Feet. */
  altitude: number;
  /** Ground speed, knots. */
  speed: number;
  /** Degrees; packed into the `@N` line. */
  heading: number;

  /** `$ROUTE` — what the pseudopilot flies, which is not the filed route. */
  pseudoRoute: string;
  delayFrom: number;
  delayTo: number;
  /** `START:` minutes, or null to omit. */
  start: number | null;
  /** `REQALT::` feet, or null to omit. */
  requestAltitude: number | null;
  /** `INITIALPSEUDOPILOT:` callsign, or blank for `ALL`. */
  initialPseudopilot: string;
  /** Emit a `SIMDATA:` line for this aircraft. */
  simData: boolean;
  /**
   * Mistakes deliberately planted in this aircraft's plan, for the trainee to
   * find. Never written to the scenario — the file must look like any other —
   * but shown in the form so the instructor has an answer key.
   */
  errors: ScenarioErrorKind[];
}

export interface ScenarioModel {
  /** Which seats this scenario is written for; drives what traffic exists. */
  profiles: ScenarioProfile[];
  /** Which preset the counts came from, or `custom` once one has been edited. */
  traffic: TrafficLevel;
  /** How many aircraft each profile contributes. Always the number used. */
  counts: TrafficCounts;
  airport: string;
  /** Field elevation in feet; blank omits `AIRPORT_ALT`. */
  airportAlt: number | null;
  metar: string;
  controllers: ScenarioController[];
  /**
   * `INITIALPSEUDOPILOT:` for every aircraft that does not name its own.
   *
   * An aircraft with no such line belongs to `PSEUDOPILOT:ALL`, which means a
   * controller logging in has to take each one by hand before it will answer.
   * Naming a seat here hands the whole scenario to whoever signs in as it —
   * which is what a trainee opening their own session wants, and what the
   * hand-written approach sets do (`INITIALPSEUDOPILOT:ZUUU_03_APP` on all
   * sixteen inbounds). Blank keeps the old behaviour.
   */
  defaultPseudopilot: string;
  /** Runways whose `ILS` line should be written, in full. */
  ils: SweatboxRunway[];
  holdings: ScenarioHolding[];
  namedRoutes: ScenarioNamedRoute[];
  aircraft: ScenarioAircraft[];
}

/**
 * Filed TAS defaults, taken from the scenarios in `SweatBox/` rather than from
 * a performance table: the tower sets file 280 and the approach sets 420. The
 * number is what the strip shows, not what EuroScope flies, so matching the
 * existing material matters more than matching a manual.
 */
export const DEFAULT_TAS: Record<ScenarioProfile, string> = {
  GND: "280",
  TWR: "280",
  DEP: "280",
  APP: "420",
};

/** `SIMDATA:<callsign>:*:*:25:1:0.010`, verbatim from the ZUUU approach set. */
const SIMDATA_TAIL = "*:*:25:1:0.010";

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

const toRad = Math.PI / 180;
const toDeg = 180 / Math.PI;
const EARTH_NM = 3440.065;

/**
 * Pack a heading into the `@N` line's pbh field.
 *
 * FSD's pbh is `pitch(10) | bank(10) | heading(10) | onground(1)…`; with pitch
 * and bank zero the whole value is the heading in the low ten bits, shifted
 * left by two. See the header comment for why this is not the constant the
 * Python helper in `SweatBox/` uses.
 */
export function encodeHeading(headingDeg: number): number {
  const normalised = ((headingDeg % 360) + 360) % 360;
  return (Math.round((normalised / 360) * 1024) % 1024) * 4;
}

/** The inverse, so a hand-written scenario can be read back. */
export function decodeHeading(pbh: number): number {
  return Number(((((pbh >> 2) & 0x3ff) / 1024) * 360).toFixed(1));
}

/** Great-circle distance in nautical miles. */
export function distanceNm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = (bLat - aLat) * toRad;
  const dLon = (bLon - aLon) * toRad;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(aLat * toRad) * Math.cos(bLat * toRad) * Math.sin(dLon / 2) ** 2;
  return EARTH_NM * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Initial true bearing from one point to another, degrees. */
export function bearingTo(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const φ1 = aLat * toRad;
  const φ2 = bLat * toRad;
  const Δλ = (bLon - aLon) * toRad;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x =
    Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * toDeg + 360) % 360;
}

/**
 * Walk `distanceNm` along `bearing` from a point. This is what places an
 * arrival: pick the runway or a fix, give a distance and a radial, and the
 * aircraft appears there instead of on a coordinate somebody typed.
 */
export function destination(
  lat: number,
  lon: number,
  bearing: number,
  distanceNmValue: number,
): { lat: number; lon: number } {
  const δ = distanceNmValue / EARTH_NM;
  const θ = bearing * toRad;
  const φ1 = lat * toRad;
  const λ1 = lon * toRad;
  const φ2 = Math.asin(
    Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ),
  );
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * Math.sin(δ) * Math.cos(φ1),
      Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2),
    );
  return {
    lat: Number((φ2 * toDeg).toFixed(7)),
    lon: Number((((λ2 * toDeg + 540) % 360) - 180).toFixed(7)),
  };
}

/**
 * `23.380692` → `N023.22.50.491`.
 *
 * Degrees, minutes, seconds and *thousandths of a second* as four separate
 * dot-separated fields — the last group is not a decimal fraction of the
 * seconds, which is the trap when reading one of these by eye.
 */
export function toSctCoord(value: number, axis: "lat" | "lon"): string {
  const hemisphere =
    axis === "lat" ? (value < 0 ? "S" : "N") : value < 0 ? "W" : "E";
  const absolute = Math.abs(value);
  const degrees = Math.floor(absolute);
  const minutesFloat = (absolute - degrees) * 60;
  const minutes = Math.floor(minutesFloat);
  const secondsFloat = (minutesFloat - minutes) * 60;
  let seconds = Math.floor(secondsFloat);
  let milli = Math.round((secondsFloat - seconds) * 1000);

  // Rounding 999.6 thousandths up has to carry, or the file gets `.60.1000`.
  let carryMinutes = minutes;
  let carryDegrees = degrees;
  if (milli === 1000) {
    milli = 0;
    seconds += 1;
  }
  if (seconds === 60) {
    seconds = 0;
    carryMinutes += 1;
  }
  if (carryMinutes === 60) {
    carryMinutes = 0;
    carryDegrees += 1;
  }

  const pad = (n: number, width: number) => String(n).padStart(width, "0");
  return (
    `${hemisphere}${pad(carryDegrees, axis === "lat" ? 3 : 3)}` +
    `.${pad(carryMinutes, 2)}.${pad(seconds, 2)}.${pad(milli, 3)}`
  );
}

// ---------------------------------------------------------------------------
// Builder
// ---------------------------------------------------------------------------

const pad = (n: number, width: number) =>
  String(Math.trunc(n)).padStart(width, "0");

/** A blank aircraft, so the form and the builder agree on every default. */
export function emptyAircraft(profile: ScenarioProfile): ScenarioAircraft {
  const onGround = profile === "GND";
  const arriving = profile === "APP" || profile === "TWR";
  return {
    profile,
    callsign: "",
    type: "B738",
    equipment: "L",
    squawk: onGround ? "2000" : "0001",
    rules: "I",
    departure: "",
    destination: "",
    cruise: arriving ? "0" : "33100",
    tas: DEFAULT_TAS[profile],
    route: "",
    remarks: onGround ? "/v/" : "",
    departureTime: onGround ? "0000" : "",
    lat: 0,
    lon: 0,
    altitude: 0,
    speed: 0,
    heading: 0,
    pseudoRoute: "",
    // Ground movements can come alive close together; airborne traffic wants
    // spreading out, or the whole arrival stream checks in at once.
    delayFrom: onGround ? 3 : 7,
    delayTo: onGround ? 7 : 15,
    start: null,
    requestAltitude: null,
    initialPseudopilot: "",
    simData: !onGround,
    errors: [],
  };
}

/** A blank scenario, GND at the medium preset. */
export function emptyScenario(): ScenarioModel {
  return {
    profiles: ["GND"],
    traffic: "medium",
    counts: { ...TRAFFIC_COUNTS.medium },
    airport: "",
    airportAlt: null,
    metar: "",
    controllers: [],
    defaultPseudopilot: "",
    ils: [],
    holdings: [],
    namedRoutes: [],
    aircraft: [],
  };
}

// ---------------------------------------------------------------------------
// The seats a scenario expects staffed
// ---------------------------------------------------------------------------

/**
 * Which seat each profile is worked from, and the frequency to start it on.
 *
 * `DEP` shares the tower's seat rather than getting a `_DEP` of its own: the
 * departures are written at the runway threshold, so the exercise begins with a
 * take-off clearance, and no package here publishes a `_DEP` position anyway.
 *
 * The frequencies are **defaults to be corrected, not data**. Nothing in the
 * tree publishes a position's frequency — can-db carries the airport, its
 * runways, its stands and its procedures, and no `[POSITIONS]` block — so these
 * are the commonest values in the hand-written sets (118.100 is ZGGG's and
 * ZPPP's tower) and the form leaves every one of them editable. An instructor
 * writing a scenario for their own field will know the real ones.
 */
const SEAT_FOR_PROFILE: Record<
  ScenarioProfile,
  { suffix: string; frequency: string }
> = {
  GND: { suffix: "_GND", frequency: "121.600" },
  TWR: { suffix: "_TWR", frequency: "118.100" },
  DEP: { suffix: "_TWR", frequency: "118.100" },
  APP: { suffix: "_APP", frequency: "119.100" },
};

/**
 * The `CONTROLLER:` lines a scenario for these seats starts with.
 *
 * One per ticked profile, deduplicated — GND+TWR+DEP is two seats, not three —
 * and in the declared profile order so the same ticks always produce the same
 * list.
 */
export function defaultControllers(
  icao: string,
  profiles: readonly ScenarioProfile[],
): ScenarioController[] {
  const field = icao.trim().toUpperCase();
  if (!field) return [];
  const seats: ScenarioController[] = [];
  const seen = new Set<string>();
  for (const profile of SCENARIO_PROFILES) {
    if (!profiles.includes(profile)) continue;
    const seat = SEAT_FOR_PROFILE[profile];
    const callsign = field + seat.suffix;
    if (seen.has(callsign)) continue;
    seen.add(callsign);
    seats.push({ callsign, frequency: seat.frequency });
  }
  return seats;
}

/**
 * Which of those seats the traffic should start under.
 *
 * The busiest one ticked, reading the profiles in their declared order — an
 * APP scenario hands everything to approach, a ground-and-tower one to the
 * tower, a ground-only one to ground. That matches the hand-written sets, whose
 * `INITIALPSEUDOPILOT` is always the seat the scenario was written for.
 */
export function defaultPseudopilotFor(
  icao: string,
  profiles: readonly ScenarioProfile[],
): string {
  const seats = defaultControllers(icao, profiles);
  return seats.length ? seats[seats.length - 1].callsign : "";
}

// ---------------------------------------------------------------------------
// Magnetic variation
// ---------------------------------------------------------------------------

/**
 * Convert a published (magnetic) course into the true heading the `@N` line
 * wants.
 *
 * **Everything in the position packet's heading field is true.** That is FSD's
 * definition — a pilot client reports true heading and the controller's client
 * applies variation for display — and it is what the computed bearings in this
 * file already are. The sector packages are the other way round: runway courses
 * and stand headings are **magnetic**, because that is what is published.
 * Mixing the two in one field leaves a parked aircraft skew to its own stand
 * box by the whole variation, which at Beijing is nearly seven degrees.
 *
 * `variation` is the value **the sector file declares** — line 8 of the `.sct`
 * `[INFO]` block, west positive — not NavData's per-airport figure. EuroScope
 * applies one variation for the whole file, so that is the only number that
 * cancels: writing a scenario against a more locally accurate value still
 * lands a degree or two out. ZGZU declares 3.3 where NavData has ZGGG at −3,
 * ZBPE declares 6.8 where NavData has ZBAA at −8.
 *
 * The direction comes from the geometry rather than from a convention: the
 * true bearing between ZGGG 01L's two thresholds is 13.9° against a published
 * course of 17°, and 13.9 + 3.3 = 17.2. So `magnetic = true + variation`, and
 * this is its inverse. A null variation leaves the value alone rather than
 * guessing — a visible few degrees of skew beats a silently wrong direction.
 */
export function magneticToTrue(
  magneticDeg: number,
  variation: number | null,
): number {
  if (variation === null || !Number.isFinite(variation)) return magneticDeg;
  // Rounded: the variation is given to a tenth, and an unrounded result puts
  // `13.699999999999989` in front of an instructor for no benefit — the ten-bit
  // pbh field cannot carry more than a third of a degree anyway.
  return Number(((((magneticDeg - variation) % 360) + 360) % 360).toFixed(1));
}

// ---------------------------------------------------------------------------
// Deliberate mistakes
// ---------------------------------------------------------------------------

/**
 * A mistake planted in a flight plan for the trainee to catch.
 *
 * These are not invented. `SweatBox/场面模拟机文本/ZBYN/ZBYN_TWR说明(通用).txt`
 * lists its problem crews and what is wrong with each — "ACA1119航路
 * CBJ9621机型 CCA1013机场 CSN3099高度 CSZ5036航高航路机型飞行规则" — so the
 * five kinds below are the ones the network's own instructors plant, and one
 * aircraft carrying four of them at once is a shape the material already has.
 *
 * Checking a plan is most of what a clearance controller does, and a scenario
 * where every plan is correct trains someone to wave everything through.
 */
export type ScenarioErrorKind =
  /** A route that does not connect to the field or wanders off the airways. */
  | "route"
  /** A level from the wrong semicircular table, or not a level at all. */
  | "altitude"
  /** A type the airline does not fly, or one that cannot make the runway. */
  | "type"
  /** A destination that does not match the route. */
  | "airport"
  /** VFR filed for a flight that has to be IFR. */
  | "rules";

export const SCENARIO_ERROR_KINDS: readonly ScenarioErrorKind[] = [
  "route",
  "altitude",
  "type",
  "airport",
  "rules",
];

// ---------------------------------------------------------------------------
// Stream spacing
// ---------------------------------------------------------------------------

/**
 * Minutes between consecutive aircraft in each profile's stream.
 *
 * A scenario's difficulty is mostly its spacing, so these are the numbers an
 * instructor reaches for first — and they are the ones the network's own
 * instructors gave: arrivals to the tower every 4 to 10 minutes and never
 * closer than 4, approach arrivals every 5, departures every 4 to 5.
 *
 * They are emitted as `START:` — the aircraft's activation time in minutes
 * from the start of the scenario, cumulative down the stream. That is what the
 * hand-written scenarios use it for and the shape is unmistakable in them:
 * ZSOF runs 5, 10, 15 … 45 and ZGOW 4.5, 9, 13.5, 18.
 *
 * **`DELAY:` is not this.** Every aircraft in those files carries the same
 * `DELAY:3:7` while only some carry a `START:`, and 45 aircraft cannot all
 * appear inside a four-minute window — so `DELAY` is the wait before the
 * aircraft calls, not when it enters. Putting the schedule there would
 * collapse the whole stream into one burst.
 */
export interface Spacing {
  /** Minutes; the low end of the gap to the aircraft ahead. */
  min: number;
  /** Minutes; the high end. Equal to `min` for a metronome. */
  max: number;
}

export const DEFAULT_SPACING: Record<ScenarioProfile, Spacing> = {
  GND: { min: 4, max: 5 },
  TWR: { min: 4, max: 10 },
  DEP: { min: 4, max: 5 },
  APP: { min: 5, max: 5 },
};

// ---------------------------------------------------------------------------
// Cruise levels
// ---------------------------------------------------------------------------

/**
 * Chinese RVSM cruising levels, in the feet a flight plan is filed in.
 *
 * China's cruising levels are **metric**, and these foot figures are the
 * published conversions of them — which is why they end in 100 rather than
 * 000: 9800 m is filed as 32100 ft, 10100 m as 33100 ft, and so on in 300 m
 * steps. A level ending 000 on a strip over China is somebody filing feet
 * directly; that happens and is not wrong, but it is not the domestic table,
 * and a scenario built on it teaches the wrong readback.
 *
 * The split is the semicircular rule on **magnetic track**: 000–179 takes one
 * set, 180–359 the other. This is not decoration — the hand-written scenarios
 * in `SweatBox/` follow it exactly (ZGGG→ZSJN files 33100 north-eastbound,
 * ZGGG→ZJHK files 32100 south-westbound), and a scenario that ignores it puts
 * every strip on a level the trainee should be querying.
 *
 * Both lists are ordered low to high, so an index into them scales with
 * distance: a 60 NM hop does not file FL410.
 */
export const CRUISE_LEVELS_EAST = [
  29100, 31100, 33100, 35100, 37100, 39100, 41100,
] as const;
export const CRUISE_LEVELS_WEST = [
  30100, 32100, 34100, 36100, 38100, 40100,
] as const;

/**
 * Pick a filed cruise level for a leg.
 *
 * `spread` shifts within the band so a whole arrival stream is not stacked on
 * one level; it is the aircraft's index, not a random number, so the result
 * stays reproducible.
 */
export function cruiseLevelFor(
  trackDeg: number,
  legNm: number,
  spread = 0,
): number {
  const track = ((trackDeg % 360) + 360) % 360;
  const band = track < 180 ? CRUISE_LEVELS_EAST : CRUISE_LEVELS_WEST;

  // Distance bands rather than a formula: the step from one level to the next
  // is a judgement about what a flight of that length files, and a formula
  // would only dress the judgement up. Calibrated against the levels the
  // hand-written scenarios actually carry, where a ~900 NM domestic sector
  // (ZGGG–ZBAA and the like) files 10100 m / 33100 ft more than anything else.
  const step =
    legNm < 250 ? 0 : legNm < 600 ? 1 : legNm < 1100 ? 2 : legNm < 1800 ? 3 : 4;

  // One below, the centre, one above, cycling by aircraft — a whole arrival
  // stream on a single level is the thing this is here to avoid, and using the
  // index rather than the PRNG keeps the scenario reproducible.
  const jitter = (spread % 3) - 1;
  const at = Math.min(band.length - 1, Math.max(0, step + jitter));
  return band[at];
}

// ---------------------------------------------------------------------------
// Traffic composition
// ---------------------------------------------------------------------------

export interface TrafficOptions {
  airport: SweatboxAirport;
  profiles: ScenarioProfile[];
  counts: TrafficCounts;
  /** The runway arrivals land on — TWR and APP are placed against it. */
  arrivalRunway: SweatboxRunway;
  /** The runway departures use — DEP is placed off its upwind end. */
  departureRunway: SweatboxRunway;
  /** Airline ICAO prefixes; callsigns are drawn from these in rotation. */
  airlines: string[];
  /** ICAO types; anything without a performance block is dropped. */
  types: string[];
  /** The other end of every flight: where GND/DEP go, where TWR/APP came from. */
  partners: string[];
  /**
   * Filed cruise level, when the instructor wants one level for everything.
   * Blank is the normal case: each leg then gets the Chinese semicircular
   * level for its own track and length.
   */
  cruise: string;
  /** `$ROUTE` written on ground movements. */
  taxiRoute: string;
  /** Bearings from the field that APP arrivals are placed on, cycled. */
  arrivalRadials: number[];
  /** Same seed, same scenario — an instructor can rerun a session verbatim. */
  seed: number;
  /**
   * can-db's plans, keyed `FROM-TO`. Absent or missing a pair, that aircraft
   * files the bare destination — still a loadable scenario, just one with
   * nothing on the route field.
   *
   * Both directions are separate keys and both are needed: a departure asks
   * for `airport → partner`, an arrival for `partner → airport`, and with a
   * third of the network one-way they are not each other's reverse.
   */
  routes?: Record<string, SweatboxRoutePlan | null>;
  /** ICAO → [lat, lon], for the legs that leave the sector packages' area. */
  airportCoords?: Record<string, [number, number]>;
  /**
   * Equipment suffix appended to the type (`B738/L`). The house format keeps
   * it inside the aircraft field — see `src/lib/flightplan.ts`.
   */
  equipment?: string;
  /** Minutes between consecutive aircraft, per profile. */
  spacing?: Partial<Record<ScenarioProfile, Spacing>>;
  /**
   * Every fix in the FIR, so a SID or STAR point can be located. Without it
   * the whole procedure is flown from its first point, which sends an arrival
   * already on final back out to the start of the STAR.
   */
  fixes?: SweatboxFix[];
  /** Share of aircraft given a deliberate mistake, 0 to 1. */
  errorRate?: number;
  /** Which mistakes may be handed out. Empty means all of them. */
  errorKinds?: ScenarioErrorKind[];
}

/** Codes that mean something to a controller and must never be handed out. */
const RESERVED_SQUAWKS = new Set([
  "7500",
  "7600",
  "7700",
  "2000",
  "1200",
  "0000",
]);

/**
 * A three-degree glide is 318 ft per nautical mile. Arrivals on final are
 * placed on it rather than at a flat altitude, because a row of aircraft all
 * at 3000 ft two miles apart is not a picture a tower controller ever sees.
 */
const FEET_PER_NM_ON_GLIDE = 318;

/**
 * Choose `count` stands spread across the field rather than the first `count`
 * in the list.
 *
 * The ground plugin lists stands by apron, so taking a slice fills one pier
 * and leaves the rest of the airport empty — which is the opposite of a ground
 * exercise, where the point is that the movements *conflict*. Twenty aircraft
 * on one pier all push into the same taxiway in the same direction; twenty
 * spread across the field give a trainee crossings to sequence.
 *
 * Farthest-point sampling: start somewhere random, then repeatedly take the
 * stand furthest from everything already taken. Random start (from the seeded
 * PRNG) so two scenarios at the same airport are not the same twenty stands;
 * farthest-point after that so the result is spread rather than merely
 * shuffled — a plain shuffle clusters as often as not.
 */
export function pickDispersedStands(
  stands: SweatboxStand[],
  count: number,
  random: () => number,
): SweatboxStand[] {
  const wanted = Math.min(count, stands.length);
  if (wanted <= 0) return [];
  if (wanted === stands.length) return stands.slice();

  const chosen: SweatboxStand[] = [
    stands[Math.floor(random() * stands.length)],
  ];
  // Distance to the nearest already-chosen stand, maintained incrementally so
  // this is O(n · count) rather than O(n · count²).
  const nearest = stands.map((stand) =>
    distanceNm(stand.lat, stand.lon, chosen[0].lat, chosen[0].lon),
  );

  while (chosen.length < wanted) {
    let bestAt = -1;
    let bestNm = -1;
    for (let at = 0; at < stands.length; at++) {
      if (nearest[at] > bestNm) {
        bestNm = nearest[at];
        bestAt = at;
      }
    }
    if (bestAt < 0) break;
    const pick = stands[bestAt];
    chosen.push(pick);
    nearest[bestAt] = -1;
    for (let at = 0; at < stands.length; at++) {
      if (nearest[at] < 0) continue;
      const nm = distanceNm(stands[at].lat, stands[at].lon, pick.lat, pick.lon);
      if (nm < nearest[at]) nearest[at] = nm;
    }
  }
  return chosen;
}

/** Small deterministic PRNG; `Math.random` would make a scenario unrepeatable. */
function seeded(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return ((state >>> 0) % 100000) / 100000;
  };
}

/**
 * Compose the traffic for the ticked profiles.
 *
 * Pure, and deliberately not inside the component: this is the part with real
 * decisions in it — where an arrival sits on the glide, how far upwind a
 * departure has climbed, which stands are free — and it is the part worth
 * being able to check without a browser.
 *
 * Each profile is laid out from the runway or the apron outwards, spaced so
 * that the result is a stream rather than a formation. Callsigns and squawks
 * are unique across the whole scenario, not per profile, because EuroScope
 * keys on the callsign and a duplicate silently replaces the earlier aircraft.
 */
export function generateTraffic(options: TrafficOptions): ScenarioAircraft[] {
  const {
    airport,
    profiles,
    counts,
    arrivalRunway,
    departureRunway,
    cruise,
    taxiRoute,
    seed,
  } = options;

  const airlines = options.airlines.filter(Boolean);
  const types = options.types.filter((type) => type in PERFORMANCE);
  const partners = options.partners.filter(Boolean);
  if (!airlines.length || !types.length) return [];

  const random = seeded(seed);
  // Only `REQALT` uses this now. Aircraft on the ground are written at 0 and
  // let `AIRPORT_ALT` place them; see the header comment.
  const elevation = airport.elev ?? 0;
  const usedCallsigns = new Set<string>();
  const usedSquawks = new Set<string>(RESERVED_SQUAWKS);
  let squawkCursor = 1;

  const nextCallsign = (index: number): string => {
    for (let attempt = 0; attempt < 500; attempt++) {
      const airline = airlines[(index + attempt) % airlines.length];
      const number = 1000 + Math.floor(random() * 8999);
      const callsign = `${airline}${number}`;
      if (!usedCallsigns.has(callsign)) {
        usedCallsigns.add(callsign);
        return callsign;
      }
    }
    const fallback = `${airlines[0]}${9000 + usedCallsigns.size}`;
    usedCallsigns.add(fallback);
    return fallback;
  };

  const nextSquawk = (): string => {
    while (squawkCursor < 7777) {
      const code = String(squawkCursor++).padStart(4, "0");
      // Squawks are octal — a digit above 7 is not a code a transponder can set.
      if (!/[89]/.test(code) && !usedSquawks.has(code)) {
        usedSquawks.add(code);
        return code;
      }
    }
    return "0001";
  };

  const clamp = (value: number, low: number, high: number) =>
    Math.min(high, Math.max(low, value));

  // ---- flight planning -----------------------------------------------------

  const coords = options.airportCoords ?? {};

  /** can-db's plan for one direction of one city pair. */
  const routeFor = (from: string, to: string): SweatboxRoutePlan | null =>
    options.routes?.[`${from}-${to}`] ?? null;

  /** A published procedure by name, out of what this field publishes. */
  const byName = (
    list: SweatboxProcedure[],
    name: string,
  ): SweatboxProcedure | null =>
    name ? (list.find((entry) => entry.name === name) ?? null) : null;

  /**
   * The enroute part of a plan — what goes on the strip.
   *
   * can-db writes a filable route: `SID … airways and fixes … STAR`. The
   * scenario house style names neither. The SID is derived by EuroScope from
   * the departure runway, and the arrival's STAR is written at the end with
   * the landing runway attached (`IGNAK9J/02R`), so both ends are stripped
   * here and the arrival's is put back in the form the scenarios use.
   *
   * Matched by name rather than by position: a plan whose field publishes no
   * usable procedure has an empty `sid`/`star`, and blindly dropping the first
   * and last token would then eat two enroute fixes.
   */
  const enrouteOf = (plan: SweatboxRoutePlan): string => {
    const parts = plan.route.trim().split(/\s+/).filter(Boolean);
    if (plan.sid && parts[0] === plan.sid) parts.shift();
    if (plan.star && parts.at(-1) === plan.star) parts.pop();
    return parts.join(" ");
  };
  const equipment = options.equipment ?? "";

  const locate = (icao: string): [number, number] | null =>
    icao === airport.icao ? [airport.lat, airport.lon] : (coords[icao] ?? null);

  /** The procedure for this runway whose open end points nearest `bearing`. */
  const pickProcedure = (
    list: SweatboxProcedure[],
    runwayId: string,
    bearing: number,
    end: "first" | "last",
  ): SweatboxProcedure | null => {
    const forRunway = list.filter((entry) => entry.runway === runwayId);
    if (!forRunway.length) return null;
    if (!fixIndex.size) return forRunway[0];

    let best: SweatboxProcedure | null = null;
    let bestOff = Infinity;
    for (const entry of forRunway) {
      const name = end === "last" ? entry.points.at(-1) : entry.points[0];
      const node = name ? fixIndex.get(name) : undefined;
      if (!node) continue;
      const to = bearingTo(airport.lat, airport.lon, node[0], node[1]);
      const off = Math.abs(((to - bearing + 540) % 360) - 180);
      if (off < bestOff) {
        bestOff = off;
        best = entry;
      }
    }
    return best ?? forRunway[0];
  };

  /**
   * Build the filed route and the level that goes with it.
   *
   * A departure starts at its SID's exit fix and runs the airways towards the
   * destination; an arrival runs them inbound and ends with the STAR name and
   * the landing runway. The SID is deliberately *not* named — EuroScope
   * derives it from the departure runway, and the hand-written scenarios do
   * the same.
   */
  const planFor = (
    row: ScenarioAircraft,
    outbound: boolean,
    spread: number,
    /** The arrival the aircraft was already placed on, when it was. */
    chosenStar?: SweatboxProcedure | null,
  ): void => {
    const otherEnd = outbound ? row.destination : row.departure;
    const other = locate(otherEnd);
    row.route = otherEnd;

    if (other) {
      const track = outbound
        ? bearingTo(airport.lat, airport.lon, other[0], other[1])
        : bearingTo(other[0], other[1], airport.lat, airport.lon);
      const legNm = distanceNm(airport.lat, airport.lon, other[0], other[1]);
      row.cruise = options.cruise.trim()
        ? options.cruise.trim()
        : String(cruiseLevelFor(track, legNm, spread));

      if (outbound) {
        const plan = routeFor(airport.icao, otherEnd);
        // **can-db chose the SID, not this file.** It picks by search — every
        // SID whose last point reaches the airway network is a candidate edge,
        // so the one that wins is the one that actually shortens the journey.
        // Picking locally by bearing sent ZGGG departures out on AGVIL1 (south
        // west) towards Beijing; see `SweatboxRoutePlan`.
        //
        // `pickProcedure` survives as the fallback for a pair can-db could not
        // plan, and only then — it is the runway-correct choice, which is the
        // property worth keeping when there is no plan to defer to.
        const sid =
          (plan && byName(airport.sids, plan.sid)) ??
          pickProcedure(airport.sids, departureRunway.id, track, "last");
        if (plan) row.route = enrouteOf(plan) || row.route;
        // What the pseudopilot flies is the SID, picked up from wherever the
        // aircraft already is — not the filed route, which starts where the
        // SID ends.
        if (sid) {
          const tail = procedureTail(sid.points, row.lat, row.lon, row.heading);
          row.pseudoRoute = [taxiRoute.trim(), ...tail]
            .filter(Boolean)
            .join(" ");
        }
      } else {
        const plan = routeFor(otherEnd, airport.icao);
        // Placement may already have committed to an arrival; reusing it is
        // what keeps the strip, the position and the $ROUTE telling one story.
        // Placement itself now takes the STAR out of this same plan, so the
        // two agree by construction rather than by coincidence.
        const star =
          chosenStar ??
          (plan && byName(airport.stars, plan.star)) ??
          pickProcedure(
            airport.stars,
            arrivalRunway.id,
            (track + 180) % 360,
            "first",
          );
        if (plan) row.route = enrouteOf(plan) || row.route;
        // `IGNAK9J/02R` — the STAR carries the runway it was drawn for.
        if (star) {
          row.route = `${row.route} ${star.name}/${arrivalRunway.id}`;
          // The STAR from the point the aircraft is nearest, then the ILS.
          // Handing it the whole procedure is what produced the direction
          // error: an aircraft already inside the terminal area would turn
          // round and fly back out to the STAR's entry fix first. The trailing
          // `FI…`/`CI…` intercept points are EuroScope's own and are replaced
          // by the ILS, exactly as the hand-written approach sets do.
          const tail = procedureTail(
            star.points,
            row.lat,
            row.lon,
            row.heading,
          ).filter((point) => !/^(FI|CI)/.test(point));
          row.pseudoRoute = [...tail, `ILS${arrivalRunway.id}`].join(" ");
        }
      }
    }

    // An arrival's filed level is history by the time it is on the STAR; the
    // hand-written approach sets file 0 for exactly that reason.
    if (!outbound) row.cruise = "0";
  };

  /**
   * Plant a mistake in a finished plan.
   *
   * It runs **after** everything else is set, so the wrong value replaces a
   * right one rather than being overwritten by it — and it only touches the
   * filed plan (`$FP`), never the position or the `$ROUTE`. That separation is
   * the point: the aircraft must still fly sensibly, or the exercise stops
   * being "spot the bad plan" and becomes "watch an aeroplane misbehave".
   */
  const errorKinds = options.errorKinds?.length
    ? options.errorKinds
    : SCENARIO_ERROR_KINDS;
  const errorRate = Math.min(1, Math.max(0, options.errorRate ?? 0));

  const plantError = (row: ScenarioAircraft, outbound: boolean): void => {
    if (errorRate <= 0 || random() >= errorRate) return;
    const kind = errorKinds[Math.floor(random() * errorKinds.length)];
    switch (kind) {
      case "route": {
        // Cut the middle out: drop one airway designator so the two fixes it
        // joined end up side by side with nothing connecting them.
        //
        //   YIN A461 ZHO B208 OBMEP   →   YIN A461 ZHO OBMEP
        //                                             └─ ZHO and OBMEP are
        //                                                not connected
        //
        // **This replaces truncating to the first point**, which is what it
        // used to do. A route reduced to one identifier is spotted without
        // reading it — the strip is visibly a stub, so the exercise tested
        // nothing but attention. With the middle cut out both halves read
        // perfectly on their own; what is wrong is that no airway joins the
        // pair in the seam, and finding that means walking the route against
        // the airway network, which is the skill the exercise is for.
        //
        // Airway designators sit between the fixes — `F0 A0 F1 A1 F2` — so
        // they are the odd indices, never the first or last token. Prefer one
        // that is not itself at either end, so a leg survives on both sides;
        // with fewer than three airways there is no such choice and any of
        // them will do.
        const parts = row.route.trim().split(/\s+/).filter(Boolean);
        const airwayAt: number[] = [];
        for (let i = 1; i < parts.length - 1; i += 2) airwayAt.push(i);
        // Nothing to cut — a route that is a bare destination, or a single
        // leg with no airway at all. **Plant nothing and record nothing**:
        // `errors` is the answer key the instructor is handed, so an entry
        // there for a plan that was never corrupted sends them hunting for a
        // mistake that is not in the file.
        if (!airwayAt.length) return;
        const choices = airwayAt.length > 2 ? airwayAt.slice(1, -1) : airwayAt;
        parts.splice(choices[Math.floor(random() * choices.length)], 1);
        row.route = parts.join(" ");
        break;
      }
      case "altitude": {
        // A level from the *other* semicircular table — legal-looking, wrong
        // direction. Arrivals file 0, so give those a level they cannot hold.
        const level = Number(row.cruise);
        row.cruise =
          Number.isFinite(level) && level > 0 ? String(level + 1000) : "3000";
        break;
      }
      case "type":
        // A type with no performance block: the strip looks ordinary and the
        // aircraft cannot do what the plan says.
        row.type = "C172";
        break;
      case "airport":
        // Destination swapped for the field itself — a plan that goes nowhere.
        if (outbound) row.destination = airport.icao;
        else row.departure = airport.icao;
        break;
      case "rules":
        row.rules = "V";
        break;
    }
    row.errors = [...row.errors, kind];
  };

  const aircraft: ScenarioAircraft[] = [];
  let ordinal = 0;

  const base = (profile: ScenarioProfile, index: number): ScenarioAircraft => {
    const row = emptyAircraft(profile);
    row.callsign = nextCallsign(ordinal++);
    row.type = types[index % types.length];
    row.equipment = equipment;
    row.tas = DEFAULT_TAS[profile];
    return row;
  };

  const partnerAt = (index: number) => partners[index % partners.length] ?? "";

  /** Procedure points that can be located, for trimming a SID or STAR. */
  const fixIndex = new Map<string, [number, number]>();
  for (const fix of options.fixes ?? []) {
    if (!fixIndex.has(fix.name)) fixIndex.set(fix.name, [fix.lat, fix.lon]);
  }

  /**
   * The part of a procedure that is still ahead of the aircraft.
   *
   * A SID or STAR is a whole track from the runway outwards or the boundary
   * inwards, but an aircraft is dropped into the middle of it — an arrival at
   * 25 NM is already past the first half of its STAR. Flying the procedure
   * from its first point would turn it round and send it back out, which is
   * the direction error. So the tail starts at whichever point the aircraft is
   * nearest.
   *
   * With no fix table the whole procedure is returned: for a parked departure
   * that is exactly right, and for anything airborne it is the old behaviour,
   * which is wrong but no worse than it was.
   */
  const procedureTail = (
    points: string[],
    lat: number,
    lon: number,
    heading?: number,
  ): string[] => {
    if (!fixIndex.size) return points.slice();

    let bestAt = 0;
    let bestNm = Infinity;
    let aheadAt = -1;
    let aheadNm = Infinity;

    points.forEach((name, at) => {
      const position = fixIndex.get(name);
      if (!position) return;
      const nm = distanceNm(lat, lon, position[0], position[1]);
      if (nm < bestNm) {
        bestNm = nm;
        bestAt = at;
      }
      if (heading === undefined) return;
      const off = Math.abs(
        ((bearingTo(lat, lon, position[0], position[1]) - heading + 540) %
          360) -
          180,
      );
      // Ahead of the wing line. The nearest point overall is very often the
      // one just *passed* — an aircraft interpolated a third of the way down a
      // leg is nearest the point behind it — and starting the route there is
      // an immediate 180° turn away from the field.
      if (off <= 90 && nm < aheadNm) {
        aheadNm = nm;
        aheadAt = at;
      }
    });

    return points.slice(aheadAt >= 0 ? aheadAt : bestAt);
  };

  /**
   * Put an aircraft on a procedure, roughly `wantNm` from the field, pointing
   * the way the procedure goes.
   *
   * The leg containing that distance is found first, then the aircraft is
   * interpolated along it, so the position is on the track rather than at the
   * nearest reporting point — twelve arrivals all sitting exactly on named
   * fixes looks like a diagram, not traffic. Heading is the bearing to the
   * next point, which is what makes the `$ROUTE` tail agree with where the
   * nose is.
   */
  /**
   * The start of a procedure: its first locatable point, facing the next one.
   *
   * Arrivals enter at the entry fix and departures leave from the threshold,
   * so nothing needs positioning *along* a track any more — the clock does the
   * spreading. Heading is the bearing to the following point, which is what
   * keeps the `$ROUTE` tail agreeing with where the nose is.
   */
  const procedureEntry = (
    points: string[],
  ): { lat: number; lon: number; heading: number } | null => {
    const located = points
      .map((name) => fixIndex.get(name))
      .filter((position): position is [number, number] => !!position);
    if (located.length < 2) return null;
    const [first, next] = located;
    return {
      lat: first[0],
      lon: first[1],
      heading: Math.round(bearingTo(first[0], first[1], next[0], next[1])),
    };
  };

  // Variation is the whole reason a parked aircraft used to sit skew on its
  // stand: the packages publish magnetic, the position packet wants true.
  const variation = airport.variation ?? null;
  const trueHeading = (magnetic: number) => magneticToTrue(magnetic, variation);

  /**
   * Cumulative `START:` times, one running clock per profile so the streams do
   * not have to interleave — a tower's arrivals and its departures are two
   * sequences, not one.
   */
  const clocks: Partial<Record<ScenarioProfile, number>> = {};
  const nextStart = (profile: ScenarioProfile): number | null => {
    const gap = options.spacing?.[profile] ?? DEFAULT_SPACING[profile];
    const low = Math.max(0, Math.min(gap.min, gap.max));
    const high = Math.max(low, Math.max(gap.min, gap.max));
    const running = clocks[profile];

    // The first aircraft is already there when the session opens; the rest
    // arrive one gap apart. Starting the clock at the gap instead would leave
    // a controller staring at an empty screen for the first four minutes.
    if (running === undefined) {
      clocks[profile] = 0;
      // `START:0` and no `START:` mean the same thing, and the hand-written
      // scenarios carry the line only on the aircraft that are staggered.
      // Null keeps the file readable: a `START:` in it is a deliberate wait.
      return null;
    }

    const at = running + low + random() * (high - low);
    clocks[profile] = at;
    return Number(at.toFixed(1));
  };

  // GND — on the apron, engines off, spread across the field rather than
  // packed onto one pier. See `pickDispersedStands` for why that matters.
  if (profiles.includes("GND")) {
    const wanted = clamp(counts.GND, 0, MAX_PER_PROFILE);
    const stands = pickDispersedStands(airport.stands, wanted, random);
    stands.forEach((stand, index) => {
      const row = base("GND", index);
      row.squawk = "2000";
      row.departure = airport.icao;
      row.destination = partnerAt(index);
      row.lat = stand.lat;
      row.lon = stand.lon;
      // No heading: nothing in the tree publishes which way a stand faces, and
      // the field that looked like it was a wingspan — see `SweatboxStand`. A
      // north-facing row of aeroplanes is visibly a default; 88 of them all at
      // 30° was a default wearing the costume of data. The column is editable
      // per aircraft for an instructor who wants the apron to look right.
      row.heading = 0;
      row.altitude = 0;
      row.speed = 0;
      row.pseudoRoute = taxiRoute;
      row.start = nextStart("GND");
      planFor(row, true, index);
      plantError(row, true);
      aircraft.push(row);
    });
  }

  // TWR — on final, on the glide, closing up towards the threshold.
  if (profiles.includes("TWR")) {
    const wanted = clamp(counts.TWR, 0, MAX_PER_PROFILE);
    const reciprocal = (arrivalRunway.hdg + 180) % 360;
    for (let index = 0; index < wanted; index++) {
      const distance = 3 + index * 2.2;
      const placed = destination(
        arrivalRunway.lat,
        arrivalRunway.lon,
        reciprocal,
        distance,
      );
      const row = base("TWR", index);
      row.squawk = nextSquawk();
      row.departure = partnerAt(index);
      row.destination = airport.icao;
      row.cruise = "0";
      row.lat = placed.lat;
      row.lon = placed.lon;
      row.altitude = Math.round(elevation + distance * FEET_PER_NM_ON_GLIDE);
      row.speed = distance < 6 ? 150 : 170;
      row.heading = Math.round(
        bearingTo(placed.lat, placed.lon, arrivalRunway.lat, arrivalRunway.lon),
      );
      row.pseudoRoute = `ILS${arrivalRunway.id}`;
      row.requestAltitude = elevation;
      row.start = nextStart("TWR");
      planFor(row, false, index);
      plantError(row, false);
      aircraft.push(row);
    }
  }

  // DEP — at the departure runway threshold, ready to roll.
  //
  // An earlier version strung these out along the upwind already airborne, on
  // the reasoning that eleven aircraft stacked on one holding point is not a
  // scenario. That reasoning was wrong because it ignored the clock: they are
  // spaced four to five minutes apart by `START`, so the second one arrives
  // long after the first has gone. Starting at the threshold is what a
  // departure exercise actually is — the trainee clears each one for take-off
  // and works it from the roll, rather than inheriting an aeroplane already
  // 20 NM out and climbing.
  if (profiles.includes("DEP")) {
    const wanted = clamp(counts.DEP, 0, MAX_PER_PROFILE);
    for (let index = 0; index < wanted; index++) {
      const row = base("DEP", index);
      row.squawk = nextSquawk();
      row.departure = airport.icao;
      row.destination = partnerAt(index);
      row.cruise = cruise;
      row.lat = departureRunway.lat;
      row.lon = departureRunway.lon;
      row.altitude = 0;
      row.speed = 0;
      row.heading = trueHeading(departureRunway.hdg);
      row.start = nextStart("DEP");
      planFor(row, true, index);
      plantError(row, true);
      aircraft.push(row);
    }
  }

  // APP — inbound at level, **on a published arrival**.
  //
  // The first version put these on plain radials out of the field and then
  // chose a STAR separately, by the bearing to where they had come from. The
  // two need not agree, and when they did not the aircraft was left off to one
  // side of its own arrival with the nearest STAR point *behind* it — up to
  // 163° behind, so the pseudopilot's first move was a turn away from the
  // field. Placing them along the STAR instead makes the geometry true by
  // construction: an arrival is where an arrival would be, pointing where the
  // procedure points, and its `$ROUTE` is simply the rest of the way in.
  if (profiles.includes("APP")) {
    const wanted = clamp(counts.APP, 0, MAX_PER_PROFILE);

    // One entry per distinct STAR for the landing runway, so several streams
    // come in from different directions rather than in one long trail.
    const seenStars = new Set<string>();
    let streams = airport.stars.filter(
      (star) =>
        star.runway === arrivalRunway.id &&
        !seenStars.has(star.name) &&
        (seenStars.add(star.name), true),
    );

    // `arrivalRadials` keeps its meaning as a *preference*: the arrivals the
    // instructor wants traffic on. It selects among published procedures now
    // rather than inventing a bearing of its own.
    // Four arrivals is a fan a controller can hold in their head; twenty is a
    // list. The rest of the published procedures are still there to be picked
    // by hand on any individual aircraft.
    const MAX_STREAMS = 4;

    if (options.arrivalRadials.length && streams.length > 1) {
      const wantBearing = (star: SweatboxProcedure) => {
        const entry = fixIndex.get(star.points[0]);
        return entry
          ? bearingTo(airport.lat, airport.lon, entry[0], entry[1])
          : null;
      };
      const preferred = streams.filter((star) => {
        const bearing = wantBearing(star);
        if (bearing === null) return false;
        return options.arrivalRadials.some(
          (radial) => Math.abs(((bearing - radial + 540) % 360) - 180) <= 45,
        );
      });
      if (preferred.length) streams = preferred;
    }
    streams = streams.slice(0, MAX_STREAMS);

    for (let index = 0; index < wanted; index++) {
      const row = base("APP", index);
      row.squawk = nextSquawk();
      row.departure = partnerAt(index);
      row.destination = airport.icao;
      row.cruise = "0";
      row.speed = 260;
      row.requestAltitude = elevation;

      // At the **entry point** of the arrival, not somewhere along it.
      //
      // Like the departures at the threshold, these are separated by the clock
      // rather than by distance: five minutes apart down the same procedure is
      // a sequence to build, and it starts where the arrival starts. Spreading
      // them along the track instead hands the trainee a picture they did not
      // create and cannot have caused.
      row.altitude = APP_ENTRY_ALTITUDE;

      // **The arrival flies the STAR can-db planned for its own city pair.**
      //
      // Which is also what makes several streams: each aircraft carries a
      // different partner, and a route in from Kunming does not arrive on the
      // same procedure as one from Seoul. The fan comes out of where the
      // traffic is actually from rather than out of a list sliced four deep.
      //
      // The consequence to know: `arrivalRadials` — the instructor's stated
      // preference for which directions arrivals come from — only steers the
      // fallback below. When can-db has a plan, the direction is decided by
      // the partner airport, and changing the radials will not move it. Pick
      // the partners instead.
      const plan = routeFor(row.departure, airport.icao);
      const star =
        (plan && byName(airport.stars, plan.star)) ??
        (streams.length ? streams[index % streams.length] : null);
      const placed = star ? procedureEntry(star.points) : null;

      if (placed) {
        row.lat = placed.lat;
        row.lon = placed.lon;
        row.heading = placed.heading;
      } else {
        // No published arrival for this runway: come in on a radial, which is
        // at least inbound even if it is not a procedure.
        const radial = options.arrivalRadials.length
          ? options.arrivalRadials[index % options.arrivalRadials.length]
          : (arrivalRunway.hdg + 180) % 360;
        const point = destination(airport.lat, airport.lon, radial, 40);
        row.lat = point.lat;
        row.lon = point.lon;
        row.heading = Math.round(
          bearingTo(point.lat, point.lon, airport.lat, airport.lon),
        );
      }

      row.pseudoRoute = `ILS${arrivalRunway.id}`;
      row.start = nextStart("APP");
      planFor(row, false, index, star);
      plantError(row, false);
      aircraft.push(row);
    }
  }

  return aircraft;
}

/**
 * Format the `ILS` header line for a runway.
 *
 * Both forms in the existing scenarios are correct and EuroScope takes either:
 * threshold plus magnetic course, or threshold plus the opposite threshold in
 * decimal degrees. The four-coordinate form is written here because it needs
 * no magnetic variation to be right — the course form silently draws the
 * centreline a couple of degrees off wherever the sector package's published
 * course and the current variation have drifted apart.
 */
export function ilsLine(runway: SweatboxRunway): string {
  return (
    `ILS${runway.id}:${runway.lat.toFixed(7)}:${runway.lon.toFixed(7)}` +
    `:${runway.endLat.toFixed(7)}:${runway.endLon.toFixed(7)}`
  );
}

/** The `$FP` flight-plan record. Seventeen fields, all positional. */
function flightPlanLine(aircraft: ScenarioAircraft): string {
  return [
    `$FP${aircraft.callsign}`,
    "*A",
    aircraft.rules,
    joinAircraft(aircraft.type, aircraft.equipment),
    aircraft.tas,
    aircraft.departure,
    aircraft.departureTime,
    aircraft.departureTime,
    aircraft.cruise,
    aircraft.destination,
    "00",
    "00",
    "0",
    "0",
    "",
    aircraft.remarks,
    aircraft.route,
  ].join(":");
}

/** The `@N` position record. Nine values after the mode; see the header. */
function positionLine(aircraft: ScenarioAircraft): string {
  return [
    "@N",
    aircraft.callsign,
    aircraft.squawk,
    "1",
    toSctCoord(aircraft.lat, "lat"),
    toSctCoord(aircraft.lon, "lon"),
    String(Math.round(aircraft.altitude)),
    String(Math.round(aircraft.speed)),
    String(encodeHeading(aircraft.heading)),
    "0",
  ].join(":");
}

/**
 * Emit the scenario.
 *
 * CRLF, because this is a Windows file read by a Windows program and every
 * scenario in `SweatBox/` is already CRLF. EuroScope copes with LF, but a file
 * that differs from its neighbours invites somebody to "fix" it in an editor
 * that then rewrites the whole thing.
 */
export function buildScenario(model: ScenarioModel): string {
  const lines: string[] = [];

  lines.push("PSEUDOPILOT:ALL");
  lines.push("");

  if (model.airportAlt !== null && Number.isFinite(model.airportAlt)) {
    lines.push(`AIRPORT_ALT:${model.airportAlt.toFixed(1)}`);
    lines.push("");
  }

  if (model.ils.length) {
    for (const runway of model.ils) lines.push(ilsLine(runway));
    lines.push("");
  }

  if (model.holdings.length) {
    for (const holding of model.holdings) {
      lines.push(
        `HOLDING:${holding.fix}:${pad(holding.inbound, 3)}:${holding.turn}`,
      );
    }
    lines.push("");
  }

  if (model.metar.trim()) {
    lines.push(`METAR:${model.metar.trim()}`);
    lines.push("");
  }

  for (const controller of model.controllers) {
    if (!controller.callsign.trim()) continue;
    lines.push("PSEUDOPILOT:ALL");
    lines.push(`CONTROLLER:${controller.callsign}:${controller.frequency}`);
  }
  if (model.controllers.length) lines.push("");

  for (const route of model.namedRoutes) {
    if (!route.name.trim()) continue;
    lines.push(`ROUTE:${route.name}:${route.points}`);
  }
  if (model.namedRoutes.length) lines.push("");

  // Only the types actually flown. A PERFAC block for an absent type is
  // harmless; a *missing* one drops the aircraft onto EuroScope's generic
  // model, which climbs and descends nothing like the airframe on the strip.
  const types = [...new Set(model.aircraft.map((aircraft) => aircraft.type))]
    .filter((type) => type in PERFORMANCE)
    .sort();
  for (const type of types) {
    lines.push(`PERFAC:${type}`);
    for (const row of PERFORMANCE[type]) lines.push(`PERFLINE:${row}`);
    lines.push("");
  }

  for (const aircraft of model.aircraft) {
    if (!aircraft.callsign.trim()) continue;
    lines.push("PSEUDOPILOT:ALL");
    lines.push(positionLine(aircraft));
    lines.push(flightPlanLine(aircraft));
    if (aircraft.simData) {
      lines.push(`SIMDATA:${aircraft.callsign}:${SIMDATA_TAIL}`);
    }
    if (aircraft.pseudoRoute.trim()) {
      lines.push(`$ROUTE:${aircraft.pseudoRoute.trim()}`);
    }
    lines.push(`DELAY:${aircraft.delayFrom}:${aircraft.delayTo}`);
    if (aircraft.start !== null) lines.push(`START:${aircraft.start}`);
    if (aircraft.requestAltitude !== null) {
      lines.push(`REQALT::${aircraft.requestAltitude}`);
    }
    // Under `DELAY`/`START`, and after `REQALT`, which is the order the
    // hand-written sets use. The aircraft's own seat wins over the scenario's
    // default so one aircraft can be handed to a different position.
    const pseudopilot =
      aircraft.initialPseudopilot.trim() || model.defaultPseudopilot.trim();
    if (pseudopilot) {
      lines.push(`INITIALPSEUDOPILOT:${pseudopilot}`);
    }
    lines.push("");
  }

  return lines.join("\r\n").replace(/(\r\n)+$/, "\r\n");
}

/**
 * `ZGGG_GND-TWR_20260817.txt` — what the download is called.
 *
 * The seats are in the name because that is the first thing anybody wants to
 * know about a scenario file, and the existing sets in `SweatBox/` encode it
 * the same way (`ZGGG_TWR`, `ZUUU_APP`). Profiles keep their declared order
 * rather than the tick order, so the same selection always names the same file.
 */
export function scenarioFilename(model: ScenarioModel, stamp: string): string {
  const seats = SCENARIO_PROFILES.filter((profile) =>
    model.profiles.includes(profile),
  );
  const suffix = seats.length ? seats.join("-") : "SIM";
  return `${model.airport || "SCENARIO"}_${suffix}_${stamp}.txt`;
}
