import { describe, expect, test } from "bun:test";
import {
  APP_ENTRY_ALTITUDE,
  appEntryAltitude,
  bearingTo,
  buildScenario,
  composeTraffic,
  emptyAircraft,
  emptyScenario,
  generateTraffic,
  runwayTrueCourse,
  type SweatboxAirport,
  type SweatboxRunway,
  type TrafficOptions,
} from "./sweatbox";

const runway: SweatboxRunway = {
  id: "18L",
  opposite: "36R",
  hdg: 180,
  lat: 31.2,
  lon: 121.34,
  endLat: 31.19,
  endLon: 121.34,
};

const airport: SweatboxAirport = {
  icao: "ZSSS",
  fir: "ZSHA",
  lat: 31.19861,
  lon: 121.33575,
  elev: 10,
  variation: 0,
  magVar: null,
  runways: [runway],
  stands: [
    { name: "T1-A", lat: 31.2, lon: 121.348 },
    { name: "T1-B", lat: 31.205, lon: 121.35 },
    { name: "T2-A", lat: 31.2, lon: 121.326 },
    { name: "T2-B", lat: 31.205, lon: 121.322 },
  ],
  sids: [],
  stars: [],
};

describe("airport-aware traffic generation", () => {
  test("includes one scheduled Haneda flight and parks it at ZSSS T1", () => {
    const traffic = generateTraffic({
      airport,
      profiles: ["GND"],
      counts: { GND: 2, TWR: 0, DEP: 0, APP: 0 },
      arrivalRunway: runway,
      departureRunway: runway,
      airlines: ["ANA"],
      types: ["B738"],
      partners: ["ZBAA", "RJTT"],
      cruise: "",
      taxiRoute: "",
      arrivalRadials: [],
      seed: 1,
    });

    expect(traffic).toHaveLength(2);
    expect(traffic.some((row) => row.callsign === "JAL82")).toBe(true);
    expect(traffic.every((row) => row.destination === "RJTT")).toBe(true);
    expect(traffic.every((row) => row.lon > 121.337)).toBe(true);
    expect(new Set(traffic.map((row) => `${row.lat},${row.lon}`)).size).toBe(2);
  });

  test("includes a scheduled Pudong to Kansai departure", () => {
    const pudong = { ...airport, icao: "ZSPD", stands: airport.stands };
    const traffic = generateTraffic({
      airport: pudong,
      profiles: ["DEP"],
      counts: { GND: 0, TWR: 0, DEP: 1, APP: 0 },
      arrivalRunway: runway,
      departureRunway: runway,
      airlines: ["CES"],
      types: ["B738"],
      partners: ["ZBAA"],
      cruise: "",
      taxiRoute: "",
      arrivalRadials: [],
      seed: 0,
      airportCoords: { RJBB: [34.4347, 135.244] },
    });

    expect(traffic).toHaveLength(1);
    expect(traffic[0].callsign).toBe("ANA974");
    expect(traffic[0].destination).toBe("RJBB");
    expect(Number(traffic[0].cruise)).toBeGreaterThan(0);
  });
});

/** A field with a published course that disagrees with its geometry. */
const skewRunway: SweatboxRunway = {
  id: "01",
  opposite: "19",
  // Magnetic. The thresholds below lie due north–south, so true is 0.
  hdg: 7,
  lat: 40,
  lon: 116,
  endLat: 40.05,
  endLon: 116,
};

const field: SweatboxAirport = {
  icao: "ZZZZ",
  fir: "ZZZZ",
  lat: 40.02,
  lon: 116.01,
  elev: 100,
  variation: 7,
  magVar: null,
  runways: [skewRunway],
  stands: [{ name: "1", lat: 40.02, lon: 116.02 }],
  sids: [
    {
      name: "NTH1",
      runway: "01",
      points: ["SOUTHX", "NORTHX"],
      gate: "NORTHX",
    },
  ],
  stars: [],
};

const options = (over: Partial<TrafficOptions>): TrafficOptions => ({
  airport: field,
  profiles: [],
  counts: { GND: 0, TWR: 0, DEP: 0, APP: 0 },
  arrivalRunway: skewRunway,
  departureRunway: skewRunway,
  airlines: ["CSN"],
  types: ["B738"],
  partners: ["ZBAA"],
  cruise: "",
  taxiRoute: "",
  arrivalRadials: [],
  seed: 3,
  ...over,
});

const angle = (a: number, b: number) => Math.abs(((a - b + 540) % 360) - 180);

describe("placement geometry", () => {
  test("the runway's true course comes from its thresholds", () => {
    expect(runwayTrueCourse(skewRunway, 7)).toBeCloseTo(0, 1);
    // No far end: the published course, converted.
    expect(
      runwayTrueCourse({ ...skewRunway, endLat: 40, endLon: 116 }, 7),
    ).toBe(0);
  });

  test("TWR arrivals sit on the true extended centreline", () => {
    const traffic = generateTraffic(
      options({
        profiles: ["TWR"],
        counts: { GND: 0, TWR: 3, DEP: 0, APP: 0 },
      }),
    );
    expect(traffic).toHaveLength(3);
    for (const row of traffic) {
      const from = bearingTo(skewRunway.lat, skewRunway.lon, row.lat, row.lon);
      expect(angle(from, 180)).toBeLessThan(0.5);
    }
  });

  test("DEP departures face the true course", () => {
    const [row] = generateTraffic(
      options({
        profiles: ["DEP"],
        counts: { GND: 0, TWR: 0, DEP: 1, APP: 0 },
      }),
    );
    expect(angle(row.heading, 0)).toBeLessThan(0.5);
  });

  test("APP entry altitude follows a high field", () => {
    expect(appEntryAltitude(12)).toBe(APP_ENTRY_ALTITUDE);
    expect(appEntryAltitude(null)).toBe(APP_ENTRY_ALTITUDE);
    expect(appEntryAltitude(11713)).toBe(19800);
  });
});

describe("departure routes", () => {
  test("GND flies the SID from its nearest point, after the taxi route", () => {
    const fixes = [
      // South of the stand and nearest; a north-facing filter would skip it.
      { name: "SOUTHX", lat: 40.0, lon: 116.02 },
      { name: "NORTHX", lat: 40.5, lon: 116.02 },
    ];
    const [row] = generateTraffic(
      options({
        profiles: ["GND"],
        counts: { GND: 1, TWR: 0, DEP: 0, APP: 0 },
        taxiRoute: "A B",
        fixes,
        airportCoords: { ZBAA: [41, 116.02] },
      }),
    );
    expect(row.pseudoRoute).toBe("A B SOUTHX NORTHX");
  });

  test("DEP does not taxi", () => {
    const [row] = generateTraffic(
      options({
        profiles: ["DEP"],
        counts: { GND: 0, TWR: 0, DEP: 1, APP: 0 },
        taxiRoute: "A B",
        airportCoords: { ZBAA: [41, 116.02] },
      }),
    );
    expect(row.pseudoRoute.startsWith("A B")).toBe(false);
    expect(row.pseudoRoute).toContain("NORTHX");
  });

  test("can-db's plan is kept when the partner has no coordinates", () => {
    const [row] = generateTraffic(
      options({
        profiles: ["DEP"],
        counts: { GND: 0, TWR: 0, DEP: 1, APP: 0 },
        routes: {
          "ZZZZ-ZBAA": {
            from: "ZZZZ",
            to: "ZBAA",
            route: "NTH1 NORTHX W1 ABC",
            sid: "NTH1",
            star: "",
            source: "computed",
            notes: [],
          },
        },
      }),
    );
    expect(row.route).toBe("NORTHX W1 ABC");
    expect(row.pseudoRoute).toBe("SOUTHX NORTHX");
  });
});

describe("stand shortfall", () => {
  test("counts aircraft a terminal group could not park", () => {
    // ZSSS: ANA is tied to T1, and only one of the four stands is in T1.
    const result = composeTraffic({
      airport: {
        ...airport,
        stands: [
          { name: "T1-A", lat: 31.2, lon: 121.348 },
          { name: "T2-A", lat: 31.2, lon: 121.326 },
          { name: "T2-B", lat: 31.205, lon: 121.322 },
          { name: "T2-C", lat: 31.21, lon: 121.32 },
        ],
      },
      profiles: ["GND"],
      counts: { GND: 3, TWR: 0, DEP: 0, APP: 0 },
      arrivalRunway: runway,
      departureRunway: runway,
      airlines: ["ANA"],
      types: ["B738"],
      partners: ["RJTT"],
      cruise: "",
      taxiRoute: "",
      arrivalRadials: [],
      seed: 1,
    });
    expect(result.aircraft).toHaveLength(1);
    expect(result.standShortfall).toBe(2);
  });
});

describe("scenario output", () => {
  test("a colon typed into a field cannot shift the $FP fields", () => {
    const model = emptyScenario();
    model.airportAlt = 12;
    model.namedRoutes = [{ name: "R:1", points: "A:B" }];
    model.aircraft = [
      {
        ...emptyAircraft("GND"),
        callsign: "CSN:123",
        departure: "ZGGG",
        destination: "ZBAA",
        remarks: "RMK/TCAS:YES",
        route: "YIN A461:ZHO",
      },
    ];
    const text = buildScenario(model);
    expect(text).toContain("AIRPORT_ALT:12.0");
    expect(text).toContain("\r\n");
    expect(text).not.toMatch(/[^\r]\n/);
    const fp = text.split("\r\n").find((line) => line.startsWith("$FP"));
    expect(fp?.split(":")).toHaveLength(17);
    expect(fp).toContain("$FPCSN123:");
    expect(fp).toContain(":RMK/TCAS YES:YIN A461 ZHO");
    expect(text).toContain("ROUTE:R1:A B");
  });
});
