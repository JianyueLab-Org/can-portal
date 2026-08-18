<script setup lang="ts">
/**
 * 服务器目录的管理页。SUP/ADM。
 *
 * 这一页存在的理由不在这一页上，在客户端那边：四个桌面客户端和 ATIS 机队今天把
 * `fsd.ceruleanavi.net:6809`、`audio.ceruleanavi.net:64738` 这些地址写死在各自的
 * settings.py 里。域名从 airwaysn.org 换过来时，那些值**已经写进了每个人的设置文
 * 件** —— 改默认值救不了任何人，四个客户端各发了一个新版本、带上改写表，而没升级
 * 的人只看到连接超时，设置对话框里每一行都正常。
 *
 * 在这里改一行，下一次就不用再来一遍。
 *
 * ## 两条界面上的规矩
 *
 * **按 kind 决定填什么。** fsd / audio 要主机名和端口，datafeed 要完整 URL。表单
 * 跟着 kind 换字段，而不是把三个都摆出来让人猜 —— 上游 `ServerInput.Validate`
 * 也按同一条判，所以填错了不会静默存进去。
 *
 * **停用不是删除。** 删除按钮写的是「停用」，因为上游根本没有 delete：一条停用的
 * 记录是「我设置里这个地址是哪来的」唯一的答案，而客户端只取 active 的，所以停用
 * 已经达到了目的。
 */
import { onMounted, ref } from "vue";
import { createTranslator } from "@/lib/i18n";
import {
  AlertBox,
  Badge,
  Button,
  Card,
  DataTable,
  EmptyState,
  Input,
  PageHeader,
  Select,
  Skeleton,
} from "@jianyuelab-org/can-ui";
import { api, unwrapList } from "@/lib/canApi";

const props = defineProps<{ messages: Record<string, unknown> }>();
const t = createTranslator(props.messages);

/** 和 can-api 的 store.ServerKinds 对齐；那边有测试把这三个字符串钉死。 */
const KINDS = ["fsd", "audio", "datafeed"] as const;
type Kind = (typeof KINDS)[number];

interface ServerRow {
  id: number;
  kind: Kind;
  name: string;
  host?: string;
  port?: number;
  url?: string;
  location?: string;
  active: boolean;
  sortKey: number;
  note?: string;
}

const rows = ref<ServerRow[]>([]);
const loading = ref(true);
const error = ref("");
const notice = ref("");
const busy = ref<number | null>(null);

const columns = [
  { key: "name", label: t("columns.name") },
  { key: "kind", label: t("columns.kind") },
  { key: "address", label: t("columns.address") },
  { key: "location", label: t("columns.location") },
  { key: "state", label: t("columns.state") },
  { key: "actions", label: "" },
];

const kindOptions = KINDS.map((k) => ({ value: k, label: t(`kinds.${k}`) }));

/** 新建表单。kind 决定下面显示哪几个字段。 */
const form = ref<{
  kind: Kind;
  name: string;
  host: string;
  port: string;
  url: string;
  location: string;
  sortKey: string;
}>({
  kind: "fsd",
  name: "",
  host: "",
  port: "",
  url: "",
  location: "",
  sortKey: "0",
});

function addressOf(row: ServerRow): string {
  if (row.kind === "datafeed") return row.url ?? "—";
  return row.host ? `${row.host}:${row.port ?? "?"}` : "—";
}

async function load() {
  loading.value = true;
  error.value = "";
  const result = await api<ServerRow[]>("/api/v1/super/servers");
  loading.value = false;
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  rows.value = unwrapList<ServerRow>(result.data, "servers");
}

async function create() {
  error.value = "";
  notice.value = "";

  // datafeed 送 url，其余送 host/port —— 和上游的校验同一条规矩。多送的字段会被
  // 上游按 kind 拒掉，所以这里不是防呆，是别让请求带着自相矛盾的内容出门。
  const body: Record<string, unknown> = {
    kind: form.value.kind,
    name: form.value.name.trim(),
    location: form.value.location.trim() || null,
    sortKey: Number(form.value.sortKey) || 0,
  };
  if (form.value.kind === "datafeed") {
    body.url = form.value.url.trim();
  } else {
    body.host = form.value.host.trim();
    body.port = Number(form.value.port) || 0;
  }

  busy.value = -1;
  const result = await api<{ id: number }>("/api/v1/super/servers", {
    method: "POST",
    body: JSON.stringify(body),
  });
  busy.value = null;

  if (!result.ok) {
    // 上游把校验失败的原因写在 message 里（"a fsd server needs a port…"），
    // 原样显示比翻译成一句泛泛的「填写有误」有用。
    error.value = result.message;
    return;
  }
  notice.value = t("created", { name: body.name as string });
  form.value = {
    kind: "fsd",
    name: "",
    host: "",
    port: "",
    url: "",
    location: "",
    sortKey: "0",
  };
  await load();
}

async function setActive(row: ServerRow, active: boolean) {
  busy.value = row.id;
  error.value = "";
  notice.value = "";

  const result = active
    ? await api(`/api/v1/super/servers/${row.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: true }),
      })
    : await api(`/api/v1/super/servers/${row.id}`, { method: "DELETE" });

  busy.value = null;
  if (!result.ok) {
    error.value = result.message;
    return;
  }
  notice.value = active
    ? t("restored", { name: row.name })
    : t("retired", { name: row.name });
  await load();
}

onMounted(load);
</script>

<template>
  <div class="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
    <PageHeader
      :eyebrow="t('eyebrow')"
      :title="t('title')"
      :description="t('description')"
    />

    <AlertBox v-if="error" variant="danger" class="mt-4">{{ error }}</AlertBox>
    <AlertBox v-if="notice" variant="success" class="mt-4">{{
      notice
    }}</AlertBox>

    <Card class="mt-6 p-5">
      <h2 class="text-sm font-semibold text-ink">{{ t("add.title") }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t("add.help") }}</p>

      <div class="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Select
          v-model="form.kind"
          :options="kindOptions"
          :label="t('columns.kind')"
        />
        <Input
          v-model="form.name"
          :label="t('columns.name')"
          :placeholder="t('add.namePlaceholder')"
        />

        <!-- kind 决定填什么：主机+端口，或者一个完整 URL。 -->
        <template v-if="form.kind === 'datafeed'">
          <Input
            v-model="form.url"
            label="URL"
            placeholder="https://data.ceruleanavi.net/v1/data.json"
          />
        </template>
        <template v-else>
          <Input
            v-model="form.host"
            :label="t('add.host')"
            :placeholder="
              form.kind === 'fsd'
                ? 'fsd.ceruleanavi.net'
                : 'audio.ceruleanavi.net'
            "
          />
          <Input
            v-model="form.port"
            :label="t('add.port')"
            :placeholder="form.kind === 'fsd' ? '6809' : '64738'"
            inputmode="numeric"
          />
        </template>

        <Input
          v-model="form.location"
          :label="t('columns.location')"
          :placeholder="t('add.locationPlaceholder')"
        />
        <Input
          v-model="form.sortKey"
          :label="t('add.sortKey')"
          inputmode="numeric"
        />
      </div>

      <div class="mt-4">
        <Button :disabled="busy === -1 || !form.name.trim()" @click="create">
          {{ t("add.action") }}
        </Button>
      </div>
    </Card>

    <section class="mt-8">
      <h2
        class="mb-3 text-sm font-semibold uppercase tracking-wider text-muted"
      >
        {{ t("current") }}
      </h2>

      <Skeleton v-if="loading" variant="table" />

      <DataTable v-else :columns="columns" :rows="rows" row-key="id" dense>
        <template #empty>
          <EmptyState
            icon="signal"
            :title="t('empty')"
            :description="t('emptyHelp')"
          />
        </template>

        <template #cell-name="{ row }">
          <span
            :class="row.active ? 'font-medium' : 'font-medium opacity-60'"
            >{{ row.name }}</span
          >
        </template>

        <template #cell-kind="{ row }">
          <Badge>{{ t(`kinds.${row.kind}`) }}</Badge>
        </template>

        <template #cell-address="{ row }">
          <span class="font-mono text-xs">{{ addressOf(row) }}</span>
        </template>

        <template #cell-location="{ row }">
          <span class="text-muted">{{ row.location ?? "—" }}</span>
        </template>

        <template #cell-state="{ row }">
          <Badge :variant="row.active ? 'success' : 'neutral'">
            {{ row.active ? t("states.active") : t("states.retired") }}
          </Badge>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex justify-end">
            <Button
              size="sm"
              :variant="row.active ? 'danger' : 'secondary'"
              :disabled="busy === row.id"
              @click="setActive(row, !row.active)"
            >
              {{ row.active ? t("actions.retire") : t("actions.restore") }}
            </Button>
          </div>
        </template>
      </DataTable>
    </section>
  </div>
</template>
