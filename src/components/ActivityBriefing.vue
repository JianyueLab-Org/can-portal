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
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
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
import type { AirportStack, StackSeat } from "@/lib/positionStack";
import { apiFetch } from "@/lib/canApi";
import { onNaipChange } from "@/lib/naip";

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

/* ------------------------------------------------------------------ *
 * 从扇区包取整摞席位
 * ------------------------------------------------------------------ */

/**
 * 这里从前是「一键开全席」：拿机场代号拼出 `ZBAA_DEL`…`ZBAA_CTR` 五个呼号、不带频
 * 率，一次开五个。
 *
 * **它对大场是错的，而且错得没有任何提示。** 浦东的进近是 `ZSSS_APP`（虹桥进近管浦
 * 东），`ZSPD_APP` 这个呼号根本不存在；石家庄没有自己的区调，管它的是 `ZBAA_W_CTR`
 * → `ZBAA_CTR` → `ZBPE_CTR`；桃园的区调全姓 `TPE_`。拼出来的一列呼号**看起来完全正
 * 常**，于是活动当天没人连得上那个席位。对着真数据量过：269 个机场里 21 个会拼错。
 *
 * 现在改成问 can-db 要 —— 它照扇区包的 owner 链解出来，呼号和频率都是真的，每一层还
 * 标好了默认开哪一个。这一侧只负责摆出来让人勾。
 */
const stack = ref<AirportStack | null>(null);
const stackBusy = ref(false);
/** 勾上的席位，键是 `seatKey`。 */
const picked = ref(new Set<string>());
/** 一个呼号有多个频率时选了哪一个。 */
const freqChoice = ref<Record<string, string>>({});

/** 一个席位在这一摞里的身份。**带上 facility** —— `DEP` 并进了进近那一格。 */
function seatKey(seat: StackSeat): string {
  return `${seat.facility}:${seat.callsign}`;
}

/** 按 facility 分组，组内保持 can-db 给的顺序（primary 在前）。 */
const stackGroups = computed(() => {
  const seats = stack.value?.seats ?? [];
  return BOOKABLE_FACILITIES.map((facility) => ({
    facility,
    seats: seats.filter((s) => s.facility === facility),
  })).filter((g) => g.seats.length);
});

const pickedCount = computed(() => picked.value.size);

async function loadStack() {
  const airport = normalizeIcao(seatForm.value.airport);
  if (!isValidIcao(airport)) {
    feedback.value = { type: "error", text: t("errors.invalidIcao") };
    return;
  }
  if (stackBusy.value) return;
  stackBusy.value = true;
  feedback.value = null;
  stack.value = null;
  try {
    // 本站的端点，不是 can-api 的反代 —— 这批数据在 can-db，而 can-db 只在集群内
    // 监听。`credentials` 写明而不是靠默认值：同源默认就是带的，但这一行是这个请
    // 求能认人的唯一原因，值得写出来。
    const res = await fetch(`/super/activities/${airport}.json`, {
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(
        res.status === 502 ? t("stackUnreachable") : t("actionFailed"),
      );
    }
    const data = (await res.json()) as AirportStack;
    stack.value = data;
    // 默认勾的是 can-db 标出来的那一行 —— 每层一个，正好是「从放行到区调一摞」。
    picked.value = new Set(
      data.seats.filter((seat) => seat.primary).map(seatKey),
    );
    freqChoice.value = Object.fromEntries(
      data.seats.map((seat) => [seatKey(seat), seat.frequencies[0] ?? ""]),
    );
  } catch (e) {
    feedback.value = {
      type: "error",
      text: e instanceof Error ? e.message : t("actionFailed"),
    };
  } finally {
    stackBusy.value = false;
  }
}

/**
 * 「隐藏 NAIP」切换后，已经取出来的那一摞按新的数据范围重取一次。
 * 端点的缓存按 cookie 分（`Vary: Cookie`），所以这一次拿到的是新的那份。
 */
let stopNaip: (() => void) | null = null;
onMounted(() => {
  stopNaip = onNaipChange(() => {
    if (stack.value) void loadStack();
  });
});
onBeforeUnmount(() => stopNaip?.());

function togglePick(seat: StackSeat) {
  const key = seatKey(seat);
  const next = new Set(picked.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  picked.value = next;
}

/**
 * 把勾上的一次开出来。
 *
 * **重复呼号单独数，不当失败。** `activityPosition` 上是
 * `@@unique([activityId, callsign])` —— 一场活动里一个呼号只能开一次，而这是常事：
 * 先开 ZBAA 再开 ZBSJ，两摞里都有 `ZBAA_CTR`。把它算进「失败」会让一次完全正常的操
 * 作报错；一声不吭地跳过又会让人以为漏开了。所以数出来，在结果里说。
 */
async function addPickedSeats() {
  const current = stack.value;
  if (!current || busy.value) return;
  const chosen = current.seats.filter((seat) =>
    picked.value.has(seatKey(seat)),
  );
  if (!chosen.length) return;

  busy.value = true;
  feedback.value = null;
  const done: string[] = [];
  let duplicate = 0;
  let lastError: unknown = null;
  try {
    for (const seat of chosen) {
      const key = seatKey(seat);
      const res = await apiFetch(`/api/v1/super/activity/${props.activityId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "addPosition",
          // **机场是查询的那个，不是呼号的头一段。** `ZSSS_APP` 是浦东这一摞里的进
          // 近，它要挂在 ZSPD 名下，否则详情页会把它分到一个没人报名的机场组里。
          airport: current.icao,
          facility: seat.facility,
          callsign: seat.callsign,
          frequency: freqChoice.value[key] ?? "",
          minRating: seat.minRating,
        }),
      });
      if (res.ok) {
        done.push(key);
        continue;
      }
      const code = (await res.json().catch(() => ({}))).error;
      if (code === "duplicateCallsign") duplicate++;
      else lastError = code;
    }

    // 开成了的取消勾选，剩下的留着 —— 人要能看见是哪几个没开出去。
    if (done.length) {
      const next = new Set(picked.value);
      for (const key of done) next.delete(key);
      picked.value = next;
    }

    feedback.value = describeAdd(
      done.length,
      duplicate,
      lastError,
      current.icao,
    );
    await load(true);
    emit("changed");
  } finally {
    busy.value = false;
  }
}

/** 「开了几个、跳过几个、剩下的为什么没开」说成一句话。 */
function describeAdd(
  added: number,
  duplicate: number,
  lastError: unknown,
  airport: string,
): { type: "success" | "error"; text: string } {
  if (added && duplicate) {
    return {
      type: "success",
      text: t("stackAddedSome", {
        count: String(added),
        airport,
        skipped: String(duplicate),
      }),
    };
  }
  if (added) {
    return {
      type: "success",
      text: t("positionsAdded", { count: String(added), airport }),
    };
  }
  if (duplicate) {
    return { type: "error", text: t("stackAllDuplicate") };
  }
  return {
    type: "error",
    text:
      typeof lastError === "string" && KNOWN_ERRORS.includes(lastError)
        ? t(`errors.${lastError}`)
        : t("actionFailed"),
  };
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

      <!-- 扇区包给的整摞席位。呼号和频率都是真的，每层默认勾一个。 -->
      <section
        v-if="stack"
        class="mb-5 rounded-control border border-subtle bg-surface-sunken p-4"
      >
        <div class="flex flex-wrap items-baseline justify-between gap-2">
          <p class="text-sm font-semibold text-ink">
            {{ t("stackTitle", { airport: stack.icao }) }}
          </p>
          <button
            type="button"
            class="text-xs text-muted underline-offset-2 hover:underline"
            @click="stack = null"
          >
            {{ t("stackDismiss") }}
          </button>
        </div>
        <p class="mt-1 text-xs text-muted">{{ t("stackHint") }}</p>

        <!-- 两句刻意说出来的话：这一摞是猜的、这一摞没有区调。它们和「读不到」
             长得一样，不说就只能靠人自己发现。 -->
        <AlertBox v-if="!stack.hasChain" class="mt-3" variant="warning">
          {{ t("stackNoChain") }}
        </AlertBox>
        <AlertBox v-else-if="!stack.hasEnroute" class="mt-3" variant="info">{{
          t("stackNoEnroute")
        }}</AlertBox>

        <p v-if="!stack.seats.length" class="mt-3 text-sm text-muted">
          {{ t("stackEmpty", { airport: stack.icao }) }}
        </p>

        <div v-else class="mt-3 space-y-3">
          <div v-for="group in stackGroups" :key="group.facility">
            <p
              class="text-[0.7rem] font-semibold tracking-wide text-muted uppercase"
            >
              {{ facilityCode(group.facility) }} ·
              {{ t(`facilities.${FACILITY_KEYS[group.facility]}`) }}
            </p>
            <ul class="mt-1 space-y-1">
              <li
                v-for="seat in group.seats"
                :key="seatKey(seat)"
                class="flex flex-wrap items-center gap-2 rounded-control bg-surface px-2.5 py-2"
              >
                <input
                  :id="`stack-${seatKey(seat)}`"
                  type="checkbox"
                  class="size-4 shrink-0 accent-[var(--color-can)]"
                  :checked="picked.has(seatKey(seat))"
                  @change="togglePick(seat)"
                />
                <label
                  :for="`stack-${seatKey(seat)}`"
                  class="font-mono text-sm text-ink"
                >
                  {{ seat.callsign }}
                </label>
                <Badge v-if="!seat.own" variant="neutral" size="sm">
                  {{ t("stackForeign") }}
                </Badge>
                <!-- 一个呼号好几个频率是真数据（RJTT_TWR 三个）。摆成选项让人挑，
                     因为一场活动里一个呼号只能开一次。 -->
                <div v-if="seat.frequencies.length > 1" class="w-32">
                  <Select
                    v-model="freqChoice[seatKey(seat)]"
                    :name="`stack-freq-${seatKey(seat)}`"
                    :options="
                      seat.frequencies.map((f) => ({ value: f, label: f }))
                    "
                  />
                </div>
                <span v-else class="font-mono text-sm text-muted">
                  {{ seat.frequencies[0] ?? "—" }}
                </span>
                <span class="ml-auto text-xs text-muted">
                  {{ ratingCode(seat.minRating) }}
                </span>
              </li>
            </ul>
          </div>

          <Button
            type="button"
            :loading="busy"
            :disabled="!pickedCount"
            @click="addPickedSeats"
          >
            <template #icon><Icon name="plus" class="size-4" /></template>
            {{ t("stackAdd", { count: String(pickedCount) }) }}
          </Button>
        </div>
      </section>

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
            :loading="stackBusy"
            :disabled="busy"
            @click="loadStack"
          >
            {{ t("fetchStack") }}
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
