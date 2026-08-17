<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  pointsFor,
  formatZulu,
  formatLocal,
  isValidActivityEnd,
  MAX_DESCRIPTION_LENGTH,
} from "@/lib/activities";
import ActivityBriefing from "@/components/ActivityBriefing.vue";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Icon,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@jianyuelab-org/can-ui";
import { apiFetch, unwrapList } from "@/lib/canApi";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);

const ROLE_KEYS = ["pilot", "controller", "sup"] as const;

interface Activity {
  id: number;
  title: string;
  description: string | null;
  professional: boolean;
  startsAt: string;
  endsAt: string | null;
  status: number;
  registrationCount: number;
  routeCount: number;
  positionCount: number;
  claimedPositionCount: number;
}
interface RosterRow {
  username: string;
  name: string;
  role: number;
  attended: boolean;
  pointsAwarded: number;
}

const activities = ref<Activity[]>([]);
const loading = ref(true);
const feedback = ref<{ type: "success" | "error"; text: string } | null>(null);

/**
 * The error banner for whichever dialog is open.
 *
 * `feedback` renders on the page *behind* the backdrop, so every failure
 * raised while a dialog was open — a bad end time, a settle that 500s — was
 * announced to a covered banner and read as nothing happening. Successes
 * still go to `feedback`, because by then the dialog has closed.
 */
const dialogError = ref<string | null>(null);

/**
 * Times are entered in Zulu by default.
 *
 * A `datetime-local` field carries no zone, so the value used to be read as the
 * browser's — and an activity briefed as "1400Z" was filed at 1400 Beijing,
 * eight hours out. Events are announced in Zulu, so that is what the form
 * defaults to; `local` stays available for whoever prefers to think in it.
 */
const DEFAULT_TIMEZONE = "zulu";

// Create dialog. Creating an activity happens a few times a month, so the
// form no longer holds a third of the screen permanently — the table it was
// squeezing has seven columns and is what this page is actually for.
const createOpen = ref(false);
/**
 * The submit button sits in the dialog's footer, outside the form, so it
 * cannot be a plain `type="submit"`. Going through `requestSubmit()` rather
 * than calling `create()` directly is what keeps the fields' own `required`
 * validation — otherwise an empty title is only caught by the generic
 * "something went wrong" check inside `create`, which does not say which
 * field is missing.
 */
const createForm = ref<HTMLFormElement | null>(null);
const form = ref({
  title: "",
  description: "",
  professional: "false",
  startsAt: "",
  // Optional — an activity announced with a start only is the common case.
  // Shares the timezone toggle with `startsAt`: entering one in Zulu and the
  // other in local time is a mistake with no legitimate use.
  endsAt: "",
  timezone: DEFAULT_TIMEZONE,
});
const creating = ref(false);

// Attendance / settle dialog.
const modalOpen = ref(false);
const current = ref<Activity | null>(null);
const roster = ref<RosterRow[]>([]);
const attended = ref<Record<string, boolean>>({});
const rosterLoading = ref(false);
const settling = ref(false);

// Briefing editor (routes + ATC seats). Mounted only while an activity is
// picked, so it loads that activity's briefing on mount and nothing is stale.
const briefingFor = ref<Activity | null>(null);

// Edit dialog — the brief only; see the PATCH `update` route for why.
const editOpen = ref(false);
const editing = ref<Activity | null>(null);
const editDescription = ref("");
// Zulu `YYYY-MM-DDTHH:mm`; empty means "no end time", which clears it on save.
const editEndsAt = ref("");
const saving = ref(false);

// Cancel confirmation. `window.confirm` blocks the whole tab, cannot be
// themed and reads in the browser's language rather than the member's — and
// cancelling an activity with people signed up to it deserves a sentence
// naming which one, which a native confirm cannot show alongside the title.
const cancelTarget = ref<Activity | null>(null);
const cancelling = ref(false);

const professionalOptions = computed(() => [
  { value: "false", label: t("boards.casual") },
  { value: "true", label: t("boards.professional") },
]);

const timezoneOptions = computed(() => [
  { value: "zulu", label: t("timezones.zulu") },
  { value: "local", label: t("timezones.local") },
]);

const columns = computed(() => [
  { key: "title", label: t("colTitle") },
  { key: "board", label: t("colBoard") },
  { key: "startsAt", label: t("colStarts") },
  { key: "status", label: t("colStatus") },
  { key: "briefing", label: t("colBriefing"), align: "center" as const },
  { key: "registrationCount", label: t("colCount"), align: "center" as const },
  { key: "actions", label: t("colActions"), align: "right" as const },
]);

function statusKey(status: number): string {
  return ["draft", "open", "settled", "cancelled"][status] ?? "draft";
}
function statusVariant(status: number): "success" | "neutral" | "danger" {
  if (status === 1) return "success";
  if (status === 3) return "danger";
  return "neutral";
}
function roleLabel(role: number): string {
  return t(`roles.${ROLE_KEYS[role] ?? "pilot"}`);
}
/** Points an attendee in this seat would earn — 0 (shown as "—") for SUP. */
function previewPoints(role: number): number {
  if (!current.value) return 0;
  const r: 0 | 1 | 2 = role === 2 ? 2 : role === 1 ? 1 : 0;
  return pointsFor(r, current.value.professional);
}
/** Zulu and the viewer's own clock, side by side — never one without the other. */
function formatDate(iso: string): string {
  return t("timeWithLocal", { zulu: formatZulu(iso), local: formatLocal(iso) });
}

/** The zone-less `datetime-local` value as an absolute instant. */
function toInstant(value: string, timezone: string): Date {
  const text = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)
    ? `${value}:00`
    : value;
  return new Date(timezone === "zulu" ? `${text}Z` : text);
}

/** Restates the entered time in both zones, so a mis-set toggle is visible. */
function bothZones(value: string, timezone?: string): string | undefined {
  if (!value) return undefined;
  const d = toInstant(value, timezone ?? form.value.timezone);
  if (Number.isNaN(d.getTime())) return undefined;
  return formatDate(d.toISOString());
}
const startsAtPreview = computed(() => bothZones(form.value.startsAt));
const endsAtPreview = computed(() => bothZones(form.value.endsAt));

/**
 * Flagged in the form rather than only on submit — the server rejects this
 * too, but a round trip to be told the end is before the start is a poor way
 * to find out. Empty is fine: the end time is optional.
 */
const endsAtError = computed(() => {
  if (!form.value.startsAt || !form.value.endsAt) return false;
  return !isValidActivityEnd(
    toInstant(form.value.startsAt, form.value.timezone),
    toInstant(form.value.endsAt, form.value.timezone),
  );
});

async function load(silent = false) {
  // A refresh behind an open modal keeps the table rendered rather than
  // swapping it for a spinner the modal is covering anyway.
  if (!silent) loading.value = true;
  try {
    const res = await apiFetch("/api/v1/super/activity");
    if (!res.ok) throw new Error();
    activities.value = unwrapList<Activity>(
      (await res.json()).data,
      "activities",
    );
  } catch {
    feedback.value = { type: "error", text: t("loadError") };
  } finally {
    if (!silent) loading.value = false;
  }
}

function openCreate() {
  dialogError.value = null;
  createOpen.value = true;
}

async function create() {
  if (creating.value) return;
  if (!form.value.title.trim() || !form.value.startsAt) {
    dialogError.value = t("actionFailed");
    return;
  }
  const startsAt = toInstant(form.value.startsAt, form.value.timezone);
  if (Number.isNaN(startsAt.getTime())) {
    dialogError.value = t("actionFailed");
    return;
  }

  let endsAt: Date | null = null;
  if (form.value.endsAt) {
    endsAt = toInstant(form.value.endsAt, form.value.timezone);
    if (
      Number.isNaN(endsAt.getTime()) ||
      !isValidActivityEnd(startsAt, endsAt)
    ) {
      dialogError.value = t("endBeforeStart");
      return;
    }
  }

  creating.value = true;
  dialogError.value = null;
  try {
    const res = await apiFetch("/api/v1/super/activity", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.value.title.trim(),
        description: form.value.description.trim(),
        professional: form.value.professional === "true",
        // Always an absolute instant, so it can't drift by the server's zone.
        startsAt: startsAt.toISOString(),
        endsAt: endsAt ? endsAt.toISOString() : "",
      }),
    });
    if (!res.ok) throw new Error();
    createOpen.value = false;
    feedback.value = { type: "success", text: t("createSuccess") };
    form.value = {
      title: "",
      description: "",
      professional: "false",
      startsAt: "",
      endsAt: "",
      // Reset to Zulu rather than whatever the last activity happened to use.
      timezone: DEFAULT_TIMEZONE,
    };
    await load();
  } catch {
    dialogError.value = t("actionFailed");
  } finally {
    creating.value = false;
  }
}

async function openRoster(activity: Activity) {
  current.value = activity;
  dialogError.value = null;
  modalOpen.value = true;
  rosterLoading.value = true;
  roster.value = [];
  attended.value = {};
  try {
    const res = await apiFetch(`/api/v1/super/activity/${activity.id}`);
    if (!res.ok) throw new Error();
    const data = (await res.json()).data;
    roster.value = data.registrations ?? [];
    const marks: Record<string, boolean> = {};
    for (const r of roster.value) marks[r.username] = r.attended;
    attended.value = marks;
  } catch {
    feedback.value = { type: "error", text: t("loadError") };
    modalOpen.value = false;
  } finally {
    rosterLoading.value = false;
  }
}

async function settle() {
  if (settling.value || !current.value) return;
  settling.value = true;
  try {
    const attendees = roster.value
      .filter((r) => attended.value[r.username])
      .map((r) => r.username);
    const res = await apiFetch(`/api/v1/super/activity/${current.value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "settle", attendees }),
    });
    if (!res.ok) throw new Error();
    modalOpen.value = false;
    feedback.value = { type: "success", text: t("settleSuccess") };
    await load();
  } catch {
    // Settling awards points and cannot be repeated, so the dialog stays open
    // with the roster as ticked — closing it would lose the marks.
    dialogError.value = t("actionFailed");
  } finally {
    settling.value = false;
  }
}

function askCancel(activity: Activity) {
  dialogError.value = null;
  cancelTarget.value = activity;
}

async function confirmCancel() {
  if (cancelling.value || !cancelTarget.value) return;
  cancelling.value = true;
  try {
    const res = await apiFetch(
      `/api/v1/super/activity/${cancelTarget.value.id}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      },
    );
    if (!res.ok) throw new Error();
    cancelTarget.value = null;
    feedback.value = { type: "success", text: t("cancelSuccess") };
    await load();
  } catch {
    dialogError.value = t("actionFailed");
  } finally {
    cancelling.value = false;
  }
}

/**
 * An ISO instant as the `YYYY-MM-DDTHH:mm` a datetime-local input wants.
 * Sliced off the UTC string, so the edit modal works in Zulu — the zone the
 * activity is published in — without needing its own timezone toggle.
 */
function toZuluInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 16);
}

const editEndsAtPreview = computed(() =>
  editEndsAt.value ? bothZones(`${editEndsAt.value}:00Z`, "zulu") : undefined,
);

const editEndsAtError = computed(() => {
  if (!editing.value || !editEndsAt.value) return false;
  return !isValidActivityEnd(
    editing.value.startsAt,
    new Date(`${editEndsAt.value}:00Z`),
  );
});

function openEdit(activity: Activity) {
  editing.value = activity;
  editDescription.value = activity.description ?? "";
  editEndsAt.value = toZuluInput(activity.endsAt);
  dialogError.value = null;
  editOpen.value = true;
}

async function saveEdit() {
  if (saving.value || !editing.value) return;
  if (editEndsAtError.value) {
    dialogError.value = t("endBeforeStart");
    return;
  }
  saving.value = true;
  dialogError.value = null;
  try {
    const res = await apiFetch(`/api/v1/super/activity/${editing.value.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "update",
        description: editDescription.value.trim(),
        // "" clears the end time; the route reads an absent field as "leave
        // alone", which is not what an emptied input means.
        endsAt: editEndsAt.value ? `${editEndsAt.value}:00Z` : "",
      }),
    });
    if (!res.ok) throw new Error();
    editOpen.value = false;
    feedback.value = { type: "success", text: t("updateSuccess") };
    await load();
  } catch {
    dialogError.value = t("actionFailed");
  } finally {
    saving.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="calendarDays"
    >
      <template #actions>
        <Button @click="openCreate">
          <template #icon><Icon name="plus" class="size-4" /></template>
          {{ t("create") }}
        </Button>
      </template>
    </PageHeader>

    <AlertBox
      v-if="feedback"
      class="mb-6"
      :variant="feedback.type === 'success' ? 'success' : 'danger'"
      dismissible
      @dismiss="feedback = null"
    >
      {{ feedback.text }}
    </AlertBox>

    <!-- The list is the page: seven columns, and it used to run in two thirds
         of the width so the create form could sit beside it permanently. -->
    <Card :title="t('list')" padding="none">
      <div class="p-6">
        <DataTable
          :columns="columns"
          :rows="activities"
          row-key="id"
          :loading="loading"
          :loading-label="t('loading')"
          :empty="t('noActivities')"
        >
          <template #cell-board="{ row }">
            <Badge :variant="row.professional ? 'info' : 'neutral'" size="sm">
              {{
                row.professional ? t("boards.professional") : t("boards.casual")
              }}
            </Badge>
          </template>
          <template #cell-startsAt="{ row }">
            <div class="whitespace-normal">
              {{ formatDate(row.startsAt) }}
              <span v-if="row.endsAt" class="block text-xs text-faint">
                {{ t("untilTime", { time: formatDate(row.endsAt) }) }}
              </span>
            </div>
          </template>
          <template #cell-status="{ row }">
            <Badge :variant="statusVariant(row.status)" size="sm">
              {{ t(`status.${statusKey(row.status)}`) }}
            </Badge>
          </template>
          <!-- Routes and seat take-up, so an under-briefed activity is
               obvious without opening it. -->
          <template #cell-briefing="{ row }">
            <span class="tnum text-xs text-muted">
              {{
                t("briefingCounts", {
                  routes: String(row.routeCount),
                  claimed: String(row.claimedPositionCount),
                  seats: String(row.positionCount),
                })
              }}
            </span>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-2">
              <Button
                v-if="row.status === 1"
                size="sm"
                @click="openRoster(row)"
              >
                {{ t("settle") }}
              </Button>
              <!-- The briefing stays visible on a settled activity as the
                   record of what ran; the editor turns read-only there. -->
              <Button
                v-if="row.status !== 3"
                size="sm"
                variant="secondary"
                @click="briefingFor = row"
              >
                {{ t("briefing") }}
              </Button>
              <!-- The brief stays editable until the activity is cancelled. -->
              <Button
                v-if="row.status !== 3"
                size="sm"
                variant="secondary"
                @click="openEdit(row)"
              >
                {{ t("edit") }}
              </Button>
              <Button
                v-if="row.status === 1"
                size="sm"
                variant="ghost"
                @click="askCancel(row)"
              >
                {{ t("cancel") }}
              </Button>
              <span v-if="row.status === 3" class="text-xs text-faint">—</span>
            </div>
          </template>
        </DataTable>
      </div>
    </Card>

    <!-- Briefing editor: routes and ATC seats. Keyed so switching activities
         remounts it rather than showing the previous one's briefing. -->
    <ActivityBriefing
      v-if="briefingFor"
      :key="briefingFor.id"
      :activity-id="briefingFor.id"
      :activity-title="briefingFor.title"
      :locked="briefingFor.status === 2 || briefingFor.status === 3"
      :messages="messages"
      @close="briefingFor = null"
      @changed="load(true)"
    />

    <!-- Create -->
    <Dialog
      v-model:open="createOpen"
      :title="t('create')"
      :description="t('createHint')"
      :close-label="t('close')"
    >
      <form ref="createForm" class="space-y-4" @submit.prevent="create">
        <AlertBox v-if="dialogError" variant="danger">{{
          dialogError
        }}</AlertBox>
        <Input
          v-model="form.title"
          name="activity-title"
          :label="t('formTitle')"
          required
        />
        <Input
          v-model="form.description"
          name="activity-description"
          :label="t('formDescription')"
          :maxlength="MAX_DESCRIPTION_LENGTH"
        />
        <Select
          v-model="form.professional"
          name="activity-professional"
          :label="t('formProfessional')"
          :options="professionalOptions"
        />
        <Input
          v-model="form.startsAt"
          type="datetime-local"
          name="activity-starts"
          :label="t('formStartsAt')"
          :hint="startsAtPreview"
          required
        />
        <Input
          v-model="form.endsAt"
          type="datetime-local"
          name="activity-ends"
          :label="t('formEndsAt')"
          :error="endsAtError ? t('endBeforeStart') : undefined"
          :hint="endsAtPreview ?? t('formEndsAtHint')"
        />
        <Select
          v-model="form.timezone"
          name="activity-timezone"
          :label="t('formTimezone')"
          :options="timezoneOptions"
        />
      </form>
      <template #footer>
        <Button variant="secondary" @click="createOpen = false">{{
          t("close")
        }}</Button>
        <Button :loading="creating" @click="createForm?.requestSubmit()">
          <template #icon><Icon name="plus" class="size-4" /></template>
          {{ t("submit") }}
        </Button>
      </template>
    </Dialog>

    <!-- Attendance / settle -->
    <Dialog
      v-model:open="modalOpen"
      :title="current?.title"
      :description="t('attendanceHint')"
      :close-label="t('close')"
    >
      <AlertBox v-if="dialogError" variant="danger" class="mb-4">{{
        dialogError
      }}</AlertBox>
      <Skeleton v-if="rosterLoading" variant="text" :count="4" />
      <div
        v-else-if="!roster.length"
        class="py-8 text-center text-sm text-muted"
      >
        {{ t("noRegistrations") }}
      </div>
      <ul v-else class="space-y-1.5">
        <li
          v-for="r in roster"
          :key="r.username"
          class="flex items-center gap-3 rounded-control bg-surface-sunken px-3 py-2.5"
        >
          <input
            :id="`att-${r.username}`"
            v-model="attended[r.username]"
            type="checkbox"
            class="size-4 shrink-0 accent-[var(--color-can)]"
          />
          <label
            :for="`att-${r.username}`"
            class="flex min-w-0 flex-1 items-center gap-2"
          >
            <span class="font-mono text-sm text-ink">{{ r.username }}</span>
            <span class="truncate text-sm text-muted">{{ r.name }}</span>
          </label>
          <Badge variant="neutral" size="sm">{{ roleLabel(r.role) }}</Badge>
          <span
            v-if="attended[r.username] && previewPoints(r.role) > 0"
            class="w-8 shrink-0 text-right text-xs font-semibold text-success-fg"
          >
            +{{ previewPoints(r.role) }}
          </span>
          <span v-else class="w-8 shrink-0 text-right text-xs text-faint"
            >—</span
          >
        </li>
      </ul>
      <template #footer>
        <Button variant="secondary" @click="modalOpen = false">{{
          t("close")
        }}</Button>
        <Button :loading="settling" :disabled="rosterLoading" @click="settle">
          {{ t("settle") }}
        </Button>
      </template>
    </Dialog>

    <!-- Edit — the brief only. -->
    <Dialog
      v-model:open="editOpen"
      :title="editing?.title"
      :description="t('editHint')"
      :close-label="t('close')"
    >
      <div class="space-y-4">
        <AlertBox v-if="dialogError" variant="danger">{{
          dialogError
        }}</AlertBox>
        <div>
          <label
            for="edit-description"
            class="block text-sm font-medium text-ink"
          >
            {{ t("formDescription") }}
          </label>
          <textarea
            id="edit-description"
            v-model="editDescription"
            rows="5"
            :maxlength="MAX_DESCRIPTION_LENGTH"
            class="input mt-1.5 resize-y"
          ></textarea>
        </div>

        <!-- The start time stays fixed here — see the PATCH route. The end
             time is editable because every activity created before it
             existed has none. Always Zulu, the zone activities are
             published in, so this needs no timezone toggle of its own. -->
        <Input
          v-model="editEndsAt"
          type="datetime-local"
          name="edit-ends"
          :label="t('formEndsAtZulu')"
          :error="editEndsAtError ? t('endBeforeStart') : undefined"
          :hint="editEndsAtPreview ?? t('formEndsAtHint')"
        />
        <p class="text-xs text-faint">
          {{
            t("formStartsAtFixed", {
              time: formatDate(editing?.startsAt ?? ""),
            })
          }}
        </p>
      </div>
      <template #footer>
        <Button variant="secondary" @click="editOpen = false">{{
          t("close")
        }}</Button>
        <Button :loading="saving" @click="saveEdit">{{ t("save") }}</Button>
      </template>
    </Dialog>

    <!-- Cancelling withdraws an announced activity from everyone signed up to
         it, so it is confirmed against the title rather than a bare yes/no. -->
    <Dialog
      :open="!!cancelTarget"
      size="sm"
      :title="t('cancelTitle')"
      :close-label="t('close')"
      @close="cancelTarget = null"
    >
      <AlertBox v-if="dialogError" variant="danger" class="mb-4">{{
        dialogError
      }}</AlertBox>
      <p class="text-sm text-muted">{{ t("cancelConfirm") }}</p>
      <p
        class="mt-3 rounded-control bg-surface-sunken px-3 py-2.5 text-sm font-medium text-ink"
      >
        {{ cancelTarget?.title }}
      </p>
      <template #footer>
        <Button variant="secondary" @click="cancelTarget = null">
          {{ t("cancelKeep") }}
        </Button>
        <Button variant="danger" :loading="cancelling" @click="confirmCancel">
          {{ t("cancelConfirmAction") }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
