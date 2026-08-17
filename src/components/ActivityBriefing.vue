<script setup lang="ts">
/**
 * The SUP-side briefing editor for one activity: the legs the fleet flies and
 * the ATC seats controllers can claim.
 *
 * A modal of its own rather than more rows in ManageActivities, because it is
 * the one screen in the activity flow with two independent lists on it, and it
 * owns its own loads and errors. The parent only says which activity and gets
 * told when something changed, so the list behind it can refresh its counts.
 *
 * Everything here is create/delete rather than edit-in-place, with one
 * exception: a seat's frequency and rating gate stay editable, because those
 * are the two things that get settled after the seat list is already published.
 * The airport, seat type and callsign identify a seat somebody has claimed, so
 * changing them would move a controller without telling them.
 */
import { computed, onMounted, ref, watch } from "vue";
import { createTranslator } from "@/lib/i18n";
import { ratingTrans } from "@/lib/tools";
import {
  BOOKABLE_FACILITIES,
  DEFAULT_FACILITY_MIN_RATING,
  FACILITY_CODES,
  FACILITY_KEYS,
  MAX_DESCRIPTION_LENGTH,
  MAX_ROUTE_LENGTH,
  defaultCallsign,
  isValidIcao,
  normalizeIcao,
  type ActivityFacility,
} from "@/lib/activities";
import {
  AlertBox,
  Badge,
  Button,
  Dialog,
  Icon,
  Input,
  Select,
  Skeleton,
} from "@jianyuelab-org/can-ui";
import { apiFetch } from "@/lib/canApi";

const props = defineProps<{
  activityId: number;
  activityTitle: string;
  /** Settled or cancelled — the briefing becomes a read-only record. */
  locked: boolean;
  messages: Record<string, unknown>;
}>();
const emit = defineEmits<{ (e: "close"): void; (e: "changed"): void }>();

const t = createTranslator(props.messages);

/**
 * Mounted already open — `BaseDialog` handles that case, which is why this can
 * start `true` rather than being flipped in `onMounted` the way it used to be.
 * The dialog closes itself on Escape and on the backdrop, so the parent's
 * `v-if` follows this ref rather than each dismissal path remembering to emit.
 */
const open = ref(true);
watch(open, (value) => {
  if (!value) emit("close");
});

interface Route {
  id: number;
  departure: string;
  arrival: string;
  route: string | null;
  aircraft: string | null;
  cruise: string | null;
  remarks: string | null;
}
interface Position {
  id: number;
  airport: string;
  facility: number;
  callsign: string;
  frequency: string | null;
  minRating: number;
  username: string | null;
  name: string | null;
}

const routes = ref<Route[]>([]);
const positions = ref<Position[]>([]);
const loading = ref(true);
const busy = ref(false);
const feedback = ref<{ type: "success" | "error"; text: string } | null>(null);

const tab = ref<"routes" | "positions">("routes");

const routeForm = ref({
  departure: "",
  arrival: "",
  route: "",
  aircraft: "",
  cruise: "",
  remarks: "",
});

const seatForm = ref({
  airport: "",
  facility: String(BOOKABLE_FACILITIES[0]),
  callsign: "",
  frequency: "",
  minRating: String(DEFAULT_FACILITY_MIN_RATING[BOOKABLE_FACILITIES[0]]),
});

const facilityOptions = computed(() =>
  BOOKABLE_FACILITIES.map((f) => ({
    value: String(f),
    label: `${FACILITY_CODES[f]} · ${t(`facilities.${FACILITY_KEYS[f]}`)}`,
  })),
);

/** Rating gate choices, shown the way controllers name them ("S2"), not as ints. */
const ratingOptions = computed(() =>
  Array.from({ length: 14 }, (_, i) => i - 1).map((r) => ({
    value: String(r),
    label: `${r} · ${ratingTrans(r, "en", "short")}`,
  })),
);

/** Picking a seat type retargets the callsign and the default rating gate. */
function onFacilityChange(value: string) {
  seatForm.value.facility = value;
  const facility = Number(value) as ActivityFacility;
  seatForm.value.minRating = String(DEFAULT_FACILITY_MIN_RATING[facility]);
}

/** What the callsign will be if the field is left blank. */
const callsignPlaceholder = computed(() => {
  const icao = normalizeIcao(seatForm.value.airport);
  if (!isValidIcao(icao)) return "ZBAA_TWR";
  return defaultCallsign(
    icao,
    Number(seatForm.value.facility) as ActivityFacility,
  );
});

function facilityCode(facility: number): string {
  return FACILITY_CODES[facility as ActivityFacility] ?? String(facility);
}
function ratingCode(rating: number): string {
  return ratingTrans(rating, "en", "short") as string;
}

async function load(silent = false) {
  if (!silent) loading.value = true;
  try {
    const res = await apiFetch(`/api/v1/super/activity/${props.activityId}`);
    if (!res.ok) throw new Error();
    const data = (await res.json()).data;
    routes.value = data.routes ?? [];
    positions.value = data.positions ?? [];
  } catch {
    feedback.value = { type: "error", text: t("loadError") };
  } finally {
    if (!silent) loading.value = false;
  }
}

/**
 * Every mutation here is the same PATCH with a different action, so they share
 * one caller: it surfaces the server's own error code when there is a message
 * for it (a duplicate callsign, a claimed seat) and refreshes on success.
 */
const KNOWN_ERRORS = [
  "invalidIcao",
  "invalidCallsign",
  "invalidFrequency",
  "invalidMinRating",
  "duplicateCallsign",
  "positionClaimed",
  "holderBelowRating",
  "tooManyRoutes",
  "tooManyPositions",
  "briefingLocked",
  "routeTooLong",
];

async function act(
  body: Record<string, unknown>,
  successKey: string,
): Promise<boolean> {
  if (busy.value) return false;
  busy.value = true;
  feedback.value = null;
  try {
    const res = await apiFetch(`/api/v1/super/activity/${props.activityId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const code = payload.error;
      throw new Error(
        typeof code === "string" && KNOWN_ERRORS.includes(code)
          ? t(`errors.${code}`)
          : t("actionFailed"),
      );
    }
    feedback.value = { type: "success", text: t(successKey) };
    await load(true);
    emit("changed");
    return true;
  } catch (e) {
    feedback.value = {
      type: "error",
      text: e instanceof Error ? e.message : t("actionFailed"),
    };
    return false;
  } finally {
    busy.value = false;
  }
}

async function addRoute() {
  const departure = normalizeIcao(routeForm.value.departure);
  const arrival = normalizeIcao(routeForm.value.arrival);
  if (!isValidIcao(departure) || !isValidIcao(arrival)) {
    feedback.value = { type: "error", text: t("errors.invalidIcao") };
    return;
  }
  const ok = await act(
    {
      action: "addRoute",
      departure,
      arrival,
      route: routeForm.value.route.trim(),
      aircraft: routeForm.value.aircraft.trim(),
      cruise: routeForm.value.cruise.trim(),
      remarks: routeForm.value.remarks.trim(),
    },
    "routeAdded",
  );
  if (ok) {
    routeForm.value = {
      departure: "",
      arrival: "",
      route: "",
      aircraft: "",
      cruise: "",
      remarks: "",
    };
  }
}

async function addPosition() {
  const airport = normalizeIcao(seatForm.value.airport);
  if (!isValidIcao(airport)) {
    feedback.value = { type: "error", text: t("errors.invalidIcao") };
    return;
  }
  const ok = await act(
    {
      action: "addPosition",
      airport,
      facility: Number(seatForm.value.facility),
      callsign: seatForm.value.callsign.trim(),
      frequency: seatForm.value.frequency.trim(),
      minRating: Number(seatForm.value.minRating),
    },
    "positionAdded",
  );
  // The airport and seat type are kept: opening a tower after a ground is the
  // common next press, and retyping the ICAO five times is the tedium this
  // form exists to remove.
  if (ok) {
    seatForm.value.callsign = "";
    seatForm.value.frequency = "";
  }
}

/**
 * Opens every unclaimed seat type at one airport in one press — the ordinary
 * case for an event field. Already-open seats come back as `duplicateCallsign`,
 * which is not an error worth showing here, so they are simply skipped.
 */
async function addAllPositions() {
  const airport = normalizeIcao(seatForm.value.airport);
  if (!isValidIcao(airport)) {
    feedback.value = { type: "error", text: t("errors.invalidIcao") };
    return;
  }
  if (busy.value) return;
  busy.value = true;
  feedback.value = null;
  let added = 0;
  // Kept so "nothing was added" can say *why* — all five already open reads
  // very differently from the seat cap being reached.
  let lastError: unknown = null;
  try {
    for (const facility of BOOKABLE_FACILITIES) {
      const res = await apiFetch(`/api/v1/super/activity/${props.activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addPosition",
          airport,
          facility,
          minRating: DEFAULT_FACILITY_MIN_RATING[facility],
        }),
      });
      if (res.ok) {
        added++;
      } else {
        lastError = (await res.json().catch(() => ({}))).error;
      }
    }
    feedback.value = added
      ? {
          type: "success",
          text: t("positionsAdded", { count: String(added), airport }),
        }
      : {
          type: "error",
          text:
            typeof lastError === "string" && KNOWN_ERRORS.includes(lastError)
              ? t(`errors.${lastError}`)
              : t("actionFailed"),
        };
    await load(true);
    emit("changed");
  } finally {
    busy.value = false;
  }
}

/** Frequency / rating-gate edits, applied per row on blur-and-save. */
const editingId = ref<number | null>(null);
const editDraft = ref({ frequency: "", minRating: "-1" });

function startEdit(position: Position) {
  editingId.value = position.id;
  editDraft.value = {
    frequency: position.frequency ?? "",
    minRating: String(position.minRating),
  };
}

async function saveEdit(position: Position) {
  const ok = await act(
    {
      action: "updatePosition",
      positionId: position.id,
      frequency: editDraft.value.frequency.trim(),
      minRating: Number(editDraft.value.minRating),
    },
    "positionUpdated",
  );
  if (ok) editingId.value = null;
}

onMounted(load);
</script>

<template>
  <Dialog
    v-model:open="open"
    size="lg"
    :title="activityTitle"
    :description="t('briefingHint')"
    :close-label="t('close')"
  >
    <!-- Two lists, one at a time: side by side they would each get half a
         phone's width. In the toolbar slot, so the tabs stay put while the
         list under them scrolls. -->
    <template #toolbar>
      <div class="flex gap-1 border-b border-subtle px-5 pt-3">
        <button
          v-for="entry in [
            { key: 'routes', label: t('routes'), count: routes.length },
            {
              key: 'positions',
              label: t('positions'),
              count: positions.length,
            },
          ]"
          :key="entry.key"
          type="button"
          :class="[
            '-mb-px inline-flex items-center gap-2 border-b-2 px-3 py-2 text-sm font-medium transition',
            tab === entry.key
              ? 'border-can text-can'
              : 'border-transparent text-muted hover:text-ink',
          ]"
          @click="tab = entry.key as 'routes' | 'positions'"
        >
          {{ entry.label }}
          <Badge variant="neutral" size="sm">{{ entry.count }}</Badge>
        </button>
      </div>
    </template>

    <AlertBox
      v-if="feedback"
      class="mb-4"
      :variant="feedback.type === 'success' ? 'success' : 'danger'"
      dismissible
      @dismiss="feedback = null"
    >
      {{ feedback.text }}
    </AlertBox>

    <AlertBox v-if="locked" class="mb-4" variant="info">
      {{ t("briefingLockedHint") }}
    </AlertBox>

    <Skeleton v-if="loading" variant="text" :count="4" />

    <template v-else-if="tab === 'routes'">
      <ul v-if="routes.length" class="mb-5 space-y-2">
        <li
          v-for="leg in routes"
          :key="leg.id"
          class="rounded-control bg-surface-sunken px-3 py-2.5"
        >
          <div class="flex items-start gap-3">
            <div class="min-w-0 flex-1">
              <p
                class="flex items-center gap-2 font-mono text-sm font-semibold text-ink"
              >
                {{ leg.departure }}
                <Icon name="arrowRight" class="size-3.5 text-faint" />
                {{ leg.arrival }}
              </p>
              <p
                v-if="leg.route"
                class="mt-1 break-words font-mono text-xs text-muted"
              >
                {{ leg.route }}
              </p>
              <p
                v-if="leg.aircraft || leg.cruise"
                class="mt-1 font-mono text-xs text-faint"
              >
                {{ [leg.aircraft, leg.cruise].filter(Boolean).join(" · ") }}
              </p>
              <p v-if="leg.remarks" class="mt-1 text-xs text-muted">
                {{ leg.remarks }}
              </p>
            </div>
            <Button
              v-if="!locked"
              size="sm"
              variant="ghost"
              :disabled="busy"
              @click="
                act({ action: 'deleteRoute', routeId: leg.id }, 'routeDeleted')
              "
            >
              {{ t("delete") }}
            </Button>
          </div>
        </li>
      </ul>
      <p v-else class="mb-5 text-sm text-muted">{{ t("noRoutes") }}</p>

      <form
        v-if="!locked"
        class="space-y-3 border-t border-subtle pt-5"
        @submit.prevent="addRoute"
      >
        <p class="text-sm font-semibold text-ink">{{ t("addRoute") }}</p>
        <div class="grid grid-cols-2 gap-3">
          <Input
            v-model="routeForm.departure"
            name="leg-departure"
            :label="t('formDeparture')"
            placeholder="ZBAA"
            :maxlength="4"
            required
          />
          <Input
            v-model="routeForm.arrival"
            name="leg-arrival"
            :label="t('formArrival')"
            placeholder="ZSPD"
            :maxlength="4"
            required
          />
        </div>
        <Input
          v-model="routeForm.route"
          name="leg-route"
          :label="t('formRoute')"
          :hint="t('formRouteHint')"
          :maxlength="MAX_ROUTE_LENGTH"
        />
        <div class="grid grid-cols-2 gap-3">
          <Input
            v-model="routeForm.aircraft"
            name="leg-aircraft"
            :label="t('formAircraft')"
            placeholder="A320/B738"
            :maxlength="80"
          />
          <Input
            v-model="routeForm.cruise"
            name="leg-cruise"
            :label="t('formCruise')"
            placeholder="FL350"
            :maxlength="12"
          />
        </div>
        <Input
          v-model="routeForm.remarks"
          name="leg-remarks"
          :label="t('formRemarks')"
          :maxlength="MAX_DESCRIPTION_LENGTH"
        />
        <Button type="submit" :loading="busy">
          <template #icon><Icon name="plus" class="size-4" /></template>
          {{ t("addRoute") }}
        </Button>
      </form>
    </template>

    <template v-else>
      <ul v-if="positions.length" class="mb-5 space-y-2">
        <li
          v-for="position in positions"
          :key="position.id"
          class="rounded-control bg-surface-sunken px-3 py-2.5"
        >
          <div class="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Badge :variant="position.username ? 'neutral' : 'info'" size="sm">
              {{ facilityCode(position.facility) }}
            </Badge>
            <span class="font-mono text-sm font-medium text-ink">{{
              position.callsign
            }}</span>
            <span
              v-if="position.frequency"
              class="tnum font-mono text-xs text-muted"
            >
              {{ position.frequency }}
            </span>
            <span class="text-xs text-faint">
              {{ t("minRating", { rating: ratingCode(position.minRating) }) }}
            </span>

            <div class="ml-auto flex items-center gap-2">
              <Badge v-if="position.username" variant="success" size="sm">
                {{ position.username }} · {{ position.name }}
              </Badge>
              <span v-else class="text-xs text-faint">{{ t("seatFree") }}</span>

              <template v-if="!locked">
                <Button
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  @click="
                    editingId === position.id
                      ? (editingId = null)
                      : startEdit(position)
                  "
                >
                  {{ t("edit") }}
                </Button>
                <Button
                  v-if="position.username"
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  @click="
                    act(
                      { action: 'releasePosition', positionId: position.id },
                      'positionReleased',
                    )
                  "
                >
                  {{ t("releaseSeat") }}
                </Button>
                <Button
                  v-else
                  size="sm"
                  variant="ghost"
                  :disabled="busy"
                  @click="
                    act(
                      { action: 'deletePosition', positionId: position.id },
                      'positionDeleted',
                    )
                  "
                >
                  {{ t("delete") }}
                </Button>
              </template>
            </div>
          </div>

          <div
            v-if="editingId === position.id"
            class="mt-3 flex flex-wrap items-end gap-3 border-t border-subtle pt-3"
          >
            <div class="w-32">
              <Input
                v-model="editDraft.frequency"
                :name="`freq-${position.id}`"
                :label="t('formFrequency')"
                placeholder="118.100"
                :maxlength="7"
              />
            </div>
            <div class="w-44">
              <Select
                v-model="editDraft.minRating"
                :name="`minrating-${position.id}`"
                :label="t('formMinRating')"
                :options="ratingOptions"
              />
            </div>
            <Button size="sm" :loading="busy" @click="saveEdit(position)">
              {{ t("save") }}
            </Button>
          </div>
        </li>
      </ul>
      <p v-else class="mb-5 text-sm text-muted">{{ t("noPositions") }}</p>

      <form
        v-if="!locked"
        class="space-y-3 border-t border-subtle pt-5"
        @submit.prevent="addPosition"
      >
        <p class="text-sm font-semibold text-ink">{{ t("addPosition") }}</p>
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Input
            v-model="seatForm.airport"
            name="seat-airport"
            :label="t('formAirport')"
            :hint="t('formAirportHint')"
            placeholder="ZBAA"
            :maxlength="4"
            required
          />
          <Select
            :model-value="seatForm.facility"
            name="seat-facility"
            :label="t('formFacility')"
            :options="facilityOptions"
            @update:model-value="onFacilityChange"
          />
          <Input
            v-model="seatForm.callsign"
            name="seat-callsign"
            :label="t('formCallsign')"
            :placeholder="callsignPlaceholder"
            :hint="t('formCallsignHint')"
            :maxlength="16"
          />
          <Input
            v-model="seatForm.frequency"
            name="seat-frequency"
            :label="t('formFrequency')"
            placeholder="118.100"
            :maxlength="7"
          />
          <Select
            v-model="seatForm.minRating"
            name="seat-minrating"
            :label="t('formMinRating')"
            :options="ratingOptions"
          />
        </div>
        <div class="flex flex-wrap gap-2.5">
          <Button type="submit" :loading="busy">
            <template #icon><Icon name="plus" class="size-4" /></template>
            {{ t("addPosition") }}
          </Button>
          <Button
            type="button"
            variant="secondary"
            :disabled="busy"
            @click="addAllPositions"
          >
            {{ t("addAllPositions") }}
          </Button>
        </div>
      </form>
    </template>

    <template #footer>
      <Button variant="secondary" @click="open = false">{{
        t("close")
      }}</Button>
    </template>
  </Dialog>
</template>
