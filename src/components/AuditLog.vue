<script setup lang="ts">
/**
 * 管理操作时间线。ADM。
 *
 * 只读。每一次成功的管理写入在 can-api 里追加一行，这里把 `summary` 列出来。
 * 点一行没有详情：`changes` 不单独做表，`summary` 就是给人看的那句。
 *
 * 操作列走 `t("actions." + token)`。`createTranslator` 按 `.` 往下走，所以词典里
 * `roster.update` 是嵌套的 `actions.roster.update`，不是一条带点的平键。缺翻译时
 * 露出的是键，不是 token。对象为空显示 `emptyTarget`，不留一块空白。
 *
 * 改任何一个筛选都清空已有行和游标，从最新一页重拉。`nextCursor !== null` 时
 * 「加载更多」把下一页接在后面，不替换。
 */
import { computed, onMounted, ref, watch } from "vue";
import { createTranslator } from "@/lib/i18n";
import { formatLocal } from "@/lib/activities";
import {
  ACTION_GROUPS,
  listPath,
  type AuditEntry,
  type AuditPage,
} from "@/lib/audit";
import {
  AlertBox,
  Button,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Select,
} from "@jianyuelab-org/can-ui";
import { api } from "@/lib/canApi";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);

const action = ref("");
const actor = ref("");
const target = ref("");

const rows = ref<AuditEntry[]>([]);
const nextCursor = ref<number | null>(null);
const loading = ref(true);
const loadingMore = ref(false);
const error = ref("");
let loadSeq = 0;

const columns = [
  { key: "createdAt", label: t("columns.createdAt") },
  { key: "actor", label: t("columns.actor") },
  { key: "action", label: t("columns.action") },
  { key: "target", label: t("columns.target") },
  { key: "summary", label: t("columns.summary") },
];

const actionOptions = computed(() => {
  const options: Array<{ value: string; label: string; disabled?: boolean }> = [
    { value: "", label: t("filters.all") },
  ];
  for (const group of ACTION_GROUPS) {
    options.push({
      value: `group:${group.group}`,
      label: t(`groups.${group.group}`),
      disabled: true,
    });
    for (const name of group.actions) {
      options.push({ value: name, label: t(`actions.${name}`) });
    }
  }
  return options;
});

function failure(code: string): string {
  const key = `errors.${code}`;
  const text = t(key);
  return text === key ? t("errors.generic") : text;
}

function actionLabel(name: string): string {
  return t(`actions.${name}`);
}

function targetLabel(value: string | null): string {
  return value ? value : t("emptyTarget");
}

async function load(reset: boolean) {
  if (!reset && (nextCursor.value === null || loadingMore.value)) return;

  const seq = ++loadSeq;
  if (reset) {
    rows.value = [];
    nextCursor.value = null;
    loading.value = true;
    loadingMore.value = false;
  } else {
    loadingMore.value = true;
  }
  error.value = "";

  const result = await api<AuditPage>(
    listPath({
      action: action.value.startsWith("group:") ? "" : action.value,
      actor: actor.value.trim(),
      target: target.value.trim(),
      cursor: reset ? null : nextCursor.value,
    }),
  );
  if (seq !== loadSeq) return;

  loading.value = false;
  loadingMore.value = false;
  if (!result.ok) {
    error.value = failure(result.error);
    return;
  }

  const incoming = result.data?.entries ?? [];
  rows.value = reset ? incoming : rows.value.concat(incoming);
  nextCursor.value = result.data?.nextCursor ?? null;
}

watch([action, actor, target], () => {
  void load(true);
});

onMounted(() => {
  void load(true);
});
</script>

<template>
  <div class="w-full">
    <PageHeader
      :eyebrow="t('eyebrow')"
      :title="t('title')"
      :description="t('description')"
    />

    <div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Select
        v-model="action"
        :options="actionOptions"
        :label="t('columns.action')"
      />
      <Input
        v-model="actor"
        :label="t('filters.actor')"
        :placeholder="t('filters.actorPlaceholder')"
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        :spellcheck="false"
      />
      <Input
        v-model="target"
        :label="t('filters.target')"
        :placeholder="t('filters.targetPlaceholder')"
        autocomplete="off"
        autocapitalize="none"
        autocorrect="off"
        :spellcheck="false"
      />
    </div>

    <AlertBox v-if="error" variant="danger" class="mt-4">{{ error }}</AlertBox>

    <div class="mt-6">
      <DataTable
        v-if="!error || rows.length"
        :columns="columns"
        :rows="rows"
        row-key="id"
        :loading="loading"
        dense
      >
        <template #empty>
          <EmptyState
            icon="clipboardCheck"
            :title="t('empty')"
            :description="t('emptyHelp')"
          />
        </template>

        <template #cell-createdAt="{ row }">
          <span class="whitespace-normal text-xs">{{
            formatLocal(row.createdAt)
          }}</span>
        </template>
        <template #cell-actor="{ row }">
          <span class="font-mono">{{ row.actor }}</span>
        </template>
        <template #cell-action="{ row }">
          {{ actionLabel(row.action) }}
        </template>
        <template #cell-target="{ row }">
          <span :class="row.target ? 'font-mono' : 'text-muted'">{{
            targetLabel(row.target)
          }}</span>
        </template>
        <template #cell-summary="{ row }">
          <span class="whitespace-normal">{{ row.summary }}</span>
        </template>
      </DataTable>

      <div v-if="nextCursor !== null" class="mt-4 flex justify-center">
        <Button variant="secondary" :loading="loadingMore" @click="load(false)">
          {{ t("more") }}
        </Button>
      </div>
    </div>
  </div>
</template>
