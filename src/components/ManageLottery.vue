<script setup lang="ts">
/**
 * 抽奖管理。SUP/ADM。
 *
 * 这一页只做四件事：开草稿、改草稿、发布、取消，外加查看报名和中奖名单。
 *
 * **没有开奖按钮。** 开奖是 can-api 的定时任务在截止后自己做的；界面上多一个按
 * 钮，就多一条和它抢同一期的路。
 *
 * **中奖者的奖品不在这里发。** 每个中奖者拿到一笔 0 积分的兑换，出现在奖品管理页
 * 的兑换申请里，和积分兑换走同一条发放流程。这里只放一条链接过去。
 *
 * 发布和取消在页内确认，不用 `window.confirm` —— 理由见 ManageActivities.vue 的
 * `cancelTarget`。
 */
import { computed, onMounted, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import { formatLocal, formatZulu } from "@/lib/activities";
import {
  LOTTERY_CANCELLED,
  LOTTERY_DRAFT,
  LOTTERY_DRAWN,
  LOTTERY_LIMITS,
  LOTTERY_OPEN,
  LOTTERY_STATUS,
  canCancel,
  canEdit,
  emptyForm,
  errorKey,
  formFromLottery,
  hasClosed,
  hasErrors,
  lotteryBody,
  pickerRows,
  shortfalls,
  toInstant,
  unitsOf,
  validateLottery,
  type LotteryForm,
  type LotteryFormErrors,
  type LotteryPrize,
  type LotterySummary,
  type ShopPrize,
  type SuperLotteryDetail,
} from "@/lib/lottery";
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
  Textarea,
} from "@jianyuelab-org/can-ui";
import { api, unwrapList } from "@/lib/canApi";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);

const lotteries = ref<LotterySummary[]>([]);
const shop = ref<ShopPrize[]>([]);
const loading = ref(true);
const feedback = ref<{ type: "success" | "error"; text: string } | null>(null);

/**
 * 对话框打开时的错误写在对话框里：页面上那条横幅在遮罩后面，写在那里等于
 * 什么都没发生。成功消息仍然走 `feedback`，那时对话框已经关了。
 */
const dialogError = ref<string | null>(null);

// 编辑器：新建和改草稿共用。有 id 表示「保存到那一期」。
const editorOpen = ref(false);
const editingId = ref<number | null>(null);
/** 正在改的草稿原来挂的奖品。商店里已经删掉的那几件靠它留在选择器里。 */
const editingPrizes = ref<LotteryPrize[]>([]);
const form = ref<LotteryForm>(emptyForm());
const fieldErrors = ref<LotteryFormErrors>({});
const saving = ref(false);

// 详情：报名和中奖名单。
const detailOpen = ref(false);
const detail = ref<SuperLotteryDetail | null>(null);
const detailLoading = ref(false);

// 发布 / 取消的确认。
const pending = ref<{
  kind: "publish" | "cancel";
  lottery: LotterySummary;
} | null>(null);
const acting = ref(false);

const STATUS_VARIANT: Record<
  number,
  "neutral" | "success" | "info" | "danger"
> = {
  [LOTTERY_DRAFT]: "neutral",
  [LOTTERY_OPEN]: "success",
  [LOTTERY_DRAWN]: "info",
  [LOTTERY_CANCELLED]: "danger",
};

const columns = computed(() => [
  { key: "title", label: t("columns.title") },
  { key: "closesAt", label: t("columns.closesAt") },
  { key: "status", label: t("columns.status") },
  { key: "prizes", label: t("columns.prizes") },
  { key: "entryCount", label: t("columns.entries"), align: "right" as const },
  { key: "actions", label: t("columns.actions"), align: "right" as const },
]);

const timezoneOptions = computed(() => [
  { value: "zulu", label: t("timezones.zulu") },
  { value: "local", label: t("timezones.local") },
]);

const rows = computed(() => pickerRows(shop.value, editingPrizes.value));
const overStock = computed(
  () => new Set(shortfalls(shop.value, form.value.counts)),
);
const closesAtPreview = computed(() => {
  const d = toInstant(form.value.closesAt, form.value.timezone);
  return Number.isNaN(d.getTime()) ? undefined : formatDate(d.toISOString());
});

const winners = computed(() => detail.value?.winners ?? []);
const entries = computed(() => detail.value?.entries ?? []);
const detailPrizeNames = computed(
  () => new Map((detail.value?.prizes ?? []).map((p) => [p.prizeId, p.name])),
);

/** 一份过期的草稿不给发布：发出去会立刻开一次没人报名的奖。 */
const publishExpired = computed(
  () =>
    pending.value?.kind === "publish" &&
    hasClosed(pending.value.lottery.closesAt, new Date()),
);

const confirmText = computed(() => {
  const p = pending.value;
  if (!p) return "";
  if (p.kind === "publish") {
    return t("confirm.publishBody", {
      units: unitsOf(p.lottery.prizes),
      time: formatDate(p.lottery.closesAt),
    });
  }
  return t(
    p.lottery.status === LOTTERY_OPEN
      ? "confirm.cancelOpen"
      : "confirm.cancelDraft",
  );
});

/** Zulu 和本地时间并排，和活动管理一致。 */
function formatDate(iso: string): string {
  return t("timeWithLocal", { zulu: formatZulu(iso), local: formatLocal(iso) });
}

function statusLabel(status: number): string {
  return t(`status.${LOTTERY_STATUS[status] ?? "draft"}`);
}

function prizeList(prizes: LotteryPrize[]): string {
  return prizes
    .map((p) => t("prizeItem", { name: p.name, count: p.count }))
    .join(" · ");
}

function wonName(prizeId: number | null): string {
  if (prizeId === null) return "";
  return detailPrizeNames.value.get(prizeId) ?? `#${prizeId}`;
}

function errorText(field: keyof LotteryFormErrors): string | undefined {
  const key = fieldErrors.value[field];
  return key ? t(`errors.${key}`) : undefined;
}

function failure(code: string): string {
  return t(`errors.${errorKey(code)}`);
}

async function load() {
  loading.value = true;
  // 两条的形状不一样：lottery 包在 `lotteries` 下，prize 直接是数组。
  // unwrapList 两种都认。
  const [list, prizes] = await Promise.all([
    api<unknown>("/api/v1/super/lottery"),
    api<unknown>("/api/v1/super/prize"),
  ]);
  loading.value = false;
  if (!list.ok || !prizes.ok) {
    feedback.value = { type: "error", text: t("errors.load") };
    return;
  }
  lotteries.value = unwrapList<LotterySummary>(list.data, "lotteries");
  shop.value = unwrapList<ShopPrize>(prizes.data, "prizes");
}

function openCreate() {
  editingId.value = null;
  editingPrizes.value = [];
  form.value = emptyForm();
  fieldErrors.value = {};
  dialogError.value = null;
  editorOpen.value = true;
}

function openEdit(lottery: LotterySummary) {
  editingId.value = lottery.id;
  editingPrizes.value = lottery.prizes;
  form.value = formFromLottery(lottery);
  fieldErrors.value = {};
  dialogError.value = null;
  editorOpen.value = true;
}

async function save() {
  if (saving.value) return;
  const errors = validateLottery(form.value, new Date());
  fieldErrors.value = errors;
  if (hasErrors(errors)) return;

  saving.value = true;
  dialogError.value = null;
  const id = editingId.value;
  const result = await api<{ lottery: SuperLotteryDetail }>(
    id ? `/api/v1/super/lottery/${id}` : "/api/v1/super/lottery",
    {
      method: id ? "PATCH" : "POST",
      body: JSON.stringify(lotteryBody(form.value)),
    },
  );
  saving.value = false;

  if (!result.ok) {
    dialogError.value = failure(result.error);
    return;
  }
  editorOpen.value = false;
  feedback.value = {
    type: "success",
    text: t(id ? "done.updated" : "done.created"),
  };
  await load();
}

async function openDetail(lottery: LotterySummary) {
  detail.value = null;
  detailOpen.value = true;
  detailLoading.value = true;
  const result = await api<{ lottery: SuperLotteryDetail }>(
    `/api/v1/super/lottery/${lottery.id}`,
  );
  detailLoading.value = false;
  if (!result.ok) {
    detailOpen.value = false;
    feedback.value = { type: "error", text: failure(result.error) };
    return;
  }
  detail.value = result.data.lottery;
}

function ask(kind: "publish" | "cancel", lottery: LotterySummary) {
  dialogError.value = null;
  pending.value = { kind, lottery };
}

async function confirmAction() {
  const p = pending.value;
  if (acting.value || !p) return;
  if (publishExpired.value) {
    dialogError.value = t("errors.publishExpired");
    return;
  }

  acting.value = true;
  dialogError.value = null;
  const result = await api<{ lottery: SuperLotteryDetail }>(
    `/api/v1/super/lottery/${p.lottery.id}/${p.kind}`,
    { method: "POST" },
  );
  acting.value = false;

  if (!result.ok) {
    dialogError.value = failure(result.error);
    return;
  }
  pending.value = null;
  feedback.value = {
    type: "success",
    text: t(p.kind === "publish" ? "done.published" : "done.cancelled"),
  };
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="sparkles"
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

    <AlertBox variant="info" class="mb-6">
      {{ t("redemptionNote") }}
      <a href="/super/prizes" class="font-medium text-can underline">{{
        t("redemptionLink")
      }}</a>
    </AlertBox>

    <Card :title="t('list')" padding="none">
      <div class="p-6">
        <DataTable
          :columns="columns"
          :rows="lotteries"
          row-key="id"
          :loading="loading"
          :loading-label="t('loading')"
          :empty="t('noLotteries')"
          :empty-description="t('noLotteriesHint')"
        >
          <template #cell-title="{ row }">
            <span class="font-medium text-ink">{{ row.title }}</span>
          </template>
          <template #cell-closesAt="{ row }">
            <span class="whitespace-normal text-sm">{{
              formatDate(row.closesAt)
            }}</span>
          </template>
          <template #cell-status="{ row }">
            <Badge :variant="STATUS_VARIANT[row.status] ?? 'neutral'" size="sm">
              {{ statusLabel(row.status) }}
            </Badge>
          </template>
          <template #cell-prizes="{ row }">
            <span class="whitespace-normal text-xs text-muted">{{
              prizeList(row.prizes)
            }}</span>
          </template>
          <template #cell-entryCount="{ row }">
            <span class="tnum">{{ row.entryCount }}</span>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex justify-end gap-2">
              <Button size="sm" variant="secondary" @click="openDetail(row)">
                {{ t("actions.view") }}
              </Button>
              <Button
                v-if="canEdit(row.status)"
                size="sm"
                variant="secondary"
                @click="openEdit(row)"
              >
                {{ t("actions.edit") }}
              </Button>
              <Button
                v-if="canEdit(row.status)"
                size="sm"
                @click="ask('publish', row)"
              >
                {{ t("actions.publish") }}
              </Button>
              <Button
                v-if="canCancel(row.status)"
                size="sm"
                variant="ghost"
                @click="ask('cancel', row)"
              >
                {{ t("actions.cancel") }}
              </Button>
            </div>
          </template>
        </DataTable>
      </div>
    </Card>

    <!-- 新建 / 改草稿 -->
    <Dialog
      v-model:open="editorOpen"
      size="lg"
      :title="editingId ? t('editor.editTitle') : t('editor.newTitle')"
      :description="t('editor.hint')"
      :close-label="t('close')"
    >
      <form class="space-y-4" @submit.prevent="save">
        <AlertBox v-if="dialogError" variant="danger">{{
          dialogError
        }}</AlertBox>
        <Input
          v-model="form.title"
          name="lottery-title"
          :label="t('fields.title')"
          :error="errorText('title')"
          :maxlength="LOTTERY_LIMITS.title"
          required
        />
        <Textarea
          v-model="form.description"
          name="lottery-description"
          :label="t('fields.description')"
          :error="errorText('description')"
          :maxlength="LOTTERY_LIMITS.description"
          :rows="3"
        />
        <div class="grid gap-4 sm:grid-cols-2">
          <Input
            v-model="form.closesAt"
            type="datetime-local"
            name="lottery-closes"
            :label="t('fields.closesAt')"
            :error="errorText('closesAt')"
            :hint="closesAtPreview ?? t('hints.closesAt')"
            required
          />
          <Select
            v-model="form.timezone"
            name="lottery-timezone"
            :label="t('fields.timezone')"
            :options="timezoneOptions"
          />
        </div>

        <fieldset>
          <legend class="text-sm font-medium text-ink">
            {{ t("fields.prizes") }}
          </legend>
          <p class="mt-1 text-xs text-faint">{{ t("hints.prizes") }}</p>
          <p v-if="errorText('prizes')" class="mt-1 text-xs text-danger-fg">
            {{ errorText("prizes") }}
          </p>
          <p v-if="!rows.length" class="mt-3 text-sm text-muted">
            {{ t("noShopPrizes") }}
          </p>
          <ul v-else class="mt-3 space-y-1.5">
            <li
              v-for="row in rows"
              :key="row.prizeId"
              class="flex items-center gap-3 rounded-control bg-surface-sunken px-3 py-2"
            >
              <div class="min-w-0 flex-1">
                <span class="block truncate text-sm font-medium text-ink">{{
                  row.name
                }}</span>
                <span
                  class="text-xs"
                  :class="
                    overStock.has(row.prizeId)
                      ? 'text-warning-fg'
                      : 'text-faint'
                  "
                >
                  {{
                    row.stock === null
                      ? t("stockMissing")
                      : overStock.has(row.prizeId)
                        ? t("overStock", { stock: row.stock })
                        : t("stock", { stock: row.stock })
                  }}
                </span>
              </div>
              <input
                v-model="form.counts[row.prizeId]"
                type="number"
                min="0"
                step="1"
                inputmode="numeric"
                :aria-label="t('countFor', { name: row.name })"
                class="input w-24 text-right"
              />
            </li>
          </ul>
        </fieldset>
      </form>
      <template #footer>
        <Button variant="secondary" @click="editorOpen = false">{{
          t("close")
        }}</Button>
        <Button :loading="saving" @click="save">
          {{ editingId ? t("editor.save") : t("editor.create") }}
        </Button>
      </template>
    </Dialog>

    <!-- 详情：报名与中奖 -->
    <Dialog
      v-model:open="detailOpen"
      size="lg"
      :title="detail?.title ?? t('loading')"
      :close-label="t('close')"
    >
      <Skeleton v-if="detailLoading" variant="text" :count="5" />
      <div v-else-if="detail" class="space-y-6">
        <div class="space-y-1.5 text-sm">
          <p class="flex flex-wrap items-center gap-2">
            <Badge
              :variant="STATUS_VARIANT[detail.status] ?? 'neutral'"
              size="sm"
            >
              {{ statusLabel(detail.status) }}
            </Badge>
            <span class="text-muted">{{
              t("detail.closesAt", { time: formatDate(detail.closesAt) })
            }}</span>
          </p>
          <p v-if="detail.drawnAt" class="text-muted">
            {{ t("detail.drawnAt", { time: formatDate(detail.drawnAt) }) }}
          </p>
          <p v-if="detail.description" class="whitespace-pre-line text-ink">
            {{ detail.description }}
          </p>
        </div>

        <section>
          <h3
            class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted"
          >
            {{ t("detail.prizes") }}
          </h3>
          <p class="text-sm text-ink">{{ prizeList(detail.prizes) }}</p>
        </section>

        <section v-if="detail.status === LOTTERY_DRAWN">
          <h3
            class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted"
          >
            {{ t("detail.winners") }}
          </h3>
          <p v-if="!winners.length" class="text-sm text-muted">
            {{ t("detail.noWinners") }}
          </p>
          <ul v-else class="space-y-1.5">
            <li
              v-for="w in winners"
              :key="w.username"
              class="flex items-center justify-between gap-3 rounded-control bg-surface-sunken px-3 py-2"
            >
              <span class="font-mono text-sm text-ink">{{ w.username }}</span>
              <Badge variant="success" size="sm">{{ w.prizeName }}</Badge>
            </li>
          </ul>
          <p class="mt-2 text-xs text-faint">
            {{ t("redemptionNote") }}
            <a href="/super/prizes" class="text-can underline">{{
              t("redemptionLink")
            }}</a>
          </p>
        </section>
        <p
          v-else-if="detail.status === LOTTERY_OPEN"
          class="text-sm text-muted"
        >
          {{ t("detail.notDrawnYet") }}
        </p>

        <section>
          <h3
            class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted"
          >
            {{ t("detail.entries", { count: entries.length }) }}
          </h3>
          <p v-if="!entries.length" class="text-sm text-muted">
            {{ t("detail.noEntries") }}
          </p>
          <ul v-else class="max-h-80 space-y-1.5 overflow-y-auto">
            <li
              v-for="e in entries"
              :key="e.username"
              class="flex items-center gap-3 rounded-control bg-surface-sunken px-3 py-2"
            >
              <span class="font-mono text-sm text-ink">{{ e.username }}</span>
              <span class="flex-1 text-xs text-faint">{{
                formatDate(e.createdAt)
              }}</span>
              <Badge v-if="e.prizeId !== null" variant="success" size="sm">{{
                wonName(e.prizeId)
              }}</Badge>
            </li>
          </ul>
        </section>
      </div>
      <template #footer>
        <Button variant="secondary" @click="detailOpen = false">{{
          t("close")
        }}</Button>
      </template>
    </Dialog>

    <!-- 发布 / 取消的确认，对着标题确认而不是一句光秃秃的「确定？」 -->
    <Dialog
      :open="!!pending"
      size="sm"
      :title="
        pending?.kind === 'publish'
          ? t('confirm.publishTitle')
          : t('confirm.cancelTitle')
      "
      :close-label="t('close')"
      @close="pending = null"
    >
      <AlertBox v-if="dialogError" variant="danger" class="mb-4">{{
        dialogError
      }}</AlertBox>
      <AlertBox v-else-if="publishExpired" variant="warning" class="mb-4">{{
        t("errors.publishExpired")
      }}</AlertBox>
      <p class="text-sm text-muted">{{ confirmText }}</p>
      <p
        class="mt-3 rounded-control bg-surface-sunken px-3 py-2.5 text-sm font-medium text-ink"
      >
        {{ pending?.lottery.title }}
      </p>
      <template #footer>
        <Button variant="secondary" @click="pending = null">
          {{ t("confirm.keep") }}
        </Button>
        <Button
          :variant="pending?.kind === 'cancel' ? 'danger' : 'primary'"
          :loading="acting"
          :disabled="publishExpired"
          @click="confirmAction"
        >
          {{
            pending?.kind === "publish"
              ? t("confirm.publishAction")
              : t("confirm.cancelAction")
          }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
