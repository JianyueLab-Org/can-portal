import { describe, expect, test } from "bun:test";
import {
  generateTraffic,
  type SweatboxAirport,
  type SweatboxRunway,
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
