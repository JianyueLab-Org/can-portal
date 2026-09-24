/** Airport-specific airline, destination and terminal rules. */

export interface TrafficChoice {
  airline: string;
  partner: string;
  terminal: string | null;
  /** Fixed scheduled callsign; absent for ordinary generated traffic. */
  callsign?: string;
}

interface StandLike {
  name: string;
  lat: number;
  lon: number;
}

interface TerminalRule {
  id: string;
  stands?: string[];
  bounds?: { north: number; south: number; east: number; west: number };
}

interface OperationRule {
  airline: string;
  terminal?: string;
  destinations?: string[];
  market?: "mainland" | "regional";
}

interface AirportTrafficRule {
  terminals: TerminalRule[];
  operations: OperationRule[];
  requiredDepartures?: Array<Required<TrafficChoice>>;
}

function routes(
  entries: Record<string, string[]>,
  terminal?: string,
): OperationRule[] {
  return Object.entries(entries).map(([airline, destinations]) => ({
    airline,
    destinations,
    ...(terminal ? { terminal } : {}),
  }));
}

const ZSSS_T1_DOMESTIC: Record<string, string[]> = {
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
    // Shanghai Airport airline directory and ANA/JAL airport guides, 2026-09.
    terminals: [
      {
        id: "T1",
        bounds: { north: 31.215, south: 31.185, east: 121.36, west: 121.337 },
      },
      {
        id: "T2",
        bounds: { north: 31.215, south: 31.185, east: 121.337, west: 121.31 },
      },
    ],
    operations: [
      ...routes(ZSSS_T1_DOMESTIC, "T1"),
      ...routes(
        {
          ANA: ["RJTT"],
          JAL: ["RJTT"],
          KAL: ["RKSS"],
          AAR: ["RKSS"],
          CPA: ["VHHH"],
          CRK: ["VHHH"],
          CAL: ["RCSS"],
          EVA: ["RCSS"],
          AMU: ["VMMC"],
        },
        "T1",
      ),
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
    requiredDepartures: [
      { callsign: "ANA970", airline: "ANA", partner: "RJTT", terminal: "T1" },
      { callsign: "JAL82", airline: "JAL", partner: "RJTT", terminal: "T1" },
    ],
  },
  ZSPD: {
    // Japanese Wikipedia plus Shanghai Airport, ANA and JAL airport guides.
    // No stand bounds until a verified stand-to-terminal table is available.
    terminals: [],
    operations: routes({
      CES: [
        "ZBAA",
        "ZBAD",
        "ZGGG",
        "ZGSZ",
        "ZUUU",
        "ZUCK",
        "ZLXY",
        "ZPPP",
        "ZYHB",
        "ZYTL",
        "ZSAM",
        "ZSFZ",
        "ZSNJ",
        "VHHH",
        "RCTP",
        "RKSI",
        "RJAA",
        "RJBB",
        "RJFF",
        "RJTT",
        "VTBS",
        "WSSS",
      ],
      CSH: [
        "ZBAA",
        "ZGGG",
        "ZGSZ",
        "ZUUU",
        "ZUCK",
        "ZSAM",
        "ZSFZ",
        "VHHH",
        "RKSI",
      ],
      DKH: [
        "ZBAA",
        "ZGGG",
        "ZGSZ",
        "ZUUU",
        "ZUCK",
        "ZSAM",
        "VHHH",
        "RKSI",
        "RJAA",
        "RJBB",
        "RJFF",
        "RJTT",
        "VTBS",
      ],
      CQH: [
        "ZGGG",
        "ZGSZ",
        "ZUUU",
        "ZYHB",
        "ZYTX",
        "VHHH",
        "VMMC",
        "RCTP",
        "RKSI",
        "RJAA",
        "RJBB",
        "RJFF",
        "VTBS",
      ],
      CCA: ["ZBAA", "ZBAD", "ZUUU", "ZYHB"],
      CSN: ["ZGGG", "ZGSZ", "ZYHB", "ZYTX"],
      CSC: ["ZUUU"],
      CXA: ["ZSAM", "ZSFZ"],
      CSZ: ["ZGSZ"],
      CDG: ["ZSQD", "ZSJN"],
      ANA: ["RJAA", "RJBB", "RJTT"],
      JAL: ["RJAA", "RJBB", "RJTT"],
      KAL: ["RKSI"],
      AAR: ["RKSI"],
      CPA: ["VHHH"],
      EVA: ["RCTP"],
      CAL: ["RCTP"],
      SIA: ["WSSS"],
      THA: ["VTBS"],
    }),
    requiredDepartures: [
      { callsign: "ANA974", airline: "ANA", partner: "RJBB", terminal: null },
      { callsign: "JAL894", airline: "JAL", partner: "RJBB", terminal: null },
    ],
  },
  ZBHH: {
    // Conservative operating-carrier baseline from the Hohhot route table.
    terminals: [],
    operations: routes({
      CCA: ["ZBAA", "ZBAD", "ZUUU"],
      CUA: ["ZBAD"],
      CES: ["ZSPD", "ZLXY", "ZPPP"],
      CSH: ["ZSPD"],
      CSN: ["ZGGG", "ZYTX"],
      CHH: ["ZBAA", "ZJHK"],
      GCR: ["ZBTJ", "ZLXY", "ZUCK"],
      CDG: ["ZSJN", "ZSQD"],
      CSZ: ["ZGSZ"],
      CSC: ["ZUUU"],
      CXA: ["ZSAM", "ZSFZ"],
      CDC: ["ZSHC"],
    }),
  },
  RJFF: {
    // Fukuoka Airport route and airline directories, 2026-09.
    terminals: [],
    operations: routes({
      ANA: ["RJTT", "RJOO", "RJGG", "RJCC", "ROAH", "RJSS"],
      JAL: ["RJTT", "RJOO", "RJCC", "ROAH"],
      SKY: ["RJTT", "RJCC", "ROAH", "RJAH"],
      SFJ: ["RJTT", "RJGG"],
      JJP: ["RJAA", "RJCC", "RJGG", "RJBB"],
      APJ: ["RJAA", "RJCC", "ROAH", "ROIG"],
      FDA: ["RJSN", "RJNK", "RJNA"],
      IBX: ["RJSS", "RJNK", "RJSN"],
      ORC: ["RJFE", "RJDT", "RJFM"],
      SNJ: ["ROAH"],
      CES: ["ZSPD"],
      CSH: ["ZSPD"],
      CQH: ["ZSPD"],
      DKH: ["ZSPD"],
      CCA: ["ZBAA"],
      KAL: ["RKSI", "RKPK"],
      AAR: ["RKSI"],
      CPA: ["VHHH"],
      EVA: ["RCTP"],
      CAL: ["RCTP", "RCKH"],
      THA: ["VTBS"],
      SIA: ["WSSS"],
    }),
  },
  RJTT: {
    // Haneda airport airline/destination directories, conservative subset.
    terminals: [],
    operations: routes({
      ANA: [
        "RJCC",
        "RJCH",
        "RJEC",
        "RJCM",
        "RJSA",
        "RJSK",
        "RJSS",
        "RJGG",
        "RJOO",
        "RJBB",
        "RJFF",
        "RJOA",
        "RJOM",
        "RJOK",
        "RJNK",
        "RJFM",
        "RJFK",
        "ROAH",
        "ROMY",
        "ROIG",
        "ZSSS",
        "ZSPD",
        "ZBAA",
        "VHHH",
        "RKSI",
        "WSSS",
        "VTBS",
      ],
      JAL: [
        "RJCC",
        "RJCH",
        "RJSA",
        "RJSK",
        "RJSS",
        "RJGG",
        "RJOO",
        "RJBB",
        "RJFF",
        "RJOA",
        "RJOM",
        "RJOK",
        "RJFK",
        "ROAH",
        "ZSSS",
        "ZSPD",
        "ZBAA",
        "VHHH",
        "RKSI",
        "WSSS",
        "VTBS",
      ],
      ADO: ["RJCC", "RJEC", "RJCH", "RJCM", "RJCK", "RJSS"],
      SKY: ["RJCC", "RJFF", "RJBE", "ROAH", "RJFK", "RJFU"],
      SNJ: ["RJFM", "RJFK", "RJFO", "RJFU", "ROAH"],
      SFJ: ["RJFR", "RJFF", "RJBB", "RJDC"],
      CCA: ["ZBAA", "ZSPD"],
      CES: ["ZSPD", "ZSSS"],
      CSN: ["ZGGG", "ZBAD"],
      KAL: ["RKSI", "RKSS"],
      AAR: ["RKSS"],
      CPA: ["VHHH"],
      EVA: ["RCSS"],
      CAL: ["RCSS"],
      SIA: ["WSSS"],
      THA: ["VTBS"],
    }),
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
      if (operation) {
        choices.push({
          airline,
          partner,
          terminal: operation.terminal ?? null,
        });
      }
    }
  }
  return choices;
}

/** Select exactly one required scheduled departure, reproducibly by seed. */
export function requiredDepartureFor(
  airport: string,
  seed: number,
): TrafficChoice | null {
  const choices = AIRPORT_RULES[airport]?.requiredDepartures ?? [];
  if (!choices.length) return null;
  return choices[Math.abs(Math.trunc(seed)) % choices.length];
}

/** Partners the UI must ask can-db to route even if not typed in the dialog. */
export function requiredPartnersFor(airport: string): string[] {
  return [
    ...new Set(
      (AIRPORT_RULES[airport]?.requiredDepartures ?? []).map(
        (flight) => flight.partner,
      ),
    ),
  ];
}

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
