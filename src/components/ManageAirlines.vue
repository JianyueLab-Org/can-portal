<script setup lang="ts">
/**
 * 虚拟航空平台管理。SUP/ADM。四个标签：开航申请、航空公司、经济参数、机场数据。
 *
 * 所有请求打本站 `/api/v1/va/staff/*`，由反代转给 can-va-api。错误一律按
 * `error` 码显示 `vaAirlines.errors` 下的中文，不显示上游的英文 message。
 * 需要理由或输入的动作在页内 `Dialog` 里做；批准和恢复直接发。
 */
import { computed, onMounted, ref, watch } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  EmptyState,
  Input,
  PageHeader,
  Segmented,
  Skeleton,
  Textarea,
} from "@jianyuelab-org/can-ui";
import { api } from "@/lib/canApi";
import {
  STATUS_FILTERS,
  actionRequest,
  airlinesPath,
  applicationsPath,
  approvePath,
  emptyFields,
  errorKey,
  formatMoney,
  formatTime,
  importPath,
  paramPath,
  paramsLogPath,
  paramsPath,
  parseParamValue,
  reinstatePath,
  type Airline,
  type AirlineStatus,
  type Application,
  type LedgerEntry,
  type Page,
  type Param,
  type ParamChange,
  type StaffAction,
  type StatusFilter,
} from "@/lib/vaStaff";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);

type Tab = "applications" | "airlines" | "params" | "import";
const TABS: readonly Tab[] = ["applications", "airlines", "params", "import"];
const tab = ref<Tab>("applications");
const tabSegments = TABS.map((value) => ({
  value,
  label: t(`tabs.${value}`),
}));

const error = ref("");
const notice = ref("");

function clear() {
  error.value = "";
  notice.value = "";
}

function message(code: string): string {
  return t(`errors.${errorKey(code)}`);
}

/** 正在进行的行内动作，形如 `approve-3`；同一时间只有一个。 */
const busy = ref<string | null>(null);

// ── 开航申请 ────────────────────────────────────────────────

const applications = ref<Application[]>([]);
const applicationsLoading = ref(false);

const applicationColumns = [
  { key: "airline", label: t("applications.columns.airline") },
  { key: "applicant", label: t("applications.columns.applicant") },
  { key: "hub", label: t("applications.columns.hub") },
  { key: "createdAt", label: t("applications.columns.createdAt") },
  { key: "actions", label: t("applications.columns.actions") },
];

async function loadApplications() {
  applicationsLoading.value = true;
  const result = await api<{ items: Application[] }>(applicationsPath());
  applicationsLoading.value = false;
  if (!result.ok) {
    error.value = message(result.error);
    return;
  }
  applications.value = result.data.items;
}

async function approve(application: Application) {
  clear();
  busy.value = `approve-${application.id}`;
  const result = await api<Airline>(approvePath(application.id), {
    method: "POST",
  });
  busy.value = null;
  if (!result.ok) {
    error.value = message(result.error);
    return;
  }
  notice.value = t("applications.approved", { icao: result.data.icao });
  await Promise.all([loadApplications(), loadAirlines()]);
}

// ── 航空公司 ────────────────────────────────────────────────

const airlines = ref<Airline[]>([]);
const airlinesLoading = ref(false);
const statusFilter = ref<StatusFilter>("all");
const filterSegments = STATUS_FILTERS.map((value) => ({
  value,
  label: t(`airlines.filter.${value}`),
}));

const airlineColumns = [
  { key: "airline", label: t("airlines.columns.airline") },
  { key: "owner", label: t("airlines.columns.owner") },
  { key: "status", label: t("airlines.columns.status") },
  { key: "members", label: t("airlines.columns.members") },
  { key: "balance", label: t("airlines.columns.balance") },
  { key: "actions", label: t("airlines.columns.actions") },
];

const STATUS_VARIANT: Record<AirlineStatus, "success" | "warning" | "neutral"> =
  {
    active: "success",
    suspended: "warning",
    closed: "neutral",
  };

async function loadAirlines() {
  airlinesLoading.value = true;
  const result = await api<{ items: Airline[] }>(
    airlinesPath(statusFilter.value),
  );
  airlinesLoading.value = false;
  if (!result.ok) {
    error.value = message(result.error);
    return;
  }
  airlines.value = result.data.items;
}

watch(statusFilter, loadAirlines);

async function reinstate(airline: Airline) {
  clear();
  busy.value = `reinstate-${airline.id}`;
  const result = await api<Airline>(reinstatePath(airline.id), {
    method: "POST",
  });
  busy.value = null;
  if (!result.ok) {
    error.value = message(result.error);
    return;
  }
  notice.value = t("airlines.done.reinstate", { icao: airline.icao });
  await loadAirlines();
}

// ── 对话框动作：驳回、暂停、关闭、指定所有者、调账 ──────────────

interface Pending {
  action: StaffAction;
  /** reject 是申请 id，其余是航空公司 id。 */
  id: number;
  icao: string;
}

const pending = ref<Pending | null>(null);
const fields = ref(emptyFields());
const dialogError = ref("");
const submitting = ref(false);

const dialogTitle = computed(() => {
  const target = pending.value;
  if (!target) return "";
  return target.action === "reject"
    ? t("applications.rejectTitle", { icao: target.icao })
    : t(`airlines.dialog.${target.action}`, { icao: target.icao });
});

function open(action: StaffAction, id: number, icao: string) {
  clear();
  pending.value = { action, id, icao };
  fields.value = emptyFields();
  dialogError.value = "";
}

function dismiss() {
  if (!submitting.value) pending.value = null;
}

async function submit() {
  const target = pending.value;
  if (!target) return;
  const request = actionRequest(target.action, target.id, fields.value);
  if (!request.ok) {
    dialogError.value = t(`errors.${request.error}`);
    return;
  }
  dialogError.value = "";
  submitting.value = true;
  const result = await api<Airline | Application | LedgerEntry>(request.path, {
    method: request.method,
    body: JSON.stringify(request.body),
  });
  submitting.value = false;
  if (!result.ok) {
    dialogError.value = message(result.error);
    return;
  }
  pending.value = null;
  if (target.action === "reject") {
    notice.value = t("applications.rejected", { icao: target.icao });
    await loadApplications();
    return;
  }
  notice.value =
    target.action === "owner"
      ? t("airlines.done.owner", {
          icao: target.icao,
          owner: String(request.body.username),
        })
      : target.action === "adjust"
        ? t("airlines.done.adjust", {
            icao: target.icao,
            amount: formatMoney(Number(request.body.amount)),
          })
        : t(`airlines.done.${target.action}`, { icao: target.icao });
  await loadAirlines();
}

// ── 经济参数 ────────────────────────────────────────────────

const params = ref<Param[]>([]);
const paramsLoading = ref(false);
const editing = ref<string | null>(null);
const draft = ref("");
const paramError = ref("");

const paramColumns = [
  { key: "key", label: t("params.columns.key") },
  { key: "value", label: t("params.columns.value") },
  { key: "actions", label: t("params.columns.actions") },
];

const log = ref<ParamChange[]>([]);
const logNext = ref<Page<ParamChange>["next"]>(null);
const logLoading = ref(false);

const logColumns = [
  { key: "key", label: t("params.logColumns.key") },
  { key: "change", label: t("params.logColumns.change") },
  { key: "actor", label: t("params.logColumns.actor") },
  { key: "at", label: t("params.logColumns.at") },
];

async function loadParams() {
  paramsLoading.value = true;
  const result = await api<{ items: Param[] }>(paramsPath());
  paramsLoading.value = false;
  if (!result.ok) {
    error.value = message(result.error);
    return;
  }
  params.value = result.data.items;
}

async function loadLog(more: boolean) {
  logLoading.value = true;
  const result = await api<Page<ParamChange>>(
    paramsLogPath(more ? logNext.value : null),
  );
  logLoading.value = false;
  if (!result.ok) {
    error.value = message(result.error);
    return;
  }
  log.value = more ? [...log.value, ...result.data.items] : result.data.items;
  logNext.value = result.data.next;
}

function edit(param: Param) {
  clear();
  editing.value = param.key;
  draft.value = String(param.value);
  paramError.value = "";
}

async function save(key: string) {
  const value = parseParamValue(draft.value);
  if (value === null) {
    paramError.value = t("errors.value");
    return;
  }
  busy.value = `param-${key}`;
  const result = await api<Param>(paramPath(key), {
    method: "PUT",
    body: JSON.stringify({ value }),
  });
  busy.value = null;
  if (!result.ok) {
    paramError.value = message(result.error);
    return;
  }
  editing.value = null;
  notice.value = t("params.saved", { key, value: String(result.data.value) });
  await Promise.all([loadParams(), loadLog(false)]);
}

// ── 机场数据 ────────────────────────────────────────────────

async function startImport() {
  clear();
  busy.value = "import";
  const result = await api<{ started: boolean }>(importPath(), {
    method: "POST",
  });
  busy.value = null;
  if (!result.ok) {
    error.value = message(result.error);
    return;
  }
  notice.value = t("import.started");
}

onMounted(() => {
  void loadApplications();
  void loadAirlines();
  void loadParams();
  void loadLog(false);
});
</script>

<template>
  <div class="w-full">
    <PageHeader
      :eyebrow="t('eyebrow')"
      :title="t('title')"
      :description="t('description')"
    />

    <div class="mt-6">
      <Segmented v-model="tab" :segments="tabSegments" :label="t('title')" />
    </div>

    <AlertBox v-if="error" variant="danger" class="mt-4">{{ error }}</AlertBox>
    <AlertBox v-if="notice" variant="success" class="mt-4">{{
      notice
    }}</AlertBox>

    <!-- 开航申请 -->
    <section v-if="tab === 'applications'" class="mt-6">
      <Skeleton v-if="applicationsLoading" variant="table" />
      <DataTable
        v-else
        :columns="applicationColumns"
        :rows="applications"
        row-key="id"
        dense
      >
        <template #empty>
          <EmptyState icon="paperAirplane" :title="t('applications.empty')" />
        </template>
        <template #cell-airline="{ row }">
          <div class="font-medium text-ink">
            <span class="font-mono">{{ row.icao }}</span>
            <span v-if="row.iata" class="font-mono text-muted">
              / {{ row.iata }}</span
            >
            {{ row.name }}
          </div>
          <div class="text-xs text-muted">{{ row.telephony }}</div>
          <p class="mt-1 whitespace-pre-line text-sm text-muted">
            {{ row.description }}
          </p>
        </template>
        <template #cell-applicant="{ row }">
          <span class="font-mono">{{ row.applicant }}</span>
        </template>
        <template #cell-hub="{ row }">
          <span class="font-mono">{{ row.hubIcao }}</span>
        </template>
        <template #cell-createdAt="{ row }">
          <span class="tnum text-muted">{{ formatTime(row.createdAt) }}</span>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-2">
            <Button
              size="sm"
              :loading="busy === `approve-${row.id}`"
              :disabled="busy !== null"
              @click="approve(row)"
            >
              {{ t("applications.approve") }}
            </Button>
            <Button
              size="sm"
              variant="danger"
              :disabled="busy !== null"
              @click="open('reject', row.id, row.icao)"
            >
              {{ t("applications.reject") }}
            </Button>
          </div>
        </template>
      </DataTable>
    </section>

    <!-- 航空公司 -->
    <section v-if="tab === 'airlines'" class="mt-6">
      <Segmented
        v-model="statusFilter"
        :segments="filterSegments"
        :label="t('airlines.columns.status')"
      />
      <div class="mt-4">
        <Skeleton v-if="airlinesLoading" variant="table" />
        <DataTable
          v-else
          :columns="airlineColumns"
          :rows="airlines"
          row-key="id"
          dense
        >
          <template #empty>
            <EmptyState icon="paperAirplane" :title="t('airlines.empty')" />
          </template>
          <template #cell-airline="{ row }">
            <div class="font-medium text-ink">
              <span class="font-mono">{{ row.icao }}</span>
              {{ row.name }}
            </div>
            <div class="font-mono text-xs text-muted">
              #{{ row.id }} · {{ row.hubs.join(" ") }}
            </div>
          </template>
          <template #cell-owner="{ row }">
            <span class="font-mono">{{
              row.owner ?? t("airlines.noOwner")
            }}</span>
          </template>
          <template #cell-status="{ row }">
            <Badge :variant="STATUS_VARIANT[row.status as AirlineStatus]">
              {{ t(`airlines.filter.${row.status}`) }}
            </Badge>
          </template>
          <template #cell-members="{ row }">
            <span class="tnum">{{ row.memberCount }}</span>
          </template>
          <template #cell-balance="{ row }">
            <span
              class="tnum"
              :class="(row.balance ?? 0) < 0 ? 'text-danger-fg' : 'text-ink'"
              >{{
                row.balance === undefined ? "—" : formatMoney(row.balance)
              }}</span
            >
            <div v-if="row.negativeSince" class="text-xs text-danger-fg">
              {{
                t("airlines.negativeSince", {
                  at: formatTime(row.negativeSince),
                })
              }}
            </div>
          </template>
          <template #cell-actions="{ row }">
            <div
              v-if="row.status !== 'closed'"
              class="flex flex-wrap justify-end gap-2"
            >
              <Button
                v-if="row.status === 'active'"
                size="sm"
                variant="secondary"
                :disabled="busy !== null"
                @click="open('suspend', row.id, row.icao)"
              >
                {{ t("airlines.actions.suspend") }}
              </Button>
              <Button
                v-if="row.status === 'suspended'"
                size="sm"
                variant="secondary"
                :loading="busy === `reinstate-${row.id}`"
                :disabled="busy !== null"
                @click="reinstate(row)"
              >
                {{ t("airlines.actions.reinstate") }}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                :disabled="busy !== null"
                @click="open('owner', row.id, row.icao)"
              >
                {{ t("airlines.actions.owner") }}
              </Button>
              <Button
                size="sm"
                variant="secondary"
                :disabled="busy !== null"
                @click="open('adjust', row.id, row.icao)"
              >
                {{ t("airlines.actions.adjust") }}
              </Button>
              <Button
                size="sm"
                variant="danger"
                :disabled="busy !== null"
                @click="open('close', row.id, row.icao)"
              >
                {{ t("airlines.actions.close") }}
              </Button>
            </div>
          </template>
        </DataTable>
      </div>
    </section>

    <!-- 经济参数 -->
    <section v-if="tab === 'params'" class="mt-6">
      <p class="text-sm text-muted">{{ t("params.help") }}</p>
      <AlertBox v-if="paramError" variant="danger" class="mt-4">{{
        paramError
      }}</AlertBox>
      <div class="mt-4">
        <Skeleton v-if="paramsLoading" variant="table" />
        <DataTable
          v-else
          :columns="paramColumns"
          :rows="params"
          row-key="key"
          dense
        >
          <template #empty>
            <EmptyState icon="adjustments" :title="t('params.empty')" />
          </template>
          <template #cell-key="{ row }">
            <span class="font-mono">{{ row.key }}</span>
          </template>
          <template #cell-value="{ row }">
            <Input
              v-if="editing === row.key"
              v-model="draft"
              :label="row.key"
              inputmode="decimal"
            />
            <span v-else class="tnum">{{ row.value }}</span>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-2">
              <template v-if="editing === row.key">
                <Button
                  size="sm"
                  :loading="busy === `param-${row.key}`"
                  @click="save(row.key)"
                >
                  {{ t("params.save") }}
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  :disabled="busy === `param-${row.key}`"
                  @click="editing = null"
                >
                  {{ t("params.cancel") }}
                </Button>
              </template>
              <Button
                v-else
                size="sm"
                variant="secondary"
                :disabled="busy !== null"
                @click="edit(row)"
              >
                {{ t("params.edit") }}
              </Button>
            </div>
          </template>
        </DataTable>
      </div>

      <h2
        class="mb-3 mt-8 text-sm font-semibold uppercase tracking-wider text-muted"
      >
        {{ t("params.log") }}
      </h2>
      <DataTable :columns="logColumns" :rows="log" row-key="at" dense>
        <template #empty>
          <EmptyState icon="clipboardCheck" :title="t('params.logEmpty')" />
        </template>
        <template #cell-key="{ row }">
          <span class="font-mono">{{ row.key }}</span>
        </template>
        <template #cell-change="{ row }">
          <span class="tnum">{{ row.old }} → {{ row.new }}</span>
        </template>
        <template #cell-actor="{ row }">
          <span class="font-mono">{{ row.actor }}</span>
        </template>
        <template #cell-at="{ row }">
          <span class="tnum text-muted">{{ formatTime(row.at) }}</span>
        </template>
      </DataTable>
      <div v-if="logNext !== null" class="mt-4">
        <Button
          variant="secondary"
          :loading="logLoading"
          @click="loadLog(true)"
        >
          {{ t("params.more") }}
        </Button>
      </div>
    </section>

    <!-- 机场数据 -->
    <Card v-if="tab === 'import'" class="mt-6 p-5">
      <h2 class="text-sm font-semibold text-ink">{{ t("import.title") }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t("import.help") }}</p>
      <div class="mt-4">
        <Button :loading="busy === 'import'" @click="startImport">
          {{ t("import.action") }}
        </Button>
      </div>
    </Card>

    <Dialog
      :open="!!pending"
      :dismissible="!submitting"
      size="sm"
      :title="dialogTitle"
      :close-label="t('close')"
      @close="dismiss"
    >
      <AlertBox v-if="dialogError" variant="danger" class="mb-4">{{
        dialogError
      }}</AlertBox>

      <template
        v-if="
          pending && ['reject', 'suspend', 'close'].includes(pending.action)
        "
      >
        <p
          v-if="pending.action === 'close'"
          class="mb-3 text-sm text-danger-fg"
        >
          {{ t("airlines.closeWarning") }}
        </p>
        <p v-if="pending.action === 'reject'" class="mb-3 text-sm text-muted">
          {{ t("applications.reasonHelp") }}
        </p>
        <Textarea v-model="fields.reason" :label="t('airlines.reasonLabel')" />
      </template>

      <template v-if="pending?.action === 'owner'">
        <Input
          v-model="fields.username"
          :label="t('airlines.ownerLabel')"
          :hint="t('airlines.ownerHelp')"
        />
      </template>

      <template v-if="pending?.action === 'adjust'">
        <div class="space-y-3">
          <Input
            v-model="fields.amount"
            :label="t('airlines.amountLabel')"
            :hint="t('airlines.amountHelp')"
            inputmode="decimal"
          />
          <Textarea v-model="fields.note" :label="t('airlines.noteLabel')" />
        </div>
      </template>

      <template #footer>
        <Button variant="secondary" :disabled="submitting" @click="dismiss">
          {{ t("keep") }}
        </Button>
        <Button
          :variant="
            pending?.action === 'close' || pending?.action === 'reject'
              ? 'danger'
              : 'primary'
          "
          :loading="submitting"
          @click="submit"
        >
          {{ t("confirm") }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
