<script setup lang="ts">
/**
 * 积分手动调整。SUP/ADM。
 *
 * 上半是调整表单，下半是手动调整记录。记录只追加：记错了就撤销，撤销本身是一
 * 笔反向记录，每笔只能撤销一次，撤销记录不能再撤销。
 *
 * **reference 是幂等键。** 页面打开时生成一个 UUID；提交失败后重试（同一个成员）
 * 沿用同一个，成功后换新，选中的成员变了（选择、更换、清空）也换新 —— 同一个
 * reference 配不同的成员，can-api 会记成第二笔。一次超时的请求可能已经入账，带着同一个 reference 重试，can-api 返
 * 回原来那一行而不是再记一笔。返回的那一行和这次提交的不一样时（重试前改过表
 * 单），页面如实说出来，见 `isReplay`。
 *
 * **不能调整自己。** 选中的是自己时提交按钮禁用，自己的记录上撤销按钮禁用。边界
 * 是 can-api 的 `self_adjust`，这里只是提前说。
 *
 * 确认在页内 `Dialog` 里做，不用 `window.confirm` —— 理由见 ManageActivities.vue
 * 的 `cancelTarget`。余额变负不拦，只标红。
 */
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import { formatLocal, formatZulu } from "@/lib/activities";
import { ratingShort, type RatingRef } from "@/lib/tools";
import {
  HISTORY_PAGE_SIZE,
  POINTS_LIMITS,
  adjustBody,
  balancePath,
  canReverse,
  emptyAdjustForm,
  entryState,
  errorKey,
  formatPoints,
  formatSigned,
  hasErrors,
  isReplay,
  isSelf,
  manualPath,
  mergeEntries,
  newReference,
  projectedBalance,
  reverseBody,
  reversePath,
  signedAmount,
  validateAdjust,
  validateReverseNote,
  type AdjustForm,
  type AdjustFormErrors,
  type AdjustResult,
  type Cursor,
  type Direction,
  type EntryState,
  type ManualEntry,
  type ManualPage,
  type PointsBalance,
} from "@/lib/points";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  Dialog,
  Input,
  PageHeader,
  Segmented,
  Textarea,
} from "@jianyuelab-org/can-ui";
import { api, apiFetch, unwrapList } from "@/lib/canApi";

const props = defineProps<{
  messages: Record<string, unknown>;
  /** 当前操作人的 CAN ID。 */
  sessionUserId: string;
}>();
const t = createTranslator(props.messages);

interface Member {
  username: string;
  name: string;
  rating: RatingRef;
}

const feedback = ref<{
  type: "success" | "warning" | "error";
  text: string;
} | null>(null);

// —— 成员搜索 ——————————————————————————————————————————————

const search = ref("");
const results = ref<Member[]>([]);
const searching = ref(false);

/**
 * 和 AipAccess.vue 同一套：停手 250 ms 再发；每次发都记一个序号，回来的不是最
 * 新那次就丢掉。`/api/v1/super/members` 上限 20 条，是服务端定的。
 */
const SEARCH_DEBOUNCE_MS = 250;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let searchSeq = 0;

function scheduleSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, SEARCH_DEBOUNCE_MS);
}

/** 清空搜索，连同还在路上的那次。 */
function resetSearch() {
  clearTimeout(searchTimer);
  searchSeq++;
  search.value = "";
  results.value = [];
  searching.value = false;
}

async function runSearch() {
  const seq = ++searchSeq;
  const query = search.value.trim();
  if (query.length < 2) {
    results.value = [];
    searching.value = false;
    return;
  }

  searching.value = true;
  let found: Member[] = [];
  try {
    const response = await apiFetch(
      `/api/v1/super/members?q=${encodeURIComponent(query)}`,
    );
    const payload = await response.json().catch(() => ({}));
    if (response.ok) found = unwrapList<Member>(payload?.data, "members");
  } catch {
    found = [];
  }
  if (seq !== searchSeq) return;
  results.value = found;
  searching.value = false;
}

// —— 选中的成员与余额 ————————————————————————————————————————

const selected = ref<Member | null>(null);
const balance = ref<number | null>(null);
const balanceLoading = ref(false);
const balanceError = ref<string | null>(null);
/** 换人时上一个人的余额可能还在路上；序号对不上就丢掉。 */
let balanceSeq = 0;

const form = ref<AdjustForm>(emptyAdjustForm());
const fieldErrors = ref<AdjustFormErrors>({});
/** 幂等键。见文件头。 */
const reference = ref(newReference());

const confirmOpen = ref(false);
const submitting = ref(false);
/** 对话框里的错误写在对话框里：页面横幅在遮罩后面。 */
const dialogError = ref<string | null>(null);

const selfSelected = computed(() =>
  isSelf(form.value.username, props.sessionUserId),
);

const directionSegments = computed<Array<{ value: Direction; label: string }>>(
  () => [
    { value: "grant", label: t("form.grant") },
    { value: "deduct", label: t("form.deduct") },
  ],
);

const pendingAmount = computed(() => signedAmount(form.value));

const projected = computed(() =>
  balance.value === null || pendingAmount.value === null
    ? null
    : projectedBalance(balance.value, pendingAmount.value),
);

const balanceText = computed(() => {
  if (balanceLoading.value) return t("form.balanceLoading");
  if (balanceError.value) return balanceError.value;
  if (balance.value === null) return "";
  return t("form.balance", { balance: formatPoints(balance.value) });
});

function selectMember(member: Member) {
  selected.value = member;
  form.value.username = member.username;
  fieldErrors.value = {};
  reference.value = newReference();
  resetSearch();
  void loadBalance(member.username);
}

function changeMember() {
  balanceSeq++;
  selected.value = null;
  form.value.username = "";
  reference.value = newReference();
  balance.value = null;
  balanceError.value = null;
  balanceLoading.value = false;
}

async function loadBalance(username: string) {
  const seq = ++balanceSeq;
  balanceLoading.value = true;
  balanceError.value = null;
  balance.value = null;
  const result = await api<PointsBalance>(balancePath(username));
  if (seq !== balanceSeq) return;
  balanceLoading.value = false;
  if (!result.ok) {
    balanceError.value =
      result.error === "not_found" ? failure("not_found") : t("errors.balance");
    return;
  }
  balance.value = result.data.balance;
}

function errorText(field: keyof AdjustFormErrors): string | undefined {
  const key = fieldErrors.value[field];
  return key ? t(`errors.${key}`) : undefined;
}

function failure(code: string): string {
  return t(`errors.${errorKey(code)}`);
}

/** 先校验，通过了再打开确认。 */
function review() {
  feedback.value = null;
  const errors = validateAdjust(form.value, props.sessionUserId);
  fieldErrors.value = errors;
  if (hasErrors(errors)) return;
  dialogError.value = null;
  confirmOpen.value = true;
}

async function submit() {
  if (submitting.value) return;
  const body = adjustBody(form.value, reference.value);
  submitting.value = true;
  dialogError.value = null;
  const result = await api<AdjustResult>("/api/v1/super/points/adjust", {
    method: "POST",
    body: JSON.stringify(body),
  });
  submitting.value = false;

  if (!result.ok) {
    // reference 不换：重试必须带同一个。
    dialogError.value = failure(result.error);
    return;
  }

  reference.value = newReference();
  confirmOpen.value = false;
  const { entry, balance: after } = result.data;
  if (selected.value?.username === entry.username) balance.value = after;
  feedback.value = isReplay(entry, body)
    ? {
        type: "warning",
        text: t("done.replayed", { amount: formatSigned(entry.amount) }),
      }
    : {
        type: "success",
        text: t("done.adjusted", {
          member: entry.username,
          amount: formatSigned(entry.amount),
          balance: formatPoints(after),
        }),
      };
  // 成员和方向留着：给同一个人连记几笔是常见操作。
  form.value = {
    ...emptyAdjustForm(),
    username: form.value.username,
    direction: form.value.direction,
  };
  fieldErrors.value = {};
  await loadHistory(true);
}

// —— 调整记录 ————————————————————————————————————————————————

const entries = ref<ManualEntry[]>([]);
const nextCursor = ref<Cursor | null>(null);
const historyLoading = ref(true);
const loadingMore = ref(false);
const historyError = ref<string | null>(null);
const filter = ref("");
const appliedFilter = ref("");
let historySeq = 0;

const columns = computed(() => [
  { key: "createdAt", label: t("history.columns.time") },
  { key: "username", label: t("history.columns.member") },
  {
    key: "amount",
    label: t("history.columns.amount"),
    align: "right" as const,
  },
  { key: "detail", label: t("history.columns.detail") },
  { key: "note", label: t("history.columns.note") },
  { key: "operator", label: t("history.columns.operator") },
  {
    key: "status",
    label: t("history.columns.status"),
    align: "right" as const,
  },
]);

const STATE_VARIANT: Record<EntryState, "success" | "neutral" | "info"> = {
  active: "success",
  reversed: "neutral",
  reversal: "info",
};

/**
 * 读一页。`reset` 从头读，否则接在已有的后面。
 *
 * 接着读而不是换页：撤销记录比原记录新，排在它上面，所以「已撤销」那一行要链
 * 过去的那一行一定已经在表里。
 */
async function loadHistory(reset: boolean) {
  const seq = ++historySeq;
  if (reset) historyLoading.value = true;
  else loadingMore.value = true;
  historyError.value = null;

  const result = await api<ManualPage>(
    manualPath({
      username: appliedFilter.value,
      cursor: reset ? null : nextCursor.value,
      limit: HISTORY_PAGE_SIZE,
    }),
  );
  if (seq !== historySeq) return;
  historyLoading.value = false;
  loadingMore.value = false;

  if (!result.ok) {
    historyError.value = t("errors.load");
    return;
  }
  const page = unwrapList<ManualEntry>(result.data, "entries");
  entries.value = reset ? page : mergeEntries(entries.value, page);
  nextCursor.value = result.data?.nextCursor ?? null;
}

function applyFilter() {
  appliedFilter.value = filter.value.trim();
  void loadHistory(true);
}

function clearFilter() {
  filter.value = "";
  appliedFilter.value = "";
  void loadHistory(true);
}

function formatDate(iso: string): string {
  return t("timeWithLocal", { zulu: formatZulu(iso), local: formatLocal(iso) });
}

/** 已撤销的行变灰。 */
function dim(row: ManualEntry): string {
  return entryState(row) === "reversed" ? "opacity-50" : "";
}

function anchor(id: number): string {
  return `points-entry-${id}`;
}

// —— 撤销 ————————————————————————————————————————————————————

const reverseTarget = ref<ManualEntry | null>(null);
const reverseNote = ref("");
const reverseError = ref<string | null>(null);
const reversing = ref(false);

function askReverse(entry: ManualEntry) {
  reverseTarget.value = entry;
  reverseNote.value = "";
  reverseError.value = null;
}

async function confirmReverse() {
  const target = reverseTarget.value;
  if (reversing.value || !target) return;
  const noteError = validateReverseNote(reverseNote.value);
  if (noteError) {
    reverseError.value = t(`errors.${noteError}`);
    return;
  }

  reversing.value = true;
  reverseError.value = null;
  const result = await api<AdjustResult>(reversePath(target.id), {
    method: "POST",
    body: JSON.stringify(reverseBody(reverseNote.value)),
  });
  reversing.value = false;

  if (!result.ok) {
    reverseError.value = failure(result.error);
    // 别人先撤销了：表里这一行是旧的，刷新让它变灰。
    if (result.error === "already_reversed") void loadHistory(true);
    return;
  }

  reverseTarget.value = null;
  const after = result.data.balance;
  if (selected.value?.username === target.username) balance.value = after;
  feedback.value = {
    type: "success",
    text: t("done.reversed", {
      id: target.id,
      member: target.username,
      balance: formatPoints(after),
    }),
  };
  await loadHistory(true);
}

onMounted(() => loadHistory(true));
onBeforeUnmount(() => clearTimeout(searchTimer));
</script>

<template>
  <div>
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="adjustments"
    />

    <AlertBox
      v-if="feedback"
      class="mb-6"
      :variant="feedback.type === 'error' ? 'danger' : feedback.type"
      dismissible
      @dismiss="feedback = null"
    >
      {{ feedback.text }}
    </AlertBox>

    <!-- 调整 -->
    <Card :title="t('form.title')" :subtitle="t('form.help')" class="mb-6">
      <template v-if="!selected">
        <div class="max-w-sm">
          <Input
            v-model="search"
            type="search"
            name="points-member-search"
            :label="t('form.search')"
            :placeholder="t('form.searchPlaceholder')"
            :error="errorText('username')"
            autocomplete="off"
            autocapitalize="none"
            autocorrect="off"
            :spellcheck="false"
            @input="scheduleSearch"
          />
        </div>
        <p v-if="searching" class="mt-3 text-sm text-muted">
          {{ t("loading") }}
        </p>
        <ul v-else-if="results.length" class="mt-3 space-y-1.5">
          <li
            v-for="m in results"
            :key="m.username"
            class="flex flex-wrap items-center gap-3 rounded-control bg-surface-sunken px-3 py-2"
          >
            <span class="font-mono text-sm font-semibold text-ink">{{
              m.username
            }}</span>
            <span class="text-sm text-ink">{{ m.name }}</span>
            <span class="text-xs text-faint">{{ ratingShort(m.rating) }}</span>
            <Button
              size="sm"
              variant="secondary"
              class="ml-auto"
              @click="selectMember(m)"
            >
              {{ t("form.select") }}
            </Button>
          </li>
        </ul>
        <p
          v-else-if="search.trim().length >= 2"
          class="mt-3 text-sm text-muted"
        >
          {{ t("form.noMatches") }}
        </p>
      </template>

      <template v-else>
        <div
          class="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-control bg-surface-sunken px-3 py-2.5"
        >
          <span class="font-mono text-sm font-semibold text-ink">{{
            selected.username
          }}</span>
          <span class="text-sm text-ink">{{ selected.name }}</span>
          <span class="text-xs text-faint">{{
            ratingShort(selected.rating)
          }}</span>
          <span
            class="tnum text-sm"
            :class="balanceError ? 'text-danger-fg' : 'text-muted'"
          >
            {{ balanceText }}
          </span>
          <Button
            size="sm"
            variant="ghost"
            class="ml-auto"
            @click="changeMember"
          >
            {{ t("form.change") }}
          </Button>
        </div>
        <AlertBox v-if="selfSelected" variant="warning" class="mt-3">
          {{ t("errors.selfAdjust") }}
        </AlertBox>
      </template>

      <form class="mt-5 space-y-4" @submit.prevent="review">
        <div class="space-y-1.5">
          <span class="block text-sm font-medium text-ink">{{
            t("form.direction")
          }}</span>
          <Segmented
            v-model="form.direction"
            :segments="directionSegments"
            :label="t('form.direction')"
          />
        </div>
        <div class="max-w-xs">
          <Input
            v-model="form.amount"
            name="points-amount"
            inputmode="numeric"
            :label="t('form.amount')"
            :hint="t('form.amountHint')"
            :error="errorText('amount')"
            autocomplete="off"
            required
          />
        </div>
        <Textarea
          v-model="form.detail"
          name="points-detail"
          :label="t('form.detail')"
          :hint="t('form.detailHint')"
          :error="errorText('detail')"
          :maxlength="POINTS_LIMITS.detail"
          :rows="2"
          counter
          required
        />
        <Input
          v-model="form.note"
          name="points-note"
          :label="t('form.note')"
          :hint="t('form.noteHint')"
          :error="errorText('note')"
          :maxlength="POINTS_LIMITS.note"
          autocomplete="off"
        />
        <div class="flex justify-end">
          <Button type="submit" :disabled="selfSelected">
            {{ t("form.submit") }}
          </Button>
        </div>
      </form>
    </Card>

    <!-- 调整记录 -->
    <Card :title="t('history.title')" padding="none">
      <div class="p-6">
        <form
          class="mb-4 flex flex-wrap items-end gap-2"
          @submit.prevent="applyFilter"
        >
          <div class="w-48">
            <Input
              v-model="filter"
              name="points-filter"
              :label="t('history.filter')"
              :placeholder="t('history.filterPlaceholder')"
              autocomplete="off"
              autocapitalize="none"
              autocorrect="off"
              :spellcheck="false"
            />
          </div>
          <Button type="submit" variant="secondary">
            {{ t("history.apply") }}
          </Button>
          <Button v-if="appliedFilter" variant="ghost" @click="clearFilter">
            {{ t("history.clear") }}
          </Button>
        </form>

        <AlertBox v-if="historyError" variant="danger" class="mb-4">
          {{ historyError }}
        </AlertBox>

        <DataTable
          :columns="columns"
          :rows="entries"
          row-key="id"
          :loading="historyLoading"
          :loading-label="t('loading')"
          :empty="t('history.empty')"
          :empty-description="t('history.emptyHint')"
          dense
        >
          <template #cell-createdAt="{ row }">
            <span
              :id="anchor(row.id)"
              class="whitespace-normal text-xs"
              :class="dim(row)"
              >{{ formatDate(row.createdAt) }}</span
            >
          </template>
          <template #cell-username="{ row }">
            <span class="font-mono" :class="dim(row)">{{ row.username }}</span>
          </template>
          <template #cell-amount="{ row }">
            <span
              class="tnum font-semibold"
              :class="[
                dim(row),
                row.amount < 0 ? 'text-danger-fg' : 'text-success-fg',
              ]"
              >{{ formatSigned(row.amount) }}</span
            >
          </template>
          <template #cell-detail="{ row }">
            <span
              class="whitespace-normal text-sm text-ink"
              :class="dim(row)"
              >{{ row.detail }}</span
            >
          </template>
          <template #cell-note="{ row }">
            <span
              class="whitespace-normal text-xs text-muted"
              :class="dim(row)"
              >{{ row.note ?? "—" }}</span
            >
          </template>
          <template #cell-operator="{ row }">
            <span class="font-mono text-xs text-muted" :class="dim(row)">{{
              row.operator
            }}</span>
          </template>
          <template #cell-status="{ row }">
            <div class="flex flex-wrap items-center justify-end gap-2">
              <Badge :variant="STATE_VARIANT[entryState(row)]" size="sm">
                {{ t(`history.status.${entryState(row)}`) }}
              </Badge>
              <a
                v-if="row.reversedBy !== null"
                :href="`#${anchor(row.reversedBy)}`"
                class="text-xs text-can underline"
                >{{ t("history.reversedBy", { id: row.reversedBy }) }}</a
              >
              <a
                v-else-if="row.reverses !== null"
                :href="`#${anchor(row.reverses)}`"
                class="text-xs text-can underline"
                >{{ t("history.reverses", { id: row.reverses }) }}</a
              >
              <Button
                v-if="entryState(row) === 'active'"
                size="sm"
                variant="ghost"
                :disabled="!canReverse(row, props.sessionUserId)"
                @click="askReverse(row)"
              >
                {{ t("history.reverseAction") }}
              </Button>
            </div>
          </template>
        </DataTable>

        <div
          v-if="nextCursor !== null && !historyLoading"
          class="mt-4 flex justify-center"
        >
          <Button
            variant="secondary"
            :loading="loadingMore"
            @click="loadHistory(false)"
          >
            {{ t("history.more") }}
          </Button>
        </div>
      </div>
    </Card>

    <!-- 调整确认：成员、带符号金额、余额 → 新余额 -->
    <Dialog
      v-model:open="confirmOpen"
      :dismissible="!submitting"
      size="sm"
      :title="t('confirm.title')"
      :close-label="t('close')"
    >
      <AlertBox v-if="dialogError" variant="danger" class="mb-4">{{
        dialogError
      }}</AlertBox>
      <dl class="space-y-2 text-sm">
        <div class="flex justify-between gap-4">
          <dt class="text-muted">{{ t("confirm.member") }}</dt>
          <dd class="text-right text-ink">
            <span class="font-mono">{{ selected?.username }}</span>
            {{ selected?.name }}
          </dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">{{ t("confirm.amount") }}</dt>
          <dd
            class="tnum font-semibold"
            :class="
              (pendingAmount ?? 0) < 0 ? 'text-danger-fg' : 'text-success-fg'
            "
          >
            {{ pendingAmount === null ? "" : formatSigned(pendingAmount) }}
          </dd>
        </div>
        <div class="flex justify-between gap-4">
          <dt class="text-muted">{{ t("confirm.balance") }}</dt>
          <dd class="tnum text-ink">
            {{
              balance === null
                ? t("confirm.unknownBalance")
                : formatPoints(balance)
            }}
            →
            <span
              class="font-semibold"
              :class="
                projected !== null && projected < 0
                  ? 'text-danger-fg'
                  : 'text-ink'
              "
              >{{
                projected === null
                  ? t("confirm.unknownBalance")
                  : formatPoints(projected)
              }}</span
            >
          </dd>
        </div>
      </dl>
      <p
        v-if="projected !== null && projected < 0"
        class="mt-3 text-sm text-danger-fg"
      >
        {{ t("confirm.negative") }}
      </p>
      <p
        class="mt-3 whitespace-pre-line rounded-control bg-surface-sunken px-3 py-2.5 text-sm text-ink"
      >
        {{ form.detail.trim() }}
      </p>
      <template #footer>
        <Button
          variant="secondary"
          :disabled="submitting"
          @click="confirmOpen = false"
        >
          {{ t("confirm.keep") }}
        </Button>
        <Button
          :variant="(pendingAmount ?? 0) < 0 ? 'danger' : 'primary'"
          :loading="submitting"
          @click="submit"
        >
          {{ t("confirm.action") }}
        </Button>
      </template>
    </Dialog>

    <!-- 撤销确认，带可选的内部备注 -->
    <Dialog
      :open="!!reverseTarget"
      :dismissible="!reversing"
      size="sm"
      :title="t('reverse.title')"
      :close-label="t('close')"
      @close="reverseTarget = null"
    >
      <AlertBox v-if="reverseError" variant="danger" class="mb-4">{{
        reverseError
      }}</AlertBox>
      <p class="text-sm text-muted">
        {{
          reverseTarget
            ? t("reverse.body", {
                id: reverseTarget.id,
                amount: formatSigned(-reverseTarget.amount),
              })
            : ""
        }}
      </p>
      <p
        class="mt-3 rounded-control bg-surface-sunken px-3 py-2.5 text-sm text-ink"
      >
        <span class="font-mono">{{ reverseTarget?.username }}</span>
        ·
        <span class="tnum">{{
          reverseTarget ? formatSigned(reverseTarget.amount) : ""
        }}</span>
        · {{ reverseTarget?.detail }}
      </p>
      <div class="mt-4">
        <Input
          v-model="reverseNote"
          name="points-reverse-note"
          :label="t('reverse.note')"
          :hint="t('form.noteHint')"
          :maxlength="POINTS_LIMITS.note"
          autocomplete="off"
        />
      </div>
      <template #footer>
        <Button
          variant="secondary"
          :disabled="reversing"
          @click="reverseTarget = null"
        >
          {{ t("reverse.keep") }}
        </Button>
        <Button variant="danger" :loading="reversing" @click="confirmReverse">
          {{ t("reverse.action") }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
