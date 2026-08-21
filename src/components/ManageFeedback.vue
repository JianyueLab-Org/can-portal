<script setup lang="ts">
/**
 * The feedback disclosure board, staff side.
 *
 * A case names two different sets of people on purpose: the members the result
 * concerns (被反馈人员) and the staff who decided it. Both are picked from the
 * member list rather than typed, so the board cannot end up quoting an CAN ID
 * that belongs to nobody, and both are plural — one incident routinely
 * involves more than one member on either side.
 *
 * Which is why there is one picker component's worth of state and markup for
 * both, keyed by side: they were two near-identical blocks while the subject
 * was singular, and the copy that would have followed is what drifts.
 *
 * Publishing is a separate step from saving. A case is drafted, read back, and
 * only then put on a page the whole network can see.
 */
import { computed, onMounted, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  CASE_DRAFT,
  CASE_PUBLISHED,
  CASE_STATUS,
  LIMITS,
  hasErrors,
  validateCase,
  type CaseErrors,
} from "@/lib/feedback";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  Icon,
  Input,
  PageHeader,
} from "@jianyuelab-org/can-ui";
import { apiFetch, unwrapList } from "@/lib/canApi";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);

interface Person {
  username: string;
  name: string | null;
}
interface Member extends Person {
  rating: number;
}
interface FeedbackCase {
  id: number;
  code: string;
  title: string;
  summary: string;
  result: string;
  status: number;
  publishedAt: string | null;
  createdAt: string;
  handlers: Person[];
  subjects: Person[];
}

/** The two sides of a case: who decided it, and who it is about. */
type Side = "handler" | "subject";

const cases = ref<FeedbackCase[]>([]);
const loading = ref(true);
const saving = ref(false);
const busyId = ref<number | null>(null);
const feedback = ref<{ type: "success" | "error"; text: string } | null>(null);

const editingId = ref<number | null>(null);
const form = ref({ title: "", summary: "", result: "" });
const chosen = ref<Record<Side, Person[]>>({ handler: [], subject: [] });
const fieldErrors = ref<CaseErrors>({});

/** One picker's worth of search state per side. */
const search = ref<Record<Side, string>>({ handler: "", subject: "" });
const results = ref<Record<Side, Member[]>>({ handler: [], subject: [] });
const searching = ref<Side | null>(null);

/**
 * What differs between the two pickers, and nothing else does.
 *
 * `required` is the real difference rather than a styling one: a decision
 * nobody is named against is what this board exists to stop, while a case
 * about a process is legitimately about nobody.
 */
const pickers = computed(() => [
  {
    side: "handler" as const,
    label: t("fields.handlers"),
    hint: t("hints.handlers"),
    removeLabel: t("removeHandler"),
    error: errorText("handlers"),
    limit: LIMITS.handlers,
    required: true,
  },
  {
    side: "subject" as const,
    label: t("fields.subjects"),
    hint: t("hints.subjects"),
    removeLabel: t("removeSubject"),
    error: errorText("subjects"),
    limit: LIMITS.subjects,
    required: false,
  },
]);

const columns = computed(() => [
  { key: "code", label: t("columns.code") },
  { key: "title", label: t("columns.title") },
  { key: "subjects", label: t("columns.subjects") },
  { key: "handlers", label: t("columns.handlers") },
  { key: "status", label: t("columns.status") },
  { key: "actions", label: t("columns.actions"), align: "right" as const },
]);

function personLabel(person: Person): string {
  return person.name ? `${person.name} (${person.username})` : person.username;
}

function errorText(field: keyof CaseErrors): string | undefined {
  const key = fieldErrors.value[field];
  return key ? t(`errors.${key}`) : undefined;
}

function resetForm() {
  editingId.value = null;
  form.value = { title: "", summary: "", result: "" };
  chosen.value = { handler: [], subject: [] };
  fieldErrors.value = {};
  search.value = { handler: "", subject: "" };
  results.value = { handler: [], subject: [] };
}

function edit(item: FeedbackCase) {
  editingId.value = item.id;
  form.value = {
    title: item.title,
    summary: item.summary,
    result: item.result,
  };
  // Copies, not the row's own arrays: editing the form must not rewrite the
  // table underneath it before anything has been saved.
  chosen.value = {
    handler: [...item.handlers],
    subject: [...item.subjects],
  };
  fieldErrors.value = {};
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function lookup(which: Side) {
  const query = search.value[which].trim();
  if (!query) {
    results.value[which] = [];
    return;
  }

  searching.value = which;
  try {
    const response = await apiFetch(
      `/api/v1/super/members?q=${encodeURIComponent(query)}`,
    );
    const payload = await response.json().catch(() => ({}));
    results.value[which] = response.ok
      ? unwrapList<Member>(payload?.data, "members")
      : [];
  } catch {
    results.value[which] = [];
  } finally {
    searching.value = null;
  }
}

function addPerson(side: Side, member: Member, limit: number) {
  const list = chosen.value[side];
  if (list.some((p) => p.username === member.username)) return;
  if (list.length >= limit) return;
  list.push({ username: member.username, name: member.name });
  search.value[side] = "";
  results.value[side] = [];
}

function removePerson(side: Side, username: string) {
  chosen.value[side] = chosen.value[side].filter(
    (p) => p.username !== username,
  );
}

async function load() {
  loading.value = true;
  try {
    const response = await apiFetch("/api/v1/super/feedback");
    if (!response.ok) throw new Error(t("errors.load"));
    cases.value = unwrapList<FeedbackCase>(
      (await response.json().catch(() => ({})))?.data,
      "cases",
    );
  } catch (error) {
    feedback.value = {
      type: "error",
      text: error instanceof Error ? error.message : t("errors.load"),
    };
  } finally {
    loading.value = false;
  }
}

async function save(publish: boolean) {
  const input = {
    ...form.value,
    handlers: chosen.value.handler.map((p) => p.username),
    subjects: chosen.value.subject.map((p) => p.username),
  };

  const errors = validateCase(input);
  fieldErrors.value = errors;
  if (hasErrors(errors)) return;

  saving.value = true;
  feedback.value = null;

  try {
    const editing = editingId.value;
    const response = await apiFetch(
      editing ? `/api/v1/super/feedback/${editing}` : "/api/v1/super/feedback",
      {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        // `publish` 是布尔，不是 status 数字 —— can-api 读的是 `publish`，由
        // 它决定 status 和 publishedAt（internal/api/manage.go 的 caseInput）。
        // 之前这里发的是 `status: 0|1`，服务端根本没有这个字段：JSON 解出来
        // publish 恒为 false，于是「公示」按下去存成草稿，界面还提示已公示。
        //
        // 不发 code：编号是 can-api 生成的（feedbackCase.code 是唯一键，谁持有
        // 约束谁发号），编辑时留空即保持原值。
        body: JSON.stringify({ ...input, publish }),
      },
    );
    const payload = await response.json().catch(() => ({}));

    if (response.status === 422) {
      fieldErrors.value = payload?.fields ?? {};
      return;
    }
    if (!response.ok) throw new Error(t("errors.save"));

    feedback.value = {
      type: "success",
      text: t(publish ? "published" : editing ? "updated" : "created"),
    };
    resetForm();
    await load();
  } catch (error) {
    feedback.value = {
      type: "error",
      text: error instanceof Error ? error.message : t("errors.save"),
    };
  } finally {
    saving.value = false;
  }
}

async function setStatus(item: FeedbackCase, status: number) {
  if (status === CASE_DRAFT && !window.confirm(t("confirmUnpublish"))) return;

  busyId.value = item.id;
  try {
    // 整条回传，不是只发一个开关。这条 PATCH 在 can-api 上绑的是 Upsert ——
    // **整条替换**，不是局部更新。只发 `{status}` 有两个后果，先后发生：标题、
    // 经过、结果都是空的，先被必填校验挡成 400；而万一哪天放宽了校验，就轮到
    // 空串盖掉正文，一次公示按钮抹掉整篇案件。
    const response = await apiFetch(`/api/v1/super/feedback/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: item.title,
        summary: item.summary,
        result: item.result,
        handlers: item.handlers.map((h) => h.username),
        subjects: item.subjects.map((s) => s.username),
        publish: status === CASE_PUBLISHED,
      }),
    });
    if (!response.ok) throw new Error(t("errors.save"));
    await load();
  } catch (error) {
    feedback.value = {
      type: "error",
      text: error instanceof Error ? error.message : t("errors.save"),
    };
  } finally {
    busyId.value = null;
  }
}

async function remove(item: FeedbackCase) {
  if (!window.confirm(t("confirmDelete", { code: item.code }))) return;

  busyId.value = item.id;
  try {
    const response = await apiFetch(`/api/v1/super/feedback/${item.id}`, {
      method: "DELETE",
    });
    if (!response.ok) throw new Error(t("errors.delete"));
    feedback.value = { type: "success", text: t("deleted") };
    await load();
  } catch (error) {
    feedback.value = {
      type: "error",
      text: error instanceof Error ? error.message : t("errors.delete"),
    };
  } finally {
    busyId.value = null;
  }
}

onMounted(load);
</script>

<template>
  <div>
    <PageHeader
      :title="t('title')"
      :description="t('description')"
      icon="megaphone"
    />

    <AlertBox
      v-if="feedback"
      :variant="feedback.type === 'success' ? 'success' : 'danger'"
      dismissible
      class="mb-6"
      @dismiss="feedback = null"
    >
      {{ feedback.text }}
    </AlertBox>

    <Card
      :title="editingId ? t('editCase') : t('newCase')"
      :subtitle="t('codeHint')"
      class="mb-6"
    >
      <div class="space-y-4">
        <Input
          v-model="form.title"
          name="title"
          :label="t('fields.title')"
          :error="errorText('title')"
          :maxlength="LIMITS.title"
          required
        />

        <div>
          <label for="summary" class="block text-sm font-medium text-ink">
            {{ t("fields.summary") }} <span class="text-danger">*</span>
          </label>
          <textarea
            id="summary"
            v-model="form.summary"
            rows="3"
            :maxlength="LIMITS.summary"
            class="input mt-1.5"
          ></textarea>
          <p v-if="errorText('summary')" class="mt-1 text-xs text-danger">
            {{ errorText("summary") }}
          </p>
        </div>

        <div>
          <label for="result" class="block text-sm font-medium text-ink">
            {{ t("fields.result") }} <span class="text-danger">*</span>
          </label>
          <textarea
            id="result"
            v-model="form.result"
            rows="3"
            :maxlength="LIMITS.result"
            class="input mt-1.5"
          ></textarea>
          <p v-if="errorText('result')" class="mt-1 text-xs text-danger">
            {{ errorText("result") }}
          </p>
        </div>

        <div class="grid gap-4 lg:grid-cols-2">
          <!-- Handled by, and who the case is about. Same picker, twice. -->
          <div v-for="picker in pickers" :key="picker.side">
            <label class="block text-sm font-medium text-ink">
              {{ picker.label }}
              <span v-if="picker.required" class="text-danger">*</span>
            </label>
            <p class="mt-0.5 text-xs text-muted">{{ picker.hint }}</p>

            <div
              v-if="chosen[picker.side].length"
              class="mt-2 flex flex-wrap gap-1.5"
            >
              <span
                v-for="person in chosen[picker.side]"
                :key="person.username"
                class="inline-flex items-center gap-1 rounded-control bg-surface-sunken px-2 py-1 text-xs text-ink"
              >
                {{ personLabel(person) }}
                <button
                  type="button"
                  class="text-faint hover:text-danger"
                  :aria-label="picker.removeLabel"
                  @click="removePerson(picker.side, person.username)"
                >
                  <Icon name="xMark" class="size-3.5" />
                </button>
              </span>
            </div>

            <div class="mt-2 flex gap-2">
              <input
                v-model="search[picker.side]"
                type="search"
                class="input text-sm"
                :placeholder="t('searchMember')"
                @keyup.enter="lookup(picker.side)"
              />
              <Button
                size="sm"
                variant="secondary"
                :loading="searching === picker.side"
                @click="lookup(picker.side)"
              >
                {{ t("search") }}
              </Button>
            </div>

            <ul v-if="results[picker.side].length" class="mt-2 space-y-1">
              <li v-for="member in results[picker.side]" :key="member.username">
                <button
                  type="button"
                  class="w-full rounded-control px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                  @click="addPerson(picker.side, member, picker.limit)"
                >
                  {{ personLabel(member) }}
                </button>
              </li>
            </ul>
            <p v-if="picker.error" class="mt-1 text-xs text-danger">
              {{ picker.error }}
            </p>
          </div>
        </div>
      </div>

      <div class="mt-4 flex flex-wrap gap-2">
        <Button variant="secondary" :loading="saving" @click="save(false)">
          {{ t("saveDraft") }}
        </Button>
        <Button :loading="saving" @click="save(true)">
          <template #icon><Icon name="megaphone" class="size-4" /></template>
          {{ t("publish") }}
        </Button>
        <Button v-if="editingId" variant="ghost" @click="resetForm">
          {{ t("cancelEdit") }}
        </Button>
      </div>
    </Card>

    <Card :title="t('board')">
      <DataTable
        :columns="columns"
        :rows="cases"
        row-key="id"
        dense
        :loading="loading"
        :loading-label="t('loading')"
        :empty="t('noCases')"
      >
        <template #cell-code="{ row }">
          <span class="tnum font-mono text-xs font-semibold text-ink">{{
            row.code
          }}</span>
        </template>
        <template #cell-title="{ row }">
          <span class="font-medium text-ink">{{ row.title }}</span>
          <span class="mt-0.5 block max-w-md truncate text-xs text-faint">{{
            row.summary
          }}</span>
        </template>
        <template #cell-subjects="{ row }">
          <span v-if="row.subjects.length" class="text-sm text-ink">
            {{ row.subjects.map((s) => s.name ?? s.username).join("、") }}
          </span>
          <span v-else class="text-xs text-faint">—</span>
        </template>
        <template #cell-handlers="{ row }">
          <span class="text-sm text-ink">
            {{
              row.handlers.map((h) => h.name ?? h.username).join("、") || "—"
            }}
          </span>
        </template>
        <template #cell-status="{ row }">
          <Badge
            :variant="row.status === CASE_PUBLISHED ? 'success' : 'neutral'"
            size="sm"
          >
            {{ t(`status.${CASE_STATUS[row.status] ?? "draft"}`) }}
          </Badge>
        </template>
        <template #cell-actions="{ row }">
          <div class="flex justify-end gap-2">
            <Button size="sm" variant="secondary" @click="edit(row)">
              {{ t("edit") }}
            </Button>
            <Button
              size="sm"
              :variant="row.status === CASE_PUBLISHED ? 'ghost' : 'primary'"
              :loading="busyId === row.id"
              @click="
                setStatus(
                  row,
                  row.status === CASE_PUBLISHED ? CASE_DRAFT : CASE_PUBLISHED,
                )
              "
            >
              {{
                row.status === CASE_PUBLISHED ? t("unpublish") : t("publish")
              }}
            </Button>
            <Button
              size="sm"
              variant="danger"
              :loading="busyId === row.id"
              @click="remove(row)"
            >
              {{ t("delete") }}
            </Button>
          </div>
        </template>
      </DataTable>
    </Card>
  </div>
</template>
