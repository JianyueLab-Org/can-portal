<script setup lang="ts">
/**
 * 投票管理。SUP/ADM。
 *
 * 列出每一个投票，包括 QQ 群和 Discord 服务器里的旧投票；提前结束、删除、发起
 * 官方投票。社区只存了哈希，所以只显示平台和短哈希。没有投票人。
 *
 * 结束和删除在页内确认，不用 `window.confirm` —— 理由见 ManageActivities.vue 的
 * `cancelTarget`。
 */
import { computed, onMounted, ref, watch } from "vue";
import { createTranslator } from "@/lib/i18n";
import { formatLocal, formatZulu } from "@/lib/activities";
import {
  POLL_DURATION_DEFAULT,
  POLL_DURATION_PRESETS,
  POLL_OPTION_MAX,
  POLL_OPTIONS_MAX,
  POLL_OPTIONS_MIN,
  POLL_PAGE_SIZE,
  POLL_PLATFORM_FILTERS,
  POLL_STATUS_FILTERS,
  POLL_TITLE_MAX,
  classifyPollError,
  closeStaffPoll,
  createOfficialPoll,
  deleteStaffPoll,
  getStaffPoll,
  isPollOpen,
  listStaffPolls,
  optionPercent,
  pageCount,
  pollTurnout,
  shortHash,
  validatePollDraft,
  type PollDraftErrors,
  type PollPlatformFilter,
  type PollStatusFilter,
  type StaffPollDetail,
  type StaffPollSummary,
} from "@/lib/polls";
import type { ApiFailure } from "@/lib/canApi";
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
  Segmented,
  Select,
  Skeleton,
} from "@jianyuelab-org/can-ui";

const props = defineProps<{
  messages: Record<string, unknown>;
  /** can-ui 自绘按钮（Dialog 的 ×、AlertBox 的关闭）的文案，见 `@/lib/chrome`。 */
  chrome: Record<string, unknown>;
}>();
const t = createTranslator(props.messages);

const polls = ref<StaffPollSummary[]>([]);
const total = ref(0);
const page = ref(1);
const pageSize = ref(POLL_PAGE_SIZE);
const status = ref<PollStatusFilter>("all");
const platform = ref<PollPlatformFilter>("all");
const loading = ref(true);
const feedback = ref<{ type: "success" | "error"; text: string } | null>(null);

/**
 * 对话框打开时的错误写在对话框里：页面上那条横幅在遮罩后面，写在那里等于
 * 什么都没发生。成功消息仍然走 `feedback`，那时对话框已经关了。
 */
const dialogError = ref<string | null>(null);

// 发起官方投票。
const editorOpen = ref(false);
const draftTitle = ref("");
const draftOptions = ref<string[]>(["", ""]);
const draftDuration = ref<string | number>(POLL_DURATION_DEFAULT);
const fieldErrors = ref<PollDraftErrors>({});
const saving = ref(false);

// 详情。
const detailOpen = ref(false);
const detail = ref<StaffPollDetail | null>(null);
const detailLoading = ref(false);

// 结束 / 删除的确认。
const pending = ref<{
  kind: "close" | "delete";
  poll: StaffPollSummary;
} | null>(null);
const acting = ref(false);

const pages = computed(() => pageCount(total.value, pageSize.value));

const turnout = computed(() =>
  detail.value ? pollTurnout(detail.value) : null,
);

const statusSegments = computed(() =>
  POLL_STATUS_FILTERS.map((value) => ({ value, label: t(`status.${value}`) })),
);
const platformSegments = computed(() =>
  POLL_PLATFORM_FILTERS.map((value) => ({
    value,
    label: t(`platform.${value}`),
  })),
);
const durationOptions = computed(() =>
  POLL_DURATION_PRESETS.map((value) => ({
    value,
    label: t(`form.durations.${value}`),
  })),
);

const columns = computed(() => [
  { key: "title", label: t("columns.title") },
  { key: "scope", label: t("columns.scope") },
  { key: "createdBy", label: t("columns.creator") },
  { key: "closesAt", label: t("columns.closesAt") },
  { key: "voteCount", label: t("columns.votes"), align: "right" as const },
  { key: "actions", label: t("columns.actions"), align: "right" as const },
]);

/** Zulu 和本地时间并排，和活动管理一致。 */
function formatDate(iso: string): string {
  return t("timeWithLocal", { zulu: formatZulu(iso), local: formatLocal(iso) });
}

function failure(result: ApiFailure): string {
  return t(`errors.${classifyPollError(result)}`);
}

let listRequestId = 0;

async function load() {
  const requestId = ++listRequestId;
  loading.value = true;
  const result = await listStaffPolls({
    status: status.value,
    platform: platform.value,
    page: page.value,
  });
  if (requestId !== listRequestId) return;
  loading.value = false;
  if (!result.ok) {
    feedback.value = { type: "error", text: t("errors.load") };
    return;
  }
  polls.value = result.data.polls;
  total.value = result.data.total;
  pageSize.value = result.data.pageSize;
  // 删掉一页上最后一个后，这一页可能已经不存在了。
  const last = pageCount(result.data.total, result.data.pageSize);
  if (page.value > last) page.value = last;
}

watch([status, platform], () => {
  if (page.value === 1) void load();
  else page.value = 1;
});
watch(page, () => void load());

function openCreate() {
  draftTitle.value = "";
  draftOptions.value = ["", ""];
  draftDuration.value = POLL_DURATION_DEFAULT;
  fieldErrors.value = {};
  dialogError.value = null;
  editorOpen.value = true;
}

function addOption() {
  if (draftOptions.value.length < POLL_OPTIONS_MAX) draftOptions.value.push("");
}

function removeOption(index: number) {
  if (draftOptions.value.length > POLL_OPTIONS_MIN)
    draftOptions.value.splice(index, 1);
}

async function save() {
  if (saving.value) return;
  const check = validatePollDraft({
    title: draftTitle.value,
    options: draftOptions.value,
    durationMinutes: Number(draftDuration.value),
  });
  if (!check.ok) {
    fieldErrors.value = check.errors;
    return;
  }
  fieldErrors.value = {};
  saving.value = true;
  dialogError.value = null;
  const result = await createOfficialPoll(check.draft);
  saving.value = false;
  if (!result.ok) {
    dialogError.value = failure(result);
    return;
  }
  editorOpen.value = false;
  feedback.value = { type: "success", text: t("done.created") };
  await load();
}

/** 请求令牌：迟到的回答不该盖掉后打开的那一个。 */
let detailRequestId = 0;

async function loadDetail(id: number) {
  const requestId = ++detailRequestId;
  detailLoading.value = true;
  const result = await getStaffPoll(id);
  if (requestId !== detailRequestId) return;
  detailLoading.value = false;
  if (!result.ok) {
    detailOpen.value = false;
    feedback.value = { type: "error", text: failure(result) };
    return;
  }
  detail.value = result.data;
}

function openDetail(poll: StaffPollSummary) {
  detail.value = null;
  detailOpen.value = true;
  void loadDetail(poll.id);
}

function ask(kind: "close" | "delete", poll: StaffPollSummary) {
  dialogError.value = null;
  pending.value = { kind, poll };
}

async function confirmAction() {
  const p = pending.value;
  if (acting.value || !p) return;
  acting.value = true;
  dialogError.value = null;
  const result =
    p.kind === "close"
      ? await closeStaffPoll(p.poll.id)
      : await deleteStaffPoll(p.poll.id);
  acting.value = false;
  if (!result.ok) {
    dialogError.value = failure(result);
    return;
  }
  pending.value = null;
  feedback.value = {
    type: "success",
    text: t(p.kind === "close" ? "done.closed" : "done.deleted"),
  };
  // 结束的回答没有活跃成员统计，详情重新取一次。
  if (detail.value?.id === p.poll.id) {
    if (p.kind === "delete") detailOpen.value = false;
    else void loadDetail(p.poll.id);
  }
  await load();
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="chartBar"
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
      :messages="chrome"
      @dismiss="feedback = null"
    >
      {{ feedback.text }}
    </AlertBox>

    <Card :title="t('list')" padding="none">
      <div class="space-y-4 p-6">
        <div class="flex flex-wrap items-center gap-3">
          <Segmented
            v-model="status"
            :segments="statusSegments"
            :label="t('filters.status')"
          />
          <Segmented
            v-model="platform"
            :segments="platformSegments"
            :label="t('filters.platform')"
          />
        </div>
        <p class="text-xs text-faint">{{ t("communityHint") }}</p>

        <DataTable
          :columns="columns"
          :rows="polls"
          row-key="id"
          :loading="loading"
          :loading-label="t('loading')"
          :empty="t('empty')"
          :empty-description="t('emptyHint')"
        >
          <template #cell-title="{ row }">
            <span
              class="block whitespace-normal font-medium text-ink sm:min-w-40 sm:max-w-xs"
              >{{ row.title }}</span
            >
          </template>
          <template #cell-scope="{ row }">
            <span class="flex flex-wrap items-center gap-1">
              <Badge v-if="row.official" variant="info" size="sm">{{
                t("official")
              }}</Badge>
              <Badge variant="neutral" size="sm">{{
                t(`platform.${row.platform}`)
              }}</Badge>
              <span
                v-if="row.communityHash"
                class="font-mono text-xs text-muted"
                :title="row.communityHash"
                >{{ shortHash(row.communityHash) }}</span
              >
            </span>
          </template>
          <template #cell-createdBy="{ row }">
            <span class="font-mono text-sm text-ink">{{ row.createdBy }}</span>
          </template>
          <template #cell-closesAt="{ row }">
            <span class="flex flex-col gap-1 whitespace-normal sm:min-w-64">
              <span class="text-sm">{{
                formatDate(row.closedAt ?? row.closesAt)
              }}</span>
              <Badge
                :variant="isPollOpen(row) ? 'success' : 'neutral'"
                size="sm"
                class="self-start"
              >
                {{ isPollOpen(row) ? t("status.open") : t("status.closed") }}
              </Badge>
            </span>
          </template>
          <template #cell-voteCount="{ row }">
            <span class="tnum">{{ row.voteCount }}</span>
          </template>
          <template #cell-actions="{ row }">
            <div class="flex flex-wrap justify-end gap-2 sm:min-w-32">
              <Button size="sm" variant="secondary" @click="openDetail(row)">
                {{ t("actions.view") }}
              </Button>
              <Button
                v-if="isPollOpen(row)"
                size="sm"
                variant="secondary"
                @click="ask('close', row)"
              >
                {{ t("actions.close") }}
              </Button>
              <Button size="sm" variant="ghost" @click="ask('delete', row)">
                {{ t("actions.delete") }}
              </Button>
            </div>
          </template>
        </DataTable>

        <div
          v-if="total > 0"
          class="flex flex-wrap items-center justify-between gap-3"
        >
          <span class="tnum text-sm text-muted">{{
            t("pagination.summary", { page, pages, total })
          }}</span>
          <div class="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              :disabled="page <= 1 || loading"
              @click="page -= 1"
            >
              {{ t("pagination.prev") }}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              :disabled="page >= pages || loading"
              @click="page += 1"
            >
              {{ t("pagination.next") }}
            </Button>
          </div>
        </div>
      </div>
    </Card>

    <!-- 发起官方投票 -->
    <Dialog
      v-model:open="editorOpen"
      size="lg"
      :title="t('form.title')"
      :description="t('form.hint')"
      :messages="chrome"
    >
      <form class="space-y-4" @submit.prevent="save">
        <AlertBox v-if="dialogError" variant="danger">{{
          dialogError
        }}</AlertBox>
        <Input
          v-model="draftTitle"
          name="poll-title"
          :label="t('form.fields.title')"
          :error="
            fieldErrors.title
              ? t(`form.errors.${fieldErrors.title}`)
              : undefined
          "
          :maxlength="POLL_TITLE_MAX"
          required
        />
        <fieldset>
          <legend class="text-sm font-medium text-ink">
            {{ t("form.fields.options") }}
          </legend>
          <p class="mt-1 text-xs text-faint">{{ t("form.optionsHint") }}</p>
          <p v-if="fieldErrors.options" class="mt-1 text-xs text-danger-fg">
            {{ t(`form.errors.${fieldErrors.options}`) }}
          </p>
          <ul class="mt-3 space-y-2">
            <li
              v-for="(_, index) in draftOptions"
              :key="index"
              class="flex items-center gap-2"
            >
              <input
                v-model="draftOptions[index]"
                type="text"
                :maxlength="POLL_OPTION_MAX"
                :placeholder="t('form.optionPlaceholder', { n: index + 1 })"
                :aria-label="t('form.optionPlaceholder', { n: index + 1 })"
                class="input flex-1"
              />
              <Button
                size="sm"
                variant="ghost"
                :disabled="draftOptions.length <= POLL_OPTIONS_MIN"
                :aria-label="t('form.removeOption', { n: index + 1 })"
                @click="removeOption(index)"
              >
                <Icon name="xMark" class="size-4" />
              </Button>
            </li>
          </ul>
          <Button
            class="mt-2"
            size="sm"
            variant="secondary"
            :disabled="draftOptions.length >= POLL_OPTIONS_MAX"
            @click="addOption"
          >
            <template #icon><Icon name="plus" class="size-4" /></template>
            {{ t("form.addOption") }}
          </Button>
        </fieldset>
        <Select
          v-model="draftDuration"
          name="poll-duration"
          :label="t('form.fields.duration')"
          :options="durationOptions"
          :error="
            fieldErrors.duration
              ? t(`form.errors.${fieldErrors.duration}`)
              : undefined
          "
        />
      </form>
      <template #footer>
        <Button variant="secondary" @click="editorOpen = false">{{
          t("close")
        }}</Button>
        <Button :loading="saving" @click="save">{{ t("form.submit") }}</Button>
      </template>
    </Dialog>

    <!-- 详情：各选项票数 -->
    <Dialog
      v-model:open="detailOpen"
      size="lg"
      :title="detail?.title ?? t('loading')"
      :messages="chrome"
    >
      <Skeleton v-if="detailLoading" variant="text" :count="5" />
      <div v-else-if="detail" class="space-y-6">
        <div class="space-y-1.5 text-sm">
          <p class="flex flex-wrap items-center gap-2">
            <Badge
              :variant="isPollOpen(detail) ? 'success' : 'neutral'"
              size="sm"
            >
              {{ isPollOpen(detail) ? t("status.open") : t("status.closed") }}
            </Badge>
            <Badge v-if="detail.official" variant="info" size="sm">{{
              t("official")
            }}</Badge>
            <Badge variant="neutral" size="sm">{{
              t(`platform.${detail.platform}`)
            }}</Badge>
            <span
              v-if="detail.communityHash"
              class="font-mono text-xs text-muted"
              :title="detail.communityHash"
              >{{ shortHash(detail.communityHash) }}</span
            >
          </p>
          <p class="text-muted">
            {{ t("createdBy", { cid: detail.createdBy }) }}
          </p>
          <p class="text-muted">
            {{ t("createdAt", { time: formatDate(detail.createdAt) }) }}
          </p>
          <p class="text-muted">
            {{
              detail.closedAt
                ? t("closedAt", { time: formatDate(detail.closedAt) })
                : t("closesAt", { time: formatDate(detail.closesAt) })
            }}
          </p>
        </div>

        <section>
          <h3
            class="mb-2 text-xs font-semibold uppercase tracking-wider text-muted"
          >
            {{ t("detail.options") }} ·
            {{ t("voteCount", { count: detail.voteCount }) }}
          </h3>
          <p v-if="!detail.voteCount" class="mb-2 text-sm text-muted">
            {{ t("detail.noVotes") }}
          </p>
          <ul class="space-y-1.5">
            <li
              v-for="option in detail.options"
              :key="option.number"
              class="rounded-control bg-surface-sunken px-3 py-2"
            >
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="min-w-0 break-words text-ink"
                  >{{ option.number }}. {{ option.text }}</span
                >
                <span class="tnum shrink-0 text-muted"
                  >{{ t("voteCount", { count: option.votes }) }} ·
                  {{ optionPercent(option.votes, detail.voteCount) }}%</span
                >
              </div>
              <div class="mt-1.5 h-1.5 rounded-full bg-surface-raised">
                <div
                  class="h-1.5 rounded-full bg-can"
                  :style="{
                    width: `${optionPercent(option.votes, detail.voteCount)}%`,
                  }"
                />
              </div>
            </li>
          </ul>
        </section>

        <section v-if="turnout">
          <h3
            class="mb-1 text-xs font-semibold uppercase tracking-wider text-muted"
          >
            {{ t("detail.turnout.title") }} ·
            {{ t("detail.turnout.base", { count: turnout.activeMembers }) }}
          </h3>
          <p class="mb-2 text-xs text-faint">{{ t("detail.turnout.hint") }}</p>
          <ul class="space-y-1.5">
            <li
              v-for="option in turnout.options"
              :key="option.number"
              class="rounded-control bg-surface-sunken px-3 py-2"
            >
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="min-w-0 break-words text-ink"
                  >{{ option.number }}. {{ option.text }}</span
                >
                <span class="tnum shrink-0 text-muted">{{
                  t("detail.turnout.share", {
                    count: option.activeVotes,
                    share: option.share.toFixed(1),
                  })
                }}</span>
              </div>
              <div class="mt-1.5 h-1.5 rounded-full bg-surface-raised">
                <div
                  class="h-1.5 rounded-full bg-can"
                  :style="{ width: `${option.share}%` }"
                />
              </div>
            </li>
            <li class="rounded-control bg-surface-sunken px-3 py-2">
              <div class="flex items-center justify-between gap-3 text-sm">
                <span class="min-w-0 text-muted">{{
                  t("detail.turnout.notVoted")
                }}</span>
                <span class="tnum shrink-0 text-muted">{{
                  t("detail.turnout.share", {
                    count: turnout.notVoted,
                    share: turnout.notVotedShare.toFixed(1),
                  })
                }}</span>
              </div>
              <div class="mt-1.5 h-1.5 rounded-full bg-surface-raised">
                <div
                  class="h-1.5 rounded-full bg-faint"
                  :style="{ width: `${turnout.notVotedShare}%` }"
                />
              </div>
            </li>
          </ul>
        </section>
      </div>
      <template #footer>
        <Button
          v-if="detail && isPollOpen(detail)"
          variant="secondary"
          @click="ask('close', detail)"
        >
          {{ t("actions.close") }}
        </Button>
        <Button v-if="detail" variant="ghost" @click="ask('delete', detail)">
          {{ t("actions.delete") }}
        </Button>
        <Button variant="secondary" @click="detailOpen = false">{{
          t("close")
        }}</Button>
      </template>
    </Dialog>

    <!-- 结束 / 删除的确认，对着标题确认 -->
    <Dialog
      :open="!!pending"
      size="sm"
      :title="
        pending?.kind === 'delete'
          ? t('confirm.deleteTitle')
          : t('confirm.closeTitle')
      "
      :messages="chrome"
      @close="pending = null"
    >
      <AlertBox v-if="dialogError" variant="danger" class="mb-4">{{
        dialogError
      }}</AlertBox>
      <AlertBox
        v-if="pending?.kind === 'delete'"
        variant="warning"
        class="mb-4"
        >{{ t("confirm.deleteBody") }}</AlertBox
      >
      <p v-else class="text-sm text-muted">{{ t("confirm.closeBody") }}</p>
      <p
        class="mt-3 rounded-control bg-surface-sunken px-3 py-2.5 text-sm font-medium text-ink"
      >
        {{ pending?.poll.title }}
      </p>
      <template #footer>
        <Button variant="secondary" @click="pending = null">
          {{ t("confirm.keep") }}
        </Button>
        <Button
          :variant="pending?.kind === 'delete' ? 'danger' : 'primary'"
          :loading="acting"
          @click="confirmAction"
        >
          {{
            pending?.kind === "delete"
              ? t("confirm.deleteAction")
              : t("confirm.closeAction")
          }}
        </Button>
      </template>
    </Dialog>
  </div>
</template>
