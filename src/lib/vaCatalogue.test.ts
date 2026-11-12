import { describe, expect, test } from "bun:test";
import { lookup } from "../pages/api/v1/[...path]";
import {
  aircraftTypeDraft,
  aircraftTypeInput,
  aircraftTypePath,
  aircraftTypesPath,
  airportTierRequest,
  type AircraftTypeDraft,
} from "./vaCatalogue";

const valid: AircraftTypeDraft = {
  icao: "b738",
  name: "Boeing 737-800",
  seats: "189",
  cargoKg: "20000",
  price: "100000.25",
  leasePerDay: "200.50",
  burnKgPerHr: "2500",
  cruiseKt: "450",
  rangeNm: "3000",
  maintPerHr: "30.00",
  active: true,
};

describe("aircraft catalogue", () => {
  test("normalizes immutable ICAO and converts credits to exact minor units", () => {
    const result = aircraftTypeInput(valid);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.body).toMatchObject({
      icao: "B738",
      price: 10000025,
      leasePerDay: 20050,
      maintPerHr: 3000,
      active: true,
    });
  });
  test.each(["", "-1", "NaN", "1e20", "1.001"])(
    "rejects invalid credit amount %s",
    (price) => {
      expect(aircraftTypeInput({ ...valid, price }).ok).toBe(false);
    },
  );
  test("refuses fractional seats and unsafe monetary integers", () => {
    expect(aircraftTypeInput({ ...valid, seats: "1.5" }).ok).toBe(false);
    expect(aircraftTypeInput({ ...valid, price: "9007199254740991" }).ok).toBe(
      false,
    );
  });
  test("refuses fractional cargo and range and overlong names", () => {
    expect(aircraftTypeInput({ ...valid, cargoKg: "1.5" }).ok).toBe(false);
    expect(aircraftTypeInput({ ...valid, rangeNm: "1.5" }).ok).toBe(false);
    expect(aircraftTypeInput({ ...valid, name: "x".repeat(121) }).ok).toBe(
      false,
    );
  });
  test("counts Unicode codepoints rather than UTF-16 units in names", () => {
    expect(aircraftTypeInput({ ...valid, name: "𠮷".repeat(120) }).ok).toBe(
      true,
    );
    expect(aircraftTypeInput({ ...valid, name: "𠮷".repeat(121) }).ok).toBe(
      false,
    );
  });
  test.each(["seats", "cargoKg", "rangeNm"] as const)(
    "enforces the PostgreSQL integer boundary for %s",
    (field) => {
      expect(aircraftTypeInput({ ...valid, [field]: "2147483647" }).ok).toBe(
        true,
      );
      expect(aircraftTypeInput({ ...valid, [field]: "2147483648" }).ok).toBe(
        false,
      );
    },
  );
  test("accepts the exact largest JSON-safe monetary integer", () => {
    const result = aircraftTypeInput({
      ...valid,
      price: "90071992547409.91",
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body.price).toBe(Number.MAX_SAFE_INTEGER);
    expect(aircraftTypeInput({ ...valid, price: "90071992547409.92" }).ok).toBe(
      false,
    );
  });
  test("editing preserves every minor unit near the safe integer boundary", () => {
    const parsed = aircraftTypeInput(valid);
    if (!parsed.ok) throw new Error("Invalid test aircraft type");
    for (let offset = 0; offset < 100; offset++) {
      const type = {
        ...parsed.body,
        price: Number.MAX_SAFE_INTEGER - offset,
      };
      expect(aircraftTypeInput(aircraftTypeDraft(type))).toEqual({
        ok: true,
        body: type,
      });
    }
  });
  test("permits cargo-only aircraft with zero seats", () => {
    expect(aircraftTypeInput({ ...valid, seats: "0" }).ok).toBe(true);
  });
  test("only explicit catalogue routes and methods are forwarded", () => {
    expect(lookup(aircraftTypesPath().slice(8))?.methods).toEqual([
      "GET",
      "POST",
    ]);
    expect(lookup(aircraftTypePath("B738").slice(8))?.methods).toEqual([
      "PATCH",
    ]);
    for (const path of [
      "va/staff/aircraft-types/",
      "va/staff/aircraft-types/ABCDE",
      "va/staff/aircraft-types/B738/delete",
      "va/staff/aircraft-types/../params",
      "va/staff/aircraft-types/b738",
    ]) {
      expect(lookup(path)).toBeUndefined();
    }
  });
});

describe("airport tiers", () => {
  test("normalizes airport and sends null to reset the override", () => {
    expect(airportTierRequest(" zbaa ", "")).toEqual({
      ok: true,
      path: "/api/v1/va/staff/airports/ZBAA/tier",
      body: { tier: null },
    });
    const result = airportTierRequest("ZBAA", "5");
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(lookup(result.path.slice(8))?.methods).toEqual(["PUT"]);
  });
  test.each(["0", "6", "2.5", "NaN"])("refuses invalid tier %s", (tier) => {
    expect(airportTierRequest("ZBAA", tier).ok).toBe(false);
  });
  test("rejects airport path injection", () => {
    expect(airportTierRequest("../ZBAA", "3").ok).toBe(false);
    expect(lookup("va/staff/airports/ABCDE/tier")).toBeUndefined();
  });
});
