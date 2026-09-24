/**
 * Airport-specific traffic rules for the SweatBox generator.
 *
 * Keep operational facts here rather than burying them in the composer. The
 * rules are intentionally opt-in per airport: fields without an entry retain
 * the generator's old free-form airline and destination behaviour.
 */

export interface TrafficChoice {
  airline: string;
  partner: string;
  terminal: string | null;
}

interface StandLike {
  name: string;
  lat: number;
  lon: number;
}

interface TerminalRule {
  id: string;
  /** Explicit names take precedence when a verified stand list is available. */
  stands?: string[];
  /** Geographic fallback for data sources that only publish stand coordinates. */
  bounds?: { north: number; south: number; east: number; west: number };
}

interface OperationRule {
  airline: string;
  terminal: string;
  destinations?: string[];
  market?: "mainland" | "regional";
}

interface AirportTrafficRule {
  terminals: TerminalRule[];
  operations: OperationRule[];
}

const ZSSS_T1_DOMESTIC: Record<string, string[]> = {
  // Route lists are deliberately conservative: only airports publicly listed
  // for the operating carrier are included. They are a dated seed, not a claim
  // that every seasonal flight operates every day.
  CQH: [
    "ZGGG",
    "ZGSZ",
    "ZSAM",
    "ZSQZ",
    "ZBSJ",
    "ZUGY",
    "ZLXY",
    "ZUCK",
    "ZUUU",
    "ZUTF",
    "ZPPP",
    "ZGOW",
    "ZWWW",
    "ZLXN",
  ],
  CXA: [
    "ZSAM",
    "ZSFZ",
    "ZSQZ",
    "ZGSZ",
    "ZGSD",
    "ZSCN",
    "ZSQD",
    "ZSWH",
    "ZPPP",
    "ZGNN",
    "ZUUU",
    "ZYHB",
  ],
  HBH: ["ZBSJ", "ZUCK", "ZSQZ", "ZSAM", "ZSFZ", "ZGSZ", "ZGSD", "ZULZ"],
};

const AIRPORT_RULES: Record<string, AirportTrafficRule> = {
  ZSSS: {
    // Terminal allocation and airline lists:
    // https://www.shairport.com/ensh/airlines/index.html
    // Route allowlists are a conservative 2026-09 snapshot of the destinations
    // published for each operator. Keep the explicit lists narrow when unsure:
    // omitting a seasonal route is safer than generating an impossible one.
    terminals: [
      // Hongqiao T1 is east of the runways and T2 is west. can-db supplies the
      // actual stand coordinates, so this remains valid when stand names in a
      // sector package change. Add `stands` here if an authoritative stand list
      // becomes available; no guessed stand-number ranges belong in this file.
      {
        id: "T1",
        bounds: {
          north: 31.215,
          south: 31.185,
          east: 121.36,
          west: 121.337,
        },
      },
      {
        id: "T2",
        bounds: {
          north: 31.215,
          south: 31.185,
          east: 121.337,
          west: 121.31,
        },
      },
    ],
    operations: [
      ...Object.entries(ZSSS_T1_DOMESTIC).map(([airline, destinations]) => ({
        airline,
        terminal: "T1",
        destinations,
      })),
      { airline: "ANA", terminal: "T1", destinations: ["RJTT"] },
      { airline: "JAL", terminal: "T1", destinations: ["RJTT"] },
      { airline: "KAL", terminal: "T1", destinations: ["RKSS"] },
      { airline: "AAR", terminal: "T1", destinations: ["RKSS"] },
      { airline: "CPA", terminal: "T1", destinations: ["VHHH"] },
      { airline: "CRK", terminal: "T1", destinations: ["VHHH"] },
      { airline: "CAL", terminal: "T1", destinations: ["RCSS"] },
      { airline: "EVA", terminal: "T1", destinations: ["RCSS"] },
      { airline: "AMU", terminal: "T1", destinations: ["VMMC"] },
      // These carriers use T1 for regional/international services and T2 for
      // mainland services. Separate rows make that distinction data, not code.
      ...["CES", "CSH", "CCA"].flatMap((airline) => [
        { airline, terminal: "T1", market: "regional" as const },
        { airline, terminal: "T2", market: "mainland" as const },
      ]),
      ...[
        "CSN",
        "CUA",
        "DKH",
        "CDG",
        "CHH",
        "CSC",
        "UEA",
        "CSZ",
        "GCR",
        "TBA",
        "LKE",
      ].map((airline) => ({
        airline,
        terminal: "T2",
        market: "mainland" as const,
      })),
    ],
  },
};

const MAINLAND_PREFIXES = [
  "ZB",
  "ZG",
  "ZH",
  "ZJ",
  "ZL",
  "ZP",
  "ZS",
  "ZU",
  "ZW",
  "ZY",
];

function isMainlandAirport(icao: string): boolean {
  return MAINLAND_PREFIXES.some((prefix) => icao.startsWith(prefix));
}

function matchesOperation(operation: OperationRule, partner: string): boolean {
  if (operation.destinations) return operation.destinations.includes(partner);
  if (operation.market === "mainland") return isMainlandAirport(partner);
  if (operation.market === "regional") return !isMainlandAirport(partner);
  return true;
}

/**
 * Build legal airline/city-pair choices. A configured airline is never allowed
 * to fall back outside its rules; this is what prevents ANA from being paired
 * with a mainland domestic leg. Unknown airlines remain free-form so an
 * instructor can still enter a charter or a newly introduced operator.
 */
export function trafficChoicesFor(
  airport: string,
  airlines: string[],
  partners: string[],
): TrafficChoice[] {
  const rule = AIRPORT_RULES[airport];
  if (!rule) {
    return partners.flatMap((partner) =>
      airlines.map((airline) => ({ airline, partner, terminal: null })),
    );
  }

  const choices: TrafficChoice[] = [];
  for (const partner of partners) {
    for (const airline of airlines) {
      const operations = rule.operations.filter(
        (entry) => entry.airline === airline,
      );
      if (!operations.length) {
        choices.push({ airline, partner, terminal: null });
        continue;
      }
      const operation = operations.find((entry) =>
        matchesOperation(entry, partner),
      );
      if (operation)
        choices.push({ airline, partner, terminal: operation.terminal });
    }
  }
  return choices;
}

/** Return the configured terminal for a real stand, or null when unclassified. */
export function terminalForStand(
  airport: string,
  stand: StandLike,
): string | null {
  const terminals = AIRPORT_RULES[airport]?.terminals ?? [];
  for (const terminal of terminals) {
    if (terminal.stands?.includes(stand.name)) return terminal.id;
    const bounds = terminal.bounds;
    if (
      bounds &&
      stand.lat <= bounds.north &&
      stand.lat >= bounds.south &&
      stand.lon <= bounds.east &&
      stand.lon >= bounds.west
    ) {
      return terminal.id;
    }
  }
  return null;
}
