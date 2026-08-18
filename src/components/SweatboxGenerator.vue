<script setup lang="ts">
/**
 * The SweatBox scenario generator.
 *
 * The format, the coordinate encoding, the writer and the traffic composition
 * all live in `src/lib/sweatbox.ts`; this is the form around them. Three
 * things about its shape are deliberate:
 *
 * **A scenario is written for a seat, not for a phase of flight.** The
 * instructor ticks GND / TWR / DEP / APP and each contributes its own slice —
 * aprons, final, upwind, the arrival — so training a ground controller
 * produces a field with nothing airborne, and training the whole tower
 * produces all of it. That is why the picker is a multi-select and not a
 * ground-or-approach switch.
 *
 * **Traffic volume is a preset the instructor overrides, not a setting they
 * are stuck with.** Low/medium/high fill the four counts in one click; every
 * count is then a plain number field, and touching one moves the level to
 * `custom`. The presets are a shortcut, never a ceiling.
 *
 * **Aircraft are placed, not typed.** A stand, a distance on final, a radial —
 * nobody types `N023.23.13.880` into this page, because that is the step the
 * existing hand-written scenarios got wrong most often.
 *
 * The editable grid scrolls sideways below `lg` rather than restacking into
 * cards the way `DataTable` does. A row with eleven fields is not a phone
 * layout, and pretending otherwise would produce a column of 40 stacked forms
 * nobody can scan.
 */
import { computed, onMounted, ref, watch } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  Dialog,
  EmptyState,
  Icon,
  Input,
  PageHeader,
  Spinner,
} from "@jianyuelab-org/can-ui";
import {
  MAX_PER_PROFILE,
  SCENARIO_PROFILES,
  TRAFFIC_COUNTS,
  TRAFFIC_LEVELS,
  bearingTo,
  buildScenario,
  defaultControllers,
  defaultPseudopilotFor,
  destination,
  distanceNm,
  emptyAircraft,
  emptyScenario,
  generateTraffic,
  magneticToTrue,
  DEFAULT_SPACING,
  SCENARIO_ERROR_KINDS,
  type ScenarioErrorKind,
  scenarioFilename,
  type AirwayGraph,
  type ScenarioAircraft,
  type ScenarioController,
  type ScenarioModel,
  type ScenarioProfile,
  type SweatboxAirport,
  type SweatboxFix,
  type SweatboxIndexEntry,
  type SweatboxRunway,
  type TrafficLevel,
} from "@/lib/sweatbox";
import { PERFORMANCE_TYPES } from "@/lib/sweatboxPerf";
import { EQUIPMENT_SUFFIXES } from "@/lib/flightplan";

const props = defineProps<{
  messages: Record<string, unknown>;
  airports: SweatboxIndexEntry[];
}>();
const t = createTranslator(props.messages);

/**
 * A row carries its *placement inputs* alongside the aircraft. `buildScenario`
 * reads named fields and ignores the rest, so the extras ride along rather
 * than living in a parallel array that could fall out of step with this one.
 */
interface Row extends ScenarioAircraft {
  /** GND: the stand it is parked on. */
  standName: string;
  /** Bearing from the profile's anchor, degrees. */
  radial: number;
  /** Distance from the profile's anchor, nautical miles. */
  distance: number;
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

const icao = ref("");
const airport = ref<SweatboxAirport | null>(null);
const fixes = ref<SweatboxFix[]>([]);
const loading = ref(false);
const loadError = ref("");

const model = ref<ScenarioModel>(emptyScenario());
const rows = ref<Row[]>([]);
const notice = ref("");

const airportFilter = ref("");
const sourcesOpen = ref(false);
const arrivalRunwayId = ref("");
const departureRunwayId = ref("");

/** Where the traffic comes from. Separate dialog: set once, rarely revisited. */
const sources = ref({
  airlines: "CSN,CES,CCA,CHH,CSC,CDG,CQH,DKH",
  types: "B738,A320,A321,A333,B739,A319",
  partners: "ZBAA,ZSPD,ZUUU,ZSSS,ZGSZ,ZYTL,ZHHH,ZLXY",
  // Blank on purpose: each leg then gets the Chinese semicircular level for
  // its own track and length. Filling this in pins every strip to one level,
  // which is occasionally what an instructor wants and never realistic.
  cruise: "",
  equipment: "L",
  taxiRoute: "",
  radials: "",
  seed: 20260817,
});

/**
 * Minutes between consecutive aircraft, per seat.
 *
 * Spacing is most of what makes a scenario easy or hard, so it sits in the
 * traffic panel rather than buried in the sources dialog. The defaults are the
 * network's own: arrivals to the tower every 4–10 minutes, approach arrivals
 * every 5, departures every 4–5.
 */
const spacing = ref<Record<ScenarioProfile, { min: number; max: number }>>(
  structuredClone(DEFAULT_SPACING),
);

/**
 * Deliberate mistakes: what share of the plans are wrong, and in what way.
 *
 * Checking a plan is most of what a clearance controller does, and a scenario
 * where everything is filed correctly trains someone to wave it all through.
 * The hand-written sets do this by hand and write the answer key in a separate
 * `说明` file; here the generator plants them and the table is the key.
 */
const errorRate = ref(0);
const errorKinds = ref<ScenarioErrorKind[]>([...SCENARIO_ERROR_KINDS]);

const toggleErrorKind = (kind: ScenarioErrorKind) => {
  const at = errorKinds.value.indexOf(kind);
  if (at >= 0) errorKinds.value.splice(at, 1);
  else errorKinds.value.push(kind);
};

/** The answer key: which aircraft were given what, in table order. */
const plantedErrors = computed(() =>
  rows.value
    .filter((row) => row.errors.length)
    .map((row) => ({
      callsign: row.callsign,
      kinds: row.errors.map((kind) => t(`errors.kinds.${kind}`)).join(" / "),
    })),
);

/**
 * The airway network and the world airport table, both fetched once.
 *
 * Routes need them and nothing else on the page does, so they load in the
 * background rather than blocking the form: an instructor who only wants a
 * ground exercise never waits for 134 KB of airways they will not use. If
 * either is still missing when the button is pressed, the traffic is still
 * generated — it just files the bare destination instead of an airway route.
 */
const airways = ref<AirwayGraph | null>(null);
const airportCoords = ref<Record<string, [number, number]>>({});

onMounted(() => {
  fetch("/instr/sweatbox/airways.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data) airways.value = data as AirwayGraph;
    })
    .catch(() => {});
  fetch("/airports.json")
    .then((response) => (response.ok ? response.json() : null))
    .then((data) => {
      if (data) airportCoords.value = data as Record<string, [number, number]>;
    })
    .catch(() => {});
});

const airportOptions = computed(() => {
  const needle = airportFilter.value.trim().toUpperCase();
  return props.airports
    .filter((entry) => !needle || entry.icao.includes(needle))
    .slice(0, 400)
    .map((entry) => ({
      value: entry.icao,
      label: entry.stands
        ? `${entry.icao} · ${t("standCount", { count: entry.stands })}`
        : `${entry.icao} · ${t("noStands")}`,
    }));
});

const runwayOptions = computed(() =>
  (airport.value?.runways ?? []).map((runway) => ({
    value: runway.id,
    label: `${runway.id} · ${String(runway.hdg).padStart(3, "0")}°`,
  })),
);

const arrivalRunway = computed<SweatboxRunway | null>(
  () =>
    airport.value?.runways.find((r) => r.id === arrivalRunwayId.value) ?? null,
);
const departureRunway = computed<SweatboxRunway | null>(
  () =>
    airport.value?.runways.find((r) => r.id === departureRunwayId.value) ??
    null,
);

/**
 * Field elevation is `number | null` — null omits `AIRPORT_ALT` — and an empty
 * text field is the only way to express that. `v-model.number` on a nullable
 * field would set it to `NaN` instead, which serialises as `AIRPORT_ALT:NaN`
 * and loads as zero.
 */
const elevationInput = computed<string | number>({
  get: () => (model.value.airportAlt === null ? "" : model.value.airportAlt),
  set: (value) => {
    const parsed = typeof value === "number" ? value : Number(value);
    model.value.airportAlt =
      value === "" || !Number.isFinite(parsed) ? null : parsed;
  },
});

// ---------------------------------------------------------------------------
// Profiles and traffic volume
// ---------------------------------------------------------------------------

const isPicked = (profile: ScenarioProfile) =>
  model.value.profiles.includes(profile);

function toggleProfile(profile: ScenarioProfile) {
  const list = model.value.profiles;
  const at = list.indexOf(profile);
  if (at >= 0) list.splice(at, 1);
  else list.push(profile);
}

/** Applying a preset overwrites all four counts, including unticked ones. */
function applyLevel(level: Exclude<TrafficLevel, "custom">) {
  model.value.traffic = level;
  model.value.counts = { ...TRAFFIC_COUNTS[level] };
}

/** Any hand edit takes the scenario off the presets — it is no longer one. */
function onCountEdited(profile: ScenarioProfile, value: number) {
  const clamped = Math.min(
    MAX_PER_PROFILE,
    Math.max(0, Math.round(value || 0)),
  );
  model.value.counts[profile] = clamped;
  model.value.traffic = "custom";
}

const plannedTotal = computed(() =>
  model.value.profiles.reduce(
    (sum, profile) => sum + (model.value.counts[profile] ?? 0),
    0,
  ),
);

/**
 * GND cannot put out more aircraft than the field has stands, and saying so
 * up front is better than silently generating fewer than asked for.
 */
const standShortfall = computed(() => {
  if (!airport.value || !isPicked("GND")) return 0;
  return Math.max(0, model.value.counts.GND - airport.value.stands.length);
});

// ---------------------------------------------------------------------------
// Loading an airport
// ---------------------------------------------------------------------------

watch(icao, async (value) => {
  airport.value = null;
  fixes.value = [];
  loadError.value = "";
  if (!value) return;

  loading.value = true;
  try {
    const response = await fetch(`/instr/sweatbox/${value}.json`);
    if (!response.ok) throw new Error(String(response.status));
    const payload = (await response.json()) as {
      airport: SweatboxAirport;
      fixes: SweatboxFix[];
    };
    airport.value = payload.airport;
    fixes.value = payload.fixes;

    model.value.airport = payload.airport.icao;
    model.value.airportAlt = payload.airport.elev;
    model.value.ils = payload.airport.runways.slice();

    // Default both runways to the first one listed. Which end is in use is a
    // wind decision the instructor makes; guessing it from a METAR this page
    // may not have been given would be a guess dressed as a default.
    const first = payload.airport.runways[0]?.id ?? "";
    arrivalRunwayId.value = first;
    departureRunwayId.value = first;

    // Stands and runways just changed underneath them.
    rows.value = [];
  } catch {
    loadError.value = t("loadFailed");
  } finally {
    loading.value = false;
  }
});

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

/** What each profile's distance and radial are measured from. */
function anchorFor(
  profile: ScenarioProfile,
): { lat: number; lon: number } | null {
  if (profile === "TWR") return arrivalRunway.value;
  if (profile === "DEP") return departureRunway.value;
  if (profile === "APP") return airport.value;
  return null;
}

/** Recompute a row's coordinates from its placement inputs. */
function replace(row: Row) {
  if (row.profile === "GND") {
    const stand = airport.value?.stands.find((s) => s.name === row.standName);
    if (!stand) return;
    row.lat = stand.lat;
    row.lon = stand.lon;
    // Moving an aircraft to another stand changes where it is, not which way it
    // faces or how high it is: no stand heading is published anywhere (see
    // `SweatboxStand`), and an aircraft on the ground is written at 0 and let
    // `AIRPORT_ALT` place it. Both stay whatever the row already says, so a
    // heading typed by hand survives a stand change.
    row.speed = 0;
    return;
  }

  const anchor = anchorFor(row.profile);
  if (!anchor) return;
  const placed = destination(anchor.lat, anchor.lon, row.radial, row.distance);
  row.lat = placed.lat;
  row.lon = placed.lon;
  // A departure flies away from its anchor; everything else flies back to it.
  row.heading =
    row.profile === "DEP"
      ? magneticToTrue(
          departureRunway.value?.hdg ?? row.heading,
          airport.value?.variation ?? null,
        )
      : Math.round(bearingTo(placed.lat, placed.lon, anchor.lat, anchor.lon));
}

/**
 * Recover the placement inputs from a generated aircraft's coordinates.
 *
 * The composer returns positions, not the bearing and distance it used, and
 * re-deriving them here is exact — the position *is* that bearing and distance
 * from the anchor. Threading them back through the return type would add a
 * field to the contract that only this function would ever read.
 */
function toRow(aircraft: ScenarioAircraft): Row {
  const anchor = anchorFor(aircraft.profile);
  const stand =
    aircraft.profile === "GND"
      ? airport.value?.stands.find(
          (s) => s.lat === aircraft.lat && s.lon === aircraft.lon,
        )
      : undefined;
  return {
    ...aircraft,
    standName: stand?.name ?? "",
    radial: anchor
      ? Math.round(
          bearingTo(anchor.lat, anchor.lon, aircraft.lat, aircraft.lon),
        )
      : 0,
    distance: anchor
      ? Number(
          distanceNm(
            anchor.lat,
            anchor.lon,
            aircraft.lat,
            aircraft.lon,
          ).toFixed(1),
        )
      : 0,
  };
}

const split = (value: string) =>
  value
    .split(/[,\s]+/)
    .map((part) => part.trim().toUpperCase())
    .filter(Boolean);

/** Compose the whole scenario's traffic, replacing whatever is in the table. */
function generate() {
  if (!airport.value || !arrivalRunway.value || !departureRunway.value) return;
  const produced = generateTraffic({
    airport: airport.value,
    profiles: model.value.profiles,
    counts: model.value.counts,
    arrivalRunway: arrivalRunway.value,
    departureRunway: departureRunway.value,
    airlines: split(sources.value.airlines),
    types: split(sources.value.types),
    partners: split(sources.value.partners),
    cruise: sources.value.cruise,
    taxiRoute: sources.value.taxiRoute,
    arrivalRadials: split(sources.value.radials)
      .map(Number)
      .filter((n) => Number.isFinite(n)),
    seed: sources.value.seed,
    airways: airways.value,
    airportCoords: airportCoords.value,
    equipment: sources.value.equipment.trim().toUpperCase(),
    spacing: spacing.value,
    fixes: fixes.value,
    errorRate: errorRate.value / 100,
    errorKinds: errorKinds.value,
  });
  rows.value = produced.map(toRow);
  notice.value = t("generated", { count: rows.value.length });
}

function addRow(profile: ScenarioProfile) {
  const row: Row = {
    ...emptyAircraft(profile),
    standName: "",
    radial: profile === "APP" ? 180 : 0,
    distance: profile === "GND" ? 0 : 10,
  };
  if (profile === "GND") {
    const taken = new Set(rows.value.map((existing) => existing.standName));
    const free = airport.value?.stands.find((stand) => !taken.has(stand.name));
    if (free) row.standName = free.name;
    row.departure = airport.value?.icao ?? "";
  } else if (profile === "DEP") {
    row.radial = departureRunway.value?.hdg ?? 0;
    row.departure = airport.value?.icao ?? "";
  } else {
    if (profile === "TWR") {
      row.radial = ((arrivalRunway.value?.hdg ?? 0) + 180) % 360;
    }
    row.destination = airport.value?.icao ?? "";
  }
  replace(row);
  rows.value.push(row);
}

const removeRow = (index: number) => rows.value.splice(index, 1);
const clearRows = () => {
  rows.value = [];
};

// ---------------------------------------------------------------------------
// Header editing
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Seats
// ---------------------------------------------------------------------------

/**
 * The seat list follows the airport and the ticked profiles **until it is
 * edited by hand, and then it stops following anything.**
 *
 * A scenario with no `CONTROLLER:` line is one EuroScope opens with nothing
 * staffed, and every aircraft belongs to `PSEUDOPILOT:ALL` — the trainee has to
 * take each one before it will answer. Ticking GND+TWR and getting
 * `ZBSJ_GND`/`ZBSJ_TWR` already filled in is what that tick meant.
 *
 * Following silently *after* an edit is the failure to avoid: an instructor who
 * has corrected 118.100 to their field's real 118.350 must not have it thrown
 * away by unticking DEP. So the auto-fill only replaces a list it recognises as
 * its own last output, which is what the two fingerprints below record.
 */
const seatFingerprint = (list: readonly ScenarioController[]) =>
  list.map((seat) => `${seat.callsign}\u0000${seat.frequency}`).join("\u0001");

let autoSeats = "";
let autoPseudopilot = "";

watch(
  [() => model.value.airport, () => model.value.profiles.join(",")],
  () => {
    const seats = defaultControllers(model.value.airport, model.value.profiles);
    if (seatFingerprint(model.value.controllers) === autoSeats) {
      model.value.controllers = seats;
      autoSeats = seatFingerprint(seats);
    }

    const seat = defaultPseudopilotFor(
      model.value.airport,
      model.value.profiles,
    );
    if (model.value.defaultPseudopilot === autoPseudopilot) {
      model.value.defaultPseudopilot = seat;
      autoPseudopilot = seat;
    }
  },
  { immediate: true },
);

const addController = () =>
  model.value.controllers.push({ callsign: "", frequency: "" });
const removeController = (index: number) =>
  model.value.controllers.splice(index, 1);

/**
 * What the default-seat picker offers.
 *
 * The scenario's own seats, plus whatever `defaultPseudopilot` already holds if
 * that is not one of them — renaming a seat after picking it as the default
 * must not silently drop the default to blank.
 */
const pseudopilotOptions = computed(() => {
  const seats = model.value.controllers
    .map((seat) => seat.callsign.trim())
    .filter(Boolean);
  const current = model.value.defaultPseudopilot.trim();
  if (current && !seats.includes(current)) seats.push(current);
  return [...new Set(seats)];
});
const addHolding = () =>
  model.value.holdings.push({ fix: "", inbound: 0, turn: 1 });
const removeHolding = (index: number) => model.value.holdings.splice(index, 1);
const addNamedRoute = () =>
  model.value.namedRoutes.push({ name: "", points: "" });
const removeNamedRoute = (index: number) =>
  model.value.namedRoutes.splice(index, 1);

function toggleIls(runwayId: string) {
  const list = model.value.ils;
  const at = list.findIndex((runway) => runway.id === runwayId);
  if (at >= 0) {
    list.splice(at, 1);
    return;
  }
  const runway = airport.value?.runways.find((entry) => entry.id === runwayId);
  if (runway) list.push(runway);
}

const ilsSelected = (runwayId: string) =>
  model.value.ils.some((runway) => runway.id === runwayId);

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const scenario = computed(() =>
  buildScenario({ ...model.value, aircraft: rows.value as ScenarioAircraft[] }),
);
const lineCount = computed(() => scenario.value.split("\r\n").length);
const named = computed(
  () => rows.value.filter((row) => row.callsign.trim()).length,
);

const perProfile = computed(() =>
  SCENARIO_PROFILES.map((profile) => ({
    profile,
    count: rows.value.filter((row) => row.profile === profile).length,
  })).filter((entry) => entry.count > 0),
);

/**
 * Rows that will not fly. A stand that no longer exists, a type with no
 * performance block, a duplicate callsign — each produces a file that loads
 * and then behaves oddly, which is far worse to debug than one that refuses.
 * So they are counted here, in front of the download.
 */
const problems = computed(() => {
  const list: string[] = [];
  if (!airport.value) return list;
  // A type with no performance block is a problem — unless it was planted as
  // one, in which case flagging it would hand the instructor their own answer
  // key as a warning.
  const missingType = rows.value.filter(
    (row) =>
      row.callsign.trim() &&
      !PERFORMANCE_TYPES.includes(row.type) &&
      !row.errors.includes("type"),
  );
  if (missingType.length) {
    list.push(t("problems.type", { count: missingType.length }));
  }
  const unplaced = rows.value.filter(
    (row) => row.callsign.trim() && row.lat === 0 && row.lon === 0,
  );
  if (unplaced.length) {
    list.push(t("problems.unplaced", { count: unplaced.length }));
  }
  const duplicates = rows.value
    .map((row) => row.callsign.trim())
    .filter(
      (callsign, index, all) => callsign && all.indexOf(callsign) !== index,
    );
  if (duplicates.length) {
    list.push(t("problems.duplicate", { count: new Set(duplicates).size }));
  }
  if (model.value.airportAlt === null) list.push(t("problems.elevation"));
  if (standShortfall.value > 0) {
    list.push(t("problems.stands", { count: standShortfall.value }));
  }
  return list;
});

function stamp(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("");
}

function download() {
  const blob = new Blob([scenario.value], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = scenarioFilename(model.value, stamp());
  anchor.click();
  URL.revokeObjectURL(url);
}

async function copy() {
  try {
    await navigator.clipboard.writeText(scenario.value);
    notice.value = t("copied");
  } catch {
    notice.value = t("copyFailed");
  }
}
</script>

<template>
  <div class="animate-fade-up">
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="commandLine"
      divided
    >
      <template #actions>
        <div class="flex flex-wrap gap-2">
          <Button variant="secondary" :disabled="!named" @click="copy">
            <template #icon
              ><Icon name="documentText" class="size-4"
            /></template>
            {{ t("copy") }}
          </Button>
          <Button :disabled="!named" @click="download">
            <template #icon
              ><Icon name="arrowDownTray" class="size-4"
            /></template>
            {{ t("download") }}
          </Button>
        </div>
      </template>
    </PageHeader>

    <AlertBox
      v-if="notice"
      variant="success"
      dismissible
      class="mb-6"
      @dismiss="notice = ''"
    >
      {{ notice }}
    </AlertBox>
    <AlertBox v-if="loadError" variant="danger" class="mb-6">
      {{ loadError }}
    </AlertBox>

    <div class="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
      <div class="flex min-w-0 flex-col gap-6">
        <!-- Field and seats ------------------------------------------------->
        <Card :title="t('setup.title')" :subtitle="t('setup.subtitle')">
          <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div class="sm:col-span-2 lg:col-span-1">
              <label
                for="sweatbox-airport"
                class="block text-sm font-medium text-ink"
              >
                {{ t("setup.airport") }}
              </label>
              <input
                v-model="airportFilter"
                class="input mt-1.5"
                :placeholder="t('setup.airportFilter')"
                maxlength="4"
              />
              <select id="sweatbox-airport" v-model="icao" class="input mt-2">
                <option value="">{{ t("setup.airportPlaceholder") }}</option>
                <option
                  v-for="option in airportOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
            </div>
            <Input
              v-model="elevationInput"
              type="number"
              :label="t('setup.elevation')"
              :hint="t('setup.elevationHint')"
              name="sweatbox-elev"
            />
            <div>
              <label
                for="sweatbox-arr"
                class="block text-sm font-medium text-ink"
              >
                {{ t("setup.arrivalRunway") }}
              </label>
              <select
                id="sweatbox-arr"
                v-model="arrivalRunwayId"
                class="input mt-1.5"
                :disabled="!airport"
              >
                <option
                  v-for="option in runwayOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <p class="mt-1.5 text-xs text-faint">
                {{ t("setup.arrivalRunwayHint") }}
              </p>
            </div>
            <div>
              <label
                for="sweatbox-dep"
                class="block text-sm font-medium text-ink"
              >
                {{ t("setup.departureRunway") }}
              </label>
              <select
                id="sweatbox-dep"
                v-model="departureRunwayId"
                class="input mt-1.5"
                :disabled="!airport"
              >
                <option
                  v-for="option in runwayOptions"
                  :key="option.value"
                  :value="option.value"
                >
                  {{ option.label }}
                </option>
              </select>
              <p class="mt-1.5 text-xs text-faint">
                {{ t("setup.departureRunwayHint") }}
              </p>
            </div>
          </div>

          <!-- Seats -->
          <div class="mt-6">
            <p class="text-sm font-medium text-ink">
              {{ t("setup.profiles") }}
            </p>
            <p class="mt-1 text-xs text-faint">{{ t("setup.profilesHint") }}</p>
            <div class="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <button
                v-for="profile in SCENARIO_PROFILES"
                :key="profile"
                type="button"
                :aria-pressed="isPicked(profile)"
                :class="[
                  'flex flex-col items-start gap-1 rounded-control border p-3 text-left transition-colors',
                  isPicked(profile)
                    ? 'border-can bg-info-bg'
                    : 'border-subtle bg-surface hover:bg-surface-sunken',
                ]"
                @click="toggleProfile(profile)"
              >
                <span class="flex w-full items-center justify-between gap-2">
                  <span class="text-sm font-semibold text-ink">
                    {{ t(`profiles.${profile}.name`) }}
                  </span>
                  <Icon
                    v-if="isPicked(profile)"
                    name="checkCircle"
                    class="size-4 text-can"
                  />
                </span>
                <span class="text-xs text-muted">
                  {{ t(`profiles.${profile}.hint`) }}
                </span>
              </button>
            </div>
          </div>

          <!-- Traffic volume -->
          <div class="mt-6">
            <div class="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p class="text-sm font-medium text-ink">
                  {{ t("setup.traffic") }}
                </p>
                <p class="mt-1 text-xs text-faint">
                  {{ t("setup.trafficHint") }}
                </p>
              </div>
              <div class="flex flex-wrap items-center gap-2">
                <button
                  v-for="level in TRAFFIC_LEVELS"
                  :key="level"
                  type="button"
                  :aria-pressed="model.traffic === level"
                  :class="[
                    'badge',
                    model.traffic === level ? 'badge-info' : 'badge-neutral',
                  ]"
                  @click="applyLevel(level)"
                >
                  {{ t(`levels.${level}`) }}
                </button>
                <Badge v-if="model.traffic === 'custom'" variant="warning">
                  {{ t("levels.custom") }}
                </Badge>
              </div>
            </div>

            <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div
                v-for="profile in SCENARIO_PROFILES"
                :key="`count-${profile}`"
                :class="isPicked(profile) ? '' : 'opacity-50'"
              >
                <label
                  :for="`count-${profile}`"
                  class="block text-xs font-medium text-muted"
                >
                  {{ t(`profiles.${profile}.name`) }}
                </label>
                <input
                  :id="`count-${profile}`"
                  class="input mt-1"
                  type="number"
                  min="0"
                  :max="MAX_PER_PROFILE"
                  :disabled="!isPicked(profile)"
                  :value="model.counts[profile]"
                  @input="
                    onCountEdited(
                      profile,
                      Number(($event.target as HTMLInputElement).value),
                    )
                  "
                />
              </div>
            </div>

            <!-- Spacing -->
            <div class="mt-6">
              <p class="text-sm font-medium text-ink">
                {{ t("setup.spacing") }}
              </p>
              <p class="mt-1 text-xs text-faint">
                {{ t("setup.spacingHint") }}
              </p>
              <div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <div
                  v-for="profile in SCENARIO_PROFILES"
                  :key="`gap-${profile}`"
                  :class="isPicked(profile) ? '' : 'opacity-50'"
                >
                  <span class="block text-xs font-medium text-muted">
                    {{ t(`profiles.${profile}.name`) }}
                  </span>
                  <div class="mt-1 flex items-center gap-1">
                    <input
                      v-model.number="spacing[profile].min"
                      type="number"
                      min="0"
                      step="0.5"
                      class="input w-16"
                      :disabled="!isPicked(profile)"
                      :aria-label="t('setup.spacingMin')"
                    />
                    <span class="text-faint">–</span>
                    <input
                      v-model.number="spacing[profile].max"
                      type="number"
                      min="0"
                      step="0.5"
                      class="input w-16"
                      :disabled="!isPicked(profile)"
                      :aria-label="t('setup.spacingMax')"
                    />
                    <span class="text-xs text-faint">{{
                      t("setup.minutes")
                    }}</span>
                  </div>
                </div>
              </div>
            </div>

            <!-- Deliberate mistakes -->
            <div class="mt-6">
              <div class="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p class="text-sm font-medium text-ink">
                    {{ t("errors.title") }}
                  </p>
                  <p class="mt-1 text-xs text-faint">{{ t("errors.hint") }}</p>
                </div>
                <div class="flex items-center gap-2">
                  <input
                    v-model.number="errorRate"
                    type="range"
                    min="0"
                    max="60"
                    step="5"
                    class="w-40"
                    :aria-label="t('errors.rate')"
                  />
                  <span class="w-10 text-right text-sm font-medium text-ink">
                    {{ errorRate }}%
                  </span>
                </div>
              </div>
              <div v-if="errorRate > 0" class="mt-3 flex flex-wrap gap-2">
                <button
                  v-for="kind in SCENARIO_ERROR_KINDS"
                  :key="kind"
                  type="button"
                  :aria-pressed="errorKinds.includes(kind)"
                  :class="[
                    'badge',
                    errorKinds.includes(kind)
                      ? 'badge-warning'
                      : 'badge-neutral',
                  ]"
                  @click="toggleErrorKind(kind)"
                >
                  {{ t(`errors.kinds.${kind}`) }}
                </button>
              </div>
            </div>

            <div class="mt-4 flex flex-wrap items-center gap-3">
              <Button
                :disabled="!airport || !model.profiles.length"
                @click="generate"
              >
                <template #icon
                  ><Icon name="sparkles" class="size-4"
                /></template>
                {{ rows.length ? t("regenerate") : t("generate") }}
              </Button>
              <Button variant="ghost" size="sm" @click="sourcesOpen = true">
                <template #icon
                  ><Icon name="adjustments" class="size-4"
                /></template>
                {{ t("sources.open") }}
              </Button>
              <span class="text-xs text-faint">
                {{ t("setup.plannedTotal", { count: plannedTotal }) }}
              </span>
            </div>
          </div>
        </Card>

        <!-- Scenario header ------------------------------------------------->
        <Card :title="t('header.title')" :subtitle="t('header.subtitle')">
          <Input
            v-model="model.metar"
            :label="t('setup.metar')"
            :hint="t('setup.metarHint')"
            name="sweatbox-metar"
            placeholder="METAR ZGGG 171300Z 02003MPS CAVOK 28/22 Q1010 NOSIG="
          />

          <div v-if="airport" class="mt-6">
            <p class="text-sm font-medium text-ink">{{ t("setup.ils") }}</p>
            <p class="mt-1 text-xs text-faint">{{ t("setup.ilsHint") }}</p>
            <div class="mt-2 flex flex-wrap gap-2">
              <button
                v-for="runway in airport.runways"
                :key="runway.id"
                type="button"
                :class="[
                  'badge',
                  ilsSelected(runway.id) ? 'badge-info' : 'badge-neutral',
                ]"
                :aria-pressed="ilsSelected(runway.id)"
                @click="toggleIls(runway.id)"
              >
                {{ runway.id }}
              </button>
            </div>
          </div>

          <div class="mt-6">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-ink">
                {{ t("setup.controllers") }}
              </p>
              <Button size="sm" variant="ghost" @click="addController">
                <template #icon><Icon name="plus" class="size-4" /></template>
                {{ t("add") }}
              </Button>
            </div>
            <p class="mt-1 text-xs text-faint">
              {{ t("setup.controllersHint") }}
            </p>
            <div
              v-for="(controller, index) in model.controllers"
              :key="`ctl-${index}`"
              class="mt-2 flex gap-2"
            >
              <input
                v-model="controller.callsign"
                class="input flex-1"
                :aria-label="t('setup.controllerCallsign')"
                placeholder="ZGGG_TWR"
              />
              <input
                v-model="controller.frequency"
                class="input w-28"
                :aria-label="t('setup.controllerFrequency')"
                placeholder="118.100"
              />
              <Button
                size="sm"
                variant="ghost"
                icon-only
                :aria-label="t('remove')"
                @click="removeController(index)"
              >
                <template #icon><Icon name="xMark" class="size-4" /></template>
              </Button>
            </div>

            <label
              for="sweatbox-initial-seat"
              class="mt-4 block text-sm font-medium text-ink"
            >
              {{ t("setup.initialSeat") }}
            </label>
            <p class="mt-1 text-xs text-faint">
              {{ t("setup.initialSeatHint") }}
            </p>
            <select
              id="sweatbox-initial-seat"
              v-model="model.defaultPseudopilot"
              class="input mt-2"
            >
              <option value="">{{ t("setup.initialSeatNone") }}</option>
              <option
                v-for="seat in pseudopilotOptions"
                :key="seat"
                :value="seat"
              >
                {{ seat }}
              </option>
            </select>
          </div>

          <div v-if="isPicked('APP')" class="mt-6">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-ink">
                {{ t("setup.holdings") }}
              </p>
              <Button size="sm" variant="ghost" @click="addHolding">
                <template #icon><Icon name="plus" class="size-4" /></template>
                {{ t("add") }}
              </Button>
            </div>
            <div
              v-for="(holding, index) in model.holdings"
              :key="`hold-${index}`"
              class="mt-2 flex gap-2"
            >
              <input
                v-model="holding.fix"
                class="input flex-1"
                list="sweatbox-fixes"
                placeholder="UU910"
              />
              <input
                v-model.number="holding.inbound"
                type="number"
                class="input w-24"
                :aria-label="t('setup.inbound')"
              />
              <select v-model.number="holding.turn" class="input w-28">
                <option :value="1">{{ t("setup.right") }}</option>
                <option :value="-1">{{ t("setup.left") }}</option>
              </select>
              <Button
                size="sm"
                variant="ghost"
                icon-only
                :aria-label="t('remove')"
                @click="removeHolding(index)"
              >
                <template #icon><Icon name="xMark" class="size-4" /></template>
              </Button>
            </div>
          </div>

          <div v-if="isPicked('GND') || isPicked('DEP')" class="mt-6">
            <div class="flex items-center justify-between gap-3">
              <p class="text-sm font-medium text-ink">
                {{ t("setup.routes") }}
              </p>
              <Button size="sm" variant="ghost" @click="addNamedRoute">
                <template #icon><Icon name="plus" class="size-4" /></template>
                {{ t("add") }}
              </Button>
            </div>
            <p class="mt-1 text-xs text-faint">{{ t("setup.routesHint") }}</p>
            <div
              v-for="(route, index) in model.namedRoutes"
              :key="`route-${index}`"
              class="mt-2 flex gap-2"
            >
              <input
                v-model="route.name"
                class="input w-40"
                placeholder="YIN86D01"
              />
              <input
                v-model="route.points"
                class="input flex-1"
                placeholder="D016L D189Y D189M YIN"
              />
              <Button
                size="sm"
                variant="ghost"
                icon-only
                :aria-label="t('remove')"
                @click="removeNamedRoute(index)"
              >
                <template #icon><Icon name="xMark" class="size-4" /></template>
              </Button>
            </div>
          </div>
        </Card>

        <!-- Aircraft -------------------------------------------------------->
        <Card padding="none">
          <template #header>
            <div
              class="flex flex-wrap items-center justify-between gap-3 border-b border-subtle p-6"
            >
              <div>
                <h2 class="text-base font-semibold text-ink">
                  {{ t("aircraft.title") }}
                </h2>
                <div class="mt-1 flex flex-wrap items-center gap-2">
                  <span class="text-sm text-muted">
                    {{ t("aircraft.count", { count: rows.length }) }}
                  </span>
                  <Badge
                    v-for="entry in perProfile"
                    :key="entry.profile"
                    size="sm"
                    variant="info"
                  >
                    {{ entry.profile }} {{ entry.count }}
                  </Badge>
                </div>
              </div>
              <div class="flex flex-wrap gap-2">
                <Button
                  v-for="profile in model.profiles"
                  :key="`add-${profile}`"
                  size="sm"
                  variant="secondary"
                  :disabled="!airport"
                  @click="addRow(profile)"
                >
                  <template #icon><Icon name="plus" class="size-4" /></template>
                  {{ profile }}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  :disabled="!rows.length"
                  @click="clearRows"
                >
                  {{ t("aircraft.clear") }}
                </Button>
              </div>
            </div>
          </template>

          <div v-if="loading" class="flex justify-center p-10">
            <Spinner />
          </div>
          <EmptyState
            v-else-if="!airport"
            :title="t('aircraft.pickAirport')"
            :description="t('aircraft.pickAirportHint')"
            icon="buildingOffice"
            class="p-10"
          />
          <EmptyState
            v-else-if="!rows.length"
            :title="t('aircraft.empty')"
            :description="t('aircraft.emptyHint')"
            icon="paperAirplane"
            class="p-10"
          />

          <div v-else class="overflow-x-auto">
            <table class="w-full min-w-[70rem] text-sm">
              <thead
                class="border-b border-subtle text-left text-xs text-faint"
              >
                <tr>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.seat") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.callsign") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.type") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.equipment") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.cruise") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.position") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.altitude") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.heading") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.speed") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.origin") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.dest") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.route") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.start") }}
                  </th>
                  <th class="px-3 py-2 font-medium">
                    {{ t("aircraft.delay") }}
                  </th>
                  <th class="w-10 px-3 py-2"></th>
                </tr>
              </thead>
              <tbody class="divide-y divide-subtle">
                <tr v-for="(row, index) in rows" :key="`row-${index}`">
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-1">
                      <Badge size="sm" variant="neutral">
                        {{ row.profile }}
                      </Badge>
                      <Badge
                        v-if="row.errors.length"
                        size="sm"
                        variant="warning"
                        :title="
                          row.errors
                            .map((k) => t(`errors.kinds.${k}`))
                            .join(' / ')
                        "
                      >
                        !
                      </Badge>
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <input
                      v-model="row.callsign"
                      class="input w-28"
                      placeholder="CSN3101"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <select v-model="row.type" class="input w-24">
                      <option
                        v-for="type in PERFORMANCE_TYPES"
                        :key="type"
                        :value="type"
                      >
                        {{ type }}
                      </option>
                    </select>
                  </td>
                  <td class="px-3 py-2">
                    <select v-model="row.equipment" class="input w-20">
                      <option value="">—</option>
                      <option
                        v-for="suffix in EQUIPMENT_SUFFIXES"
                        :key="suffix.value"
                        :value="suffix.value"
                      >
                        {{ suffix.value }}
                      </option>
                    </select>
                  </td>
                  <td class="px-3 py-2">
                    <input v-model="row.cruise" class="input w-24" />
                  </td>

                  <td class="px-3 py-2">
                    <select
                      v-if="row.profile === 'GND'"
                      v-model="row.standName"
                      class="input w-32"
                      @change="replace(row)"
                    >
                      <option value="">—</option>
                      <option
                        v-for="stand in airport?.stands ?? []"
                        :key="stand.name"
                        :value="stand.name"
                      >
                        {{ stand.name }}
                      </option>
                    </select>
                    <div v-else class="flex items-center gap-1">
                      <input
                        v-if="row.profile === 'APP'"
                        v-model.number="row.radial"
                        type="number"
                        class="input w-16"
                        :aria-label="t('aircraft.radial')"
                        @change="replace(row)"
                      />
                      <input
                        v-model.number="row.distance"
                        type="number"
                        step="0.1"
                        class="input w-20"
                        :aria-label="t('aircraft.distance')"
                        @change="replace(row)"
                      />
                      <span class="text-xs text-faint">NM</span>
                    </div>
                  </td>

                  <td class="px-3 py-2">
                    <input
                      v-model.number="row.altitude"
                      type="number"
                      class="input w-24"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <input
                      v-model.number="row.heading"
                      type="number"
                      min="0"
                      max="359"
                      class="input w-20"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <input
                      v-model.number="row.speed"
                      type="number"
                      class="input w-20"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <input
                      v-model="row.departure"
                      class="input w-24"
                      maxlength="4"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <input
                      v-model="row.destination"
                      class="input w-24"
                      maxlength="4"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <input v-model="row.route" class="input w-52" />
                  </td>
                  <td class="px-3 py-2">
                    <input
                      v-model.number="row.start"
                      type="number"
                      step="0.5"
                      class="input w-20"
                      :placeholder="t('aircraft.startPlaceholder')"
                    />
                  </td>
                  <td class="px-3 py-2">
                    <div class="flex items-center gap-1">
                      <input
                        v-model.number="row.delayFrom"
                        type="number"
                        class="input w-16"
                        :aria-label="t('aircraft.delayFrom')"
                      />
                      <span class="text-faint">–</span>
                      <input
                        v-model.number="row.delayTo"
                        type="number"
                        class="input w-16"
                        :aria-label="t('aircraft.delayTo')"
                      />
                    </div>
                  </td>
                  <td class="px-3 py-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      icon-only
                      :aria-label="t('remove')"
                      @click="removeRow(index)"
                    >
                      <template #icon
                        ><Icon name="xMark" class="size-4"
                      /></template>
                    </Button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      <!-- Preview ----------------------------------------------------------->
      <div class="flex min-w-0 flex-col gap-4 xl:sticky xl:top-6 xl:self-start">
        <Card padding="none">
          <template #header>
            <div
              class="flex items-center justify-between gap-3 border-b border-subtle p-4"
            >
              <h2 class="text-sm font-semibold text-ink">
                {{ t("preview.title") }}
              </h2>
              <Badge variant="neutral">
                {{ t("preview.lines", { count: lineCount }) }}
              </Badge>
            </div>
          </template>
          <div v-if="problems.length" class="border-b border-subtle p-4">
            <AlertBox variant="warning" :title="t('preview.problems')">
              <ul class="list-inside list-disc space-y-1">
                <li v-for="problem in problems" :key="problem">
                  {{ problem }}
                </li>
              </ul>
            </AlertBox>
          </div>
          <pre
            class="max-h-[32rem] overflow-auto p-4 font-mono text-xs leading-relaxed text-muted"
            >{{ scenario }}</pre>
        </Card>
        <Card v-if="plantedErrors.length" padding="none">
          <template #header>
            <div
              class="flex items-center justify-between gap-3 border-b border-subtle p-4"
            >
              <h2 class="text-sm font-semibold text-ink">
                {{ t("errors.keyTitle") }}
              </h2>
              <Badge variant="warning">
                {{ plantedErrors.length }}
              </Badge>
            </div>
          </template>
          <p class="px-4 pt-3 text-xs text-faint">{{ t("errors.keyHint") }}</p>
          <ul class="max-h-64 space-y-1 overflow-auto p-4 text-sm">
            <li
              v-for="entry in plantedErrors"
              :key="entry.callsign"
              class="flex items-baseline justify-between gap-3"
            >
              <span class="font-mono text-ink">{{ entry.callsign }}</span>
              <span class="text-right text-muted">{{ entry.kinds }}</span>
            </li>
          </ul>
        </Card>
        <p class="text-xs text-faint">{{ t("preview.hint") }}</p>
      </div>
    </div>

    <!--
      Every fix in the FIR, for the holding editor's autocomplete. A datalist
      rather than a select: a hold is published on one specific fix, so the
      instructor knows the name and wants to type it — but typing it blind is
      how `HOLDING:UU901:...` gets written for UU910 and silently does nothing.
    -->
    <datalist id="sweatbox-fixes">
      <option v-for="fix in fixes" :key="fix.name" :value="fix.name"></option>
    </datalist>

    <!-- Traffic sources ----------------------------------------------------->
    <Dialog
      v-model:open="sourcesOpen"
      :title="t('sources.title')"
      :description="t('sources.description')"
      :close-label="t('cancel')"
      size="lg"
    >
      <div class="grid gap-4 sm:grid-cols-2">
        <Input
          v-model="sources.airlines"
          :label="t('sources.airlines')"
          :hint="t('sources.airlinesHint')"
          name="src-airlines"
        />
        <Input
          v-model="sources.types"
          :label="t('sources.types')"
          :hint="t('sources.typesHint')"
          name="src-types"
        />
        <Input
          v-model="sources.partners"
          :label="t('sources.partners')"
          :hint="t('sources.partnersHint')"
          name="src-partners"
        />
        <div>
          <label for="src-equipment" class="block text-sm font-medium text-ink">
            {{ t("sources.equipment") }}
          </label>
          <select
            id="src-equipment"
            v-model="sources.equipment"
            class="input mt-1.5"
          >
            <option
              v-for="suffix in EQUIPMENT_SUFFIXES"
              :key="suffix.value"
              :value="suffix.value"
            >
              {{ suffix.label }}
            </option>
          </select>
          <p class="mt-1.5 text-xs text-faint">
            {{ t("sources.equipmentHint") }}
          </p>
        </div>
        <Input
          v-model="sources.cruise"
          :label="t('sources.cruise')"
          :hint="t('sources.cruiseHint')"
          name="src-cruise"
        />
        <Input
          v-model="sources.taxiRoute"
          :label="t('sources.taxi')"
          :hint="t('sources.taxiHint')"
          name="src-taxi"
        />
        <Input
          v-model="sources.radials"
          :label="t('sources.radials')"
          :hint="t('sources.radialsHint')"
          name="src-radials"
        />
        <Input
          v-model.number="sources.seed"
          type="number"
          :label="t('sources.seed')"
          :hint="t('sources.seedHint')"
          name="src-seed"
        />
      </div>

      <template #footer>
        <Button variant="secondary" @click="sourcesOpen = false">
          {{ t("cancel") }}
        </Button>
        <Button
          :disabled="!airport || !model.profiles.length"
          @click="
            sourcesOpen = false;
            generate();
          "
        >
          {{ t("sources.apply") }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
