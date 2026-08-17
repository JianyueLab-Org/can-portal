<script setup lang="ts">
/**
 * The feedback disclosure board, staff side.
 *
 * A case names two different people on purpose: the member the result concerns
 * and the staff who decided it. Both are picked from the member list rather
 * than typed, so the board cannot end up quoting an CAN ID that belongs to
 * nobody.
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
  subject: string | null;
  subjectName: string | null;
  status: number;
  publishedAt: string | null;
  createdAt: string;
  handlers: Person[];
}

const cases = ref<FeedbackCase[]>([]);
const loading = ref(true);
const saving = ref(false);
const busyId = ref<number | null>(null);
const feedback = ref<{ type: "success" | "error"; text: string } | null>(null);

const editingId = ref<number | null>(null);
const form = ref({ title: "", summary: "", result: "" });
const handlers = ref<Person[]>([]);
const subject = ref<Person | null>(null);
const fieldErrors = ref<CaseErrors>({});

/** One picker's worth of search state, reused for handlers and the subject. */
const search = ref({ handler: "", subject: "" });
const results = ref<{ handler: Member[]; subject: Member[] }>({
  handler: [],
  subject: [],
});
const searching = ref<"handler" | "subject" | null>(null);

const columns = computed(() => [
  { key: "code", label: t("columns.code") },
  { key: "title", label: t("columns.title") },
  { key: "subject", label: t("columns.subject") },
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
  handlers.value = [];
  subject.value = null;
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
  handlers.value = [...item.handlers];
  subject.value = item.subject
    ? { username: item.subject, name: item.subjectName }
    : null;
  fieldErrors.value = {};
  window.scrollTo({ top: 0, behavior: "smooth" });
}

async function lookup(which: "handler" | "subject") {
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

function addHandler(member: Member) {
  if (handlers.value.some((h) => h.username === member.username)) return;
  if (handlers.value.length >= LIMITS.handlers) return;
  handlers.value.push({ username: member.username, name: member.name });
  search.value.handler = "";
  results.value.handler = [];
}

function removeHandler(username: string) {
  handlers.value = handlers.value.filter((h) => h.username !== username);
}

function chooseSubject(member: Member) {
  subject.value = { username: member.username, name: member.name };
  search.value.subject = "";
  results.value.subject = [];
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
    subject: subject.value?.username ?? "",
    handlers: handlers.value.map((h) => h.username),
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
        subject: item.subject ?? "",
        handlers: item.handlers.map((h) => h.username),
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
          <!-- Handlers -->
          <div>
            <label class="block text-sm font-medium text-ink">
              {{ t("fields.handlers") }} <span class="text-danger">*</span>
            </label>
            <p class="mt-0.5 text-xs text-muted">{{ t("hints.handlers") }}</p>

            <div v-if="handlers.length" class="mt-2 flex flex-wrap gap-1.5">
              <span
                v-for="person in handlers"
                :key="person.username"
                class="inline-flex items-center gap-1 rounded-control bg-surface-sunken px-2 py-1 text-xs text-ink"
              >
                {{ personLabel(person) }}
                <button
                  type="button"
                  class="text-faint hover:text-danger"
                  :aria-label="t('removeHandler')"
                  @click="removeHandler(person.username)"
                >
                  <Icon name="xMark" class="size-3.5" />
                </button>
              </span>
            </div>

            <div class="mt-2 flex gap-2">
              <input
                v-model="search.handler"
                type="search"
                class="input text-sm"
                :placeholder="t('searchMember')"
                @keyup.enter="lookup('handler')"
              />
              <Button
                size="sm"
                variant="secondary"
                :loading="searching === 'handler'"
                @click="lookup('handler')"
              >
                {{ t("search") }}
              </Button>
            </div>

            <ul v-if="results.handler.length" class="mt-2 space-y-1">
              <li v-for="member in results.handler" :key="member.username">
                <button
                  type="button"
                  class="w-full rounded-control px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                  @click="addHandler(member)"
                >
                  {{ personLabel(member) }}
                </button>
              </li>
            </ul>
            <p v-if="errorText('handlers')" class="mt-1 text-xs text-danger">
              {{ errorText("handlers") }}
            </p>
          </div>

          <!-- Subject -->
          <div>
            <label class="block text-sm font-medium text-ink">{{
              t("fields.subject")
            }}</label>
            <p class="mt-0.5 text-xs text-muted">{{ t("hints.subject") }}</p>

            <div v-if="subject" class="mt-2 flex flex-wrap gap-1.5">
              <span
                class="inline-flex items-center gap-1 rounded-control bg-surface-sunken px-2 py-1 text-xs text-ink"
              >
                {{ personLabel(subject) }}
                <button
                  type="button"
                  class="text-faint hover:text-danger"
                  :aria-label="t('clearSubject')"
                  @click="subject = null"
                >
                  <Icon name="xMark" class="size-3.5" />
                </button>
              </span>
            </div>

            <div class="mt-2 flex gap-2">
              <input
                v-model="search.subject"
                type="search"
                class="input text-sm"
                :placeholder="t('searchMember')"
                @keyup.enter="lookup('subject')"
              />
              <Button
                size="sm"
                variant="secondary"
                :loading="searching === 'subject'"
                @click="lookup('subject')"
              >
                {{ t("search") }}
              </Button>
            </div>

            <ul v-if="results.subject.length" class="mt-2 space-y-1">
              <li v-for="member in results.subject" :key="member.username">
                <button
                  type="button"
                  class="w-full rounded-control px-2 py-1.5 text-left text-sm hover:bg-surface-sunken"
                  @click="chooseSubject(member)"
                >
                  {{ personLabel(member) }}
                </button>
              </li>
            </ul>
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
        <template #cell-subject="{ row }">
          <span v-if="row.subject" class="text-sm text-ink">
            {{ row.subjectName ?? row.subject }}
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
