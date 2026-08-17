/**
 * Flight plan validation, shared by the API that enforces it and the form that
 * explains it.
 *
 * The rules here are not cosmetic. A plan filed on this page is handed to
 * can-fsd, which rebuilds it into an FSD `$FP` packet and broadcasts it to
 * every controller. That packet is colon-delimited and newline-terminated, so
 * a colon in the route field would shift every field after it and a newline
 * would split the packet in two. can-fsd sanitises those characters as a last
 * line of defence; rejecting them here means the member is told why instead of
 * quietly getting a mangled plan.
 *
 * Browser-safe: no prisma import.
 */

/** Flight rules, as the protocol serialises them. */
export const FLIGHT_RULES = [
  { value: "I", key: "ifr" },
  { value: "V", key: "vfr" },
  { value: "S", key: "svfr" },
  { value: "D", key: "dvfr" },
] as const;

export type FlightRule = (typeof FLIGHT_RULES)[number]["value"];

export interface FlightPlanInput {
  callsign: string;
  flightRules: string;
  aircraft: string;
  cruiseTas: string;
  departure: string;
  departureTime: string;
  cruisingAltitude: string;
  arrival: string;
  alternate: string;
  hoursEnroute: string;
  minutesEnroute: string;
  fuelHours: string;
  fuelMinutes: string;
  remarks: string;
  route: string;
}

/** Field-keyed validation failures; the form renders these under each input. */
export type FlightPlanErrors = Partial<Record<keyof FlightPlanInput, string>>;

/**
 * Equipment suffixes.
 *
 * There is no equipment field in an FSD flight plan: the suffix rides inside
 * the aircraft field, after a slash — `B738/L`, or `H/B77W/L` once a wake
 * category is prefixed. That is the string a controller's client shows, so it
 * is also what this app stores, and the form composes it rather than asking a
 * member to remember the syntax.
 *
 * The list is the subset of the FAA suffixes that actually turns up on this
 * network; the aircraft field stays free text, so anything else can still be
 * typed by hand.
 */
export const EQUIPMENT_SUFFIXES = [
  { value: "L", label: "L — RVSM + GNSS + Mode C" },
  { value: "Z", label: "Z — RVSM + RNAV" },
  { value: "W", label: "W — RVSM" },
  { value: "G", label: "G — GNSS + Mode C" },
  { value: "I", label: "I — RNAV + Mode C" },
  { value: "A", label: "A — DME + Mode C" },
  { value: "U", label: "U — Transponder + Mode C" },
  { value: "T", label: "T — Transponder, no Mode C" },
  { value: "X", label: "X — No transponder" },
] as const;

const EQUIPMENT_CODES = new Set<string>(
  EQUIPMENT_SUFFIXES.map((item) => item.value),
);

/**
 * Split an aircraft field into the type (wake prefix included) and its
 * equipment suffix. A trailing segment is only read as equipment when it is
 * one of the known codes, so `B738/L` splits but an ICAO equipment string like
 * `SDE2E3FGHIRWY/LB1` is left alone as a type the member typed deliberately.
 */
export function splitAircraft(value: string): {
  type: string;
  equipment: string;
} {
  const text = value.trim().toUpperCase();
  const cut = text.lastIndexOf("/");
  if (cut < 1) return { type: text, equipment: "" };

  const tail = text.slice(cut + 1);
  if (!EQUIPMENT_CODES.has(tail)) return { type: text, equipment: "" };

  return { type: text.slice(0, cut), equipment: tail };
}

/** Recombine the two halves. An empty suffix leaves the type bare. */
export function joinAircraft(type: string, equipment: string): string {
  const base = type.trim().toUpperCase().replace(/\/+$/, "");
  return equipment ? `${base}/${equipment}` : base;
}

/** Characters that would change the structure of the generated FSD packet. */
const STRUCTURAL = /[:\r\n]/;

/**
 * Callsigns are validated the same way can-fsd validates them at login:
 * 2-10 characters, uppercase alphanumeric plus hyphen and underscore. A
 * callsign the network would reject is not worth storing.
 */
const CALLSIGN = /^[A-Z0-9_-]{2,10}$/;

/** ICAO location indicators are four letters. */
const ICAO = /^[A-Z]{4}$/;

/** Zulu time, four digits. */
const HHMM = /^([01][0-9]|2[0-3])[0-5][0-9]$/;

export const LIMITS = {
  aircraft: 40,
  cruiseTas: 8,
  cruisingAltitude: 12,
  remarks: 400,
  route: 1000,
} as const;

function required(value: string): boolean {
  return value.trim().length > 0;
}

/**
 * Normalise raw form input: trim everything, upper-case the fields the
 * protocol expects in upper case, and collapse absent numerics to "0".
 */
export function normaliseFlightPlan(input: FlightPlanInput): FlightPlanInput {
  const upper = (v: string) => v.trim().toUpperCase();
  const numeric = (v: string) => (v.trim() === "" ? "0" : v.trim());

  return {
    callsign: upper(input.callsign),
    flightRules: upper(input.flightRules),
    aircraft: upper(input.aircraft),
    cruiseTas: numeric(input.cruiseTas),
    departure: upper(input.departure),
    departureTime: input.departureTime.trim(),
    cruisingAltitude: upper(input.cruisingAltitude),
    arrival: upper(input.arrival),
    alternate: upper(input.alternate),
    hoursEnroute: numeric(input.hoursEnroute),
    minutesEnroute: numeric(input.minutesEnroute),
    fuelHours: numeric(input.fuelHours),
    fuelMinutes: numeric(input.fuelMinutes),
    remarks: input.remarks.trim(),
    route: input.route.trim().replace(/\s+/g, " "),
  };
}

/**
 * Validate a normalised plan. Returns an empty object when the plan is
 * acceptable.
 *
 * Error values are i18n keys under `pilots.flightplan.errors`, so the same
 * result renders in whichever language the member is using.
 */
export function validateFlightPlan(plan: FlightPlanInput): FlightPlanErrors {
  const errors: FlightPlanErrors = {};

  if (!CALLSIGN.test(plan.callsign)) errors.callsign = "callsign";

  if (!FLIGHT_RULES.some((r) => r.value === plan.flightRules)) {
    errors.flightRules = "flightRules";
  }

  if (!required(plan.aircraft) || plan.aircraft.length > LIMITS.aircraft) {
    errors.aircraft = "aircraft";
  }

  if (!/^\d{1,4}$/.test(plan.cruiseTas) || Number(plan.cruiseTas) <= 0) {
    errors.cruiseTas = "cruiseTas";
  }

  if (!ICAO.test(plan.departure)) errors.departure = "icao";
  if (!ICAO.test(plan.arrival)) errors.arrival = "icao";

  // The alternate is optional, but if given it has to be a real indicator.
  if (plan.alternate !== "" && !ICAO.test(plan.alternate)) {
    errors.alternate = "icao";
  }

  if (!HHMM.test(plan.departureTime)) errors.departureTime = "time";

  if (
    !required(plan.cruisingAltitude) ||
    plan.cruisingAltitude.length > LIMITS.cruisingAltitude
  ) {
    errors.cruisingAltitude = "cruisingAltitude";
  }

  for (const field of [
    "hoursEnroute",
    "minutesEnroute",
    "fuelHours",
    "fuelMinutes",
  ] as const) {
    if (!/^\d{1,2}$/.test(plan[field])) errors[field] = "number";
  }
  if (Number(plan.minutesEnroute) > 59) errors.minutesEnroute = "minutes";
  if (Number(plan.fuelMinutes) > 59) errors.fuelMinutes = "minutes";

  if (!required(plan.route) || plan.route.length > LIMITS.route) {
    errors.route = "route";
  }
  if (plan.remarks.length > LIMITS.remarks) errors.remarks = "remarksLength";

  // Checked last so a structural character is reported as itself rather than
  // as a length or format problem.
  if (STRUCTURAL.test(plan.route)) errors.route = "structural";
  if (STRUCTURAL.test(plan.remarks)) errors.remarks = "structural";

  return errors;
}

export function hasErrors(errors: FlightPlanErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** An empty plan, used to seed the form. */
export function emptyFlightPlan(): FlightPlanInput {
  return {
    callsign: "",
    flightRules: "I",
    aircraft: "",
    cruiseTas: "",
    departure: "",
    departureTime: "",
    cruisingAltitude: "",
    arrival: "",
    alternate: "",
    hoursEnroute: "0",
    minutesEnroute: "0",
    fuelHours: "0",
    fuelMinutes: "0",
    remarks: "",
    route: "",
  };
}
