import { describe, expect, test } from "bun:test";
import {
  requiredDepartureFor,
  requiredPartnersFor,
  terminalForStand,
  trafficChoicesFor,
} from "./sweatboxTrafficRules";

describe("ZSSS traffic rules", () => {
  test("never assigns ANA to a mainland domestic flight", () => {
    expect(trafficChoicesFor("ZSSS", ["ANA"], ["ZBAA", "RJTT"])).toEqual([
      { airline: "ANA", partner: "RJTT", terminal: "T1" },
    ]);
  });

  test("keeps the same airline in different terminals by market", () => {
    expect(trafficChoicesFor("ZSSS", ["CES"], ["ZBAA", "VHHH"])).toEqual([
      { airline: "CES", partner: "ZBAA", terminal: "T2" },
      { airline: "CES", partner: "VHHH", terminal: "T1" },
    ]);
  });

  test("restricts Spring Airlines to its configured Hongqiao destinations", () => {
    expect(
      trafficChoicesFor("ZSSS", ["CQH"], ["ZBAA", "ZGGG", "VHHH"]),
    ).toEqual([{ airline: "CQH", partner: "ZGGG", terminal: "T1" }]);
  });

  test("classifies Hongqiao stands by terminal geography", () => {
    expect(
      terminalForStand("ZSSS", { name: "east", lat: 31.2, lon: 121.348 }),
    ).toBe("T1");
    expect(
      terminalForStand("ZSSS", { name: "west", lat: 31.2, lon: 121.326 }),
    ).toBe("T2");
  });
});

describe("required scheduled departures", () => {
  test("selects exactly one Hongqiao to Haneda flight", () => {
    expect(requiredDepartureFor("ZSSS", 0)).toEqual({
      callsign: "ANA970",
      airline: "ANA",
      partner: "RJTT",
      terminal: "T1",
    });
    expect(requiredDepartureFor("ZSSS", 1)?.callsign).toBe("JAL82");
    expect(requiredPartnersFor("ZSSS")).toEqual(["RJTT"]);
  });

  test("selects one Pudong to Kansai flight", () => {
    expect(requiredDepartureFor("ZSPD", 0)?.callsign).toBe("ANA974");
    expect(requiredDepartureFor("ZSPD", 1)?.callsign).toBe("JAL894");
    expect(requiredDepartureFor("ZSPD", 1)?.partner).toBe("RJBB");
  });
});

describe("additional airport route rules", () => {
  test("keeps Hohhot traffic on configured routes", () => {
    expect(trafficChoicesFor("ZBHH", ["CSH"], ["ZSPD", "RJTT"])).toEqual([
      { airline: "CSH", partner: "ZSPD", terminal: null },
    ]);
  });

  test("separates realistic Fukuoka and Haneda routes", () => {
    expect(trafficChoicesFor("RJFF", ["CES"], ["ZSPD", "ZBAA"])).toEqual([
      { airline: "CES", partner: "ZSPD", terminal: null },
    ]);
    expect(trafficChoicesFor("RJTT", ["AAR"], ["RKSS", "RKSI"])).toEqual([
      { airline: "AAR", partner: "RKSS", terminal: null },
    ]);
  });
});
