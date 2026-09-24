import { describe, expect, test } from "bun:test";
import { terminalForStand, trafficChoicesFor } from "./sweatboxTrafficRules";

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
