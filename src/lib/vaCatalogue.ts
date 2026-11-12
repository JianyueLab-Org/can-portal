export interface AircraftType {
  icao: string;
  name: string;
  seats: number;
  cargoKg: number;
  price: number;
  leasePerDay: number;
  burnKgPerHr: number;
  cruiseKt: number;
  rangeNm: number;
  maintPerHr: number;
  active: boolean;
}

export const TYPE_NUMBER_FIELDS = [
  "seats",
  "cargoKg",
  "price",
  "leasePerDay",
  "burnKgPerHr",
  "cruiseKt",
  "rangeNm",
  "maintPerHr",
] as const;
export type TypeNumberField = (typeof TYPE_NUMBER_FIELDS)[number];
export type AircraftTypeDraft = Record<
  TypeNumberField | "icao" | "name",
  string
> & { active: boolean };
const MONEY_FIELDS: readonly TypeNumberField[] = [
  "price",
  "leasePerDay",
  "maintPerHr",
];

export function aircraftTypesPath(): string {
  return "/api/v1/va/staff/aircraft-types";
}

export function aircraftTypePath(icao: string): string {
  return `${aircraftTypesPath()}/${encodeURIComponent(icao)}`;
}

export function aircraftTypeDraft(type?: AircraftType): AircraftTypeDraft {
  const draft: AircraftTypeDraft = {
    icao: type?.icao ?? "",
    name: type?.name ?? "",
    seats: "",
    cargoKg: "",
    price: "",
    leasePerDay: "",
    burnKgPerHr: "",
    cruiseKt: "",
    rangeNm: "",
    maintPerHr: "",
    active: type?.active ?? true,
  };
  if (type) {
    for (const key of TYPE_NUMBER_FIELDS) {
      draft[key] = MONEY_FIELDS.includes(key)
        ? `${Math.trunc(type[key] / 100)}.${String(type[key] % 100).padStart(2, "0")}`
        : String(type[key]);
    }
  }
  return draft;
}

type InputResult =
  { ok: true; body: AircraftType } | { ok: false; error: "invalidType" };

export function aircraftTypeInput(draft: AircraftTypeDraft): InputResult {
  const icao = draft.icao.trim().toUpperCase();
  const name = draft.name.trim();
  let nameLength = 0;
  for (let index = 0; index < name.length; nameLength++) {
    index += (name.codePointAt(index) ?? 0) > 0xffff ? 2 : 1;
  }
  if (!/^[A-Z0-9]{2,4}$/.test(icao) || !name || nameLength > 120)
    return { ok: false, error: "invalidType" };
  const body: AircraftType = {
    icao,
    name,
    active: draft.active,
    seats: 0,
    cargoKg: 0,
    price: 0,
    leasePerDay: 0,
    burnKgPerHr: 0,
    cruiseKt: 0,
    rangeNm: 0,
    maintPerHr: 0,
  };
  for (const key of TYPE_NUMBER_FIELDS) {
    const text = draft[key].trim();
    const money = MONEY_FIELDS.includes(key);
    const wholeNumber =
      key === "seats" || key === "cargoKg" || key === "rangeNm";
    if (!(money ? /^\d+(?:\.\d{1,2})?$/ : /^\d+(?:\.\d+)?$/).test(text))
      return { ok: false, error: "invalidType" };
    let value = Number(text);
    if (money) {
      const [whole, fraction = ""] = text.split(".");
      value = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
    }
    if (
      !Number.isFinite(value) ||
      value < 0 ||
      ((money || wholeNumber) && !Number.isSafeInteger(value)) ||
      (wholeNumber && value > 2147483647)
    )
      return { ok: false, error: "invalidType" };
    if ((key === "cruiseKt" || key === "rangeNm") && value <= 0)
      return { ok: false, error: "invalidType" };
    body[key] = value;
  }
  return { ok: true, body };
}

export function airportTierRequest(
  airport: string,
  tier: string,
):
  | { ok: true; path: string; body: { tier: number | null } }
  | { ok: false; error: "invalidTier" } {
  const icao = airport.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(icao) || !/^(?:[1-5])?$/.test(tier))
    return { ok: false, error: "invalidTier" };
  return {
    ok: true,
    path: `/api/v1/va/staff/airports/${icao}/tier`,
    body: { tier: tier === "" ? null : Number(tier) },
  };
}
