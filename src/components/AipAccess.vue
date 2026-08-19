<script setup lang="ts">
/**
 * 航行资料库的访问授权。**只有 ADM。**
 *
 * 这一页管的是 can-api `user.aipAccess` 那一列 —— 谁能打开
 * database.ceruleanavi.net（can-db），以及只读还是可编辑。
 *
 * ## 为什么它是独立的一页，而不是花名册上的一栏
 *
 * 花名册（`/instr/roster`）是**教员**的页面，门槛 8 级；这件事是 ADM 的，12 级。
 * 把它挂在那一页上，等于让大多数打开那一页的人看见一栏他们既改不动、也不该关心
 * 的东西 —— 而且那一栏管的还是另一个系统的权限。
 *
 * 更要紧的是：花名册那一栏栏管的是**管制资历**（哪个分部、哪个席位），而这一列
 * 管的是**资料校对权限**。两拨人只是碰巧有重叠。放在一起会让人以为升一级管制员
 * 就该顺手给一份数据库权限，而那正是 can-api 的 schema 注释特意写下不要做的事。
 *
 * ## 三件事这个岛屿刻意不做
 *
 * **不判自己够不够格。** 页面能不能开由中间件按 12 级决定，请求成不成由 can-api
 * 的 `WithAdmin` 决定。在这里再抄一份只会多一处可能不一致的判断。
 *
 * **不拦「改自己」。** can-api 会答 409（一个 ADM 撤销了自己就没人能撤回，因为撤
 * 回的路就是这条路），而这边把那句话显示出来。在前端提前拦掉看着更友好，但那样
 * 这条规则就有了两份实现，而**宽的那一份会先被人发现**。
 *
 * **不缓存名单。** 每次操作后重新拉一遍。这是一份权限清单，它显示的东西必须是此
 * 刻数据库里的样子，而不是这个标签页打开时的样子。
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
import { api, apiFetch, unwrapList } from "@/lib/canApi";
import { ratingShort, type RatingRef } from "@/lib/tools";

const props = defineProps<{
  messages: Record<string, unknown>;
  /** 当前 ADM 自己的 CAN ID，只用来在表里标出「这是你」。 */
  sessionUserId: string;
}>();
const t = createTranslator(props.messages);

/**
 * 三个级别，和 can-api 的 `store.AIPNone/AIPRead/AIPWrite` 对齐。
 *
 * can-api 的 `aipaccess_test.go` 把这三个数字钉死，就是为了让这类副本敢依赖它们。
 */
const ACCESS_NONE = 0;
const ACCESS_READ = 1;
const ACCESS_WRITE = 2;
/**
 * 受限资料的两级。
 *
 * 3 / 4 是给**官方 AIP 汇编**（民航局 NAIP）那一类数据用的 —— 它和面向模拟的派生数据不
 * 是一回事，所以自成一档，而不是复用「可编辑」。
 *
 * **门槛跟着数据走，不写死在代码里**：can-db 的 `dataset.min_access` 记着每一批数据要多
 * 少级才看得到，这里只负责发级别。所以以后再来一批受限数据，不用改这个文件。
 */
const ACCESS_RESTRICTED_READ = 3;
const ACCESS_RESTRICTED_WRITE = 4;

interface Grantee {
  username: string;
  name: string;
  // can-api 展开成 `{id, short, long, zh}` 再送出来（`renderRating`），不是裸的
  // 字符串。声明成 string 的那段时间里，这两栏一直渲染出 `[object Object]` ——
  // 类型骗过了编译器，模板里的 `{{ row.rating }}` 照样跑。见 tools.ts。
  rating: RatingRef;
  access: number;
}

interface Member {
  username: string;
  name: string;
  rating: RatingRef;
}

const grantees = ref<Grantee[]>([]);
const loading = ref(true);
const error = ref("");
const notice = ref("");

/** 正在改哪一个人 —— 用来只禁用那一行的按钮，而不是整张表。 */
const busy = ref<string | null>(null);

const search = ref("");
const results = ref<Member[]>([]);
const searching = ref(false);

const columns = [
  { key: "username", label: t("columns.member") },
  { key: "rating", label: t("columns.rating") },
  { key: "access", label: t("columns.access") },
  { key: "actions", label: "" },
];

const levelOptions = [
  { value: String(ACCESS_READ), label: t("levels.read") },
  { value: String(ACCESS_WRITE), label: t("levels.write") },
  { value: String(ACCESS_RESTRICTED_READ), label: t("levels.restrictedRead") },
  {
    value: String(ACCESS_RESTRICTED_WRITE),
    label: t("levels.restrictedWrite"),
  },
];

/* 从高往低判，而且**必须从高往低**：这是一条累进的梯子，4 级的人 `>= ACCESS_WRITE`
 * 也成立，从低往高写会把每个人都标成「只读」。 */
function accessLabel(level: number): string {
  if (level >= ACCESS_RESTRICTED_WRITE) return t("levels.restrictedWrite");
  if (level >= ACCESS_RESTRICTED_READ) return t("levels.restrictedRead");
  if (level >= ACCESS_WRITE) return t("levels.write");
  if (level >= ACCESS_READ) return t("levels.read");
  return t("levels.none");
}

async function load() {
  loading.value = true;
  error.value = "";
  const result = await api<Grantee[]>("/api/v1/super/aip-access");
  loading.value = false;

  if (!result.ok) {
    error.value = result.message;
    return;
  }
  grantees.value = unwrapList<Grantee>(result.data, "grantees");
}

/**
 * 成员搜索。
 *
 * `/api/v1/super/members` 是 SUP/ADM 门槛，上限 20 条 —— 那是「够挑出正确的那个
 * 人」而不是「能用来遍历会员名单」的数字，服务端定的。
 */
async function runSearch() {
  const query = search.value.trim();
  if (query.length < 2) {
    results.value = [];
    return;
  }

  searching.value = true;
  try {
    const response = await apiFetch(
      `/api/v1/super/members?q=${encodeURIComponent(query)}`,
    );
    const payload = await response.json().catch(() => ({}));
    results.value = response.ok
      ? unwrapList<Member>(payload?.data, "members")
      : [];
  } catch {
    results.value = [];
  } finally {
    searching.value = false;
  }
}

/**
 * 授予或撤销。
 *
 * `access` 一定显式送出去，包括 0 —— can-api 那边 `access` 是个指针，缺字段是
 * 400 而不是「撤销」。`{}` 和 `{"access":0}` 在这件事上必须是两个意思。
 */
async function setAccess(username: string, level: number) {
  busy.value = username;
  error.value = "";
  notice.value = "";

  const result = await api<{ username: string; access: number }>(
    `/api/v1/super/aip-access/${encodeURIComponent(username)}`,
    { method: "PATCH", body: JSON.stringify({ access: level }) },
  );
  busy.value = null;

  if (!result.ok) {
    // 409 是「不能改自己」，can-api 给的那句话已经说清楚了，原样显示。
    error.value = result.message;
    return;
  }

  notice.value =
    level === ACCESS_NONE
      ? t("revoked", { id: username })
      : t("granted", { id: username, level: accessLabel(level) });

  search.value = "";
  results.value = [];
  await load();
}

/** 新授权时选的级别，按被授权人分开存 —— 一次可以挑好几个人。 */
const pending = ref<Record<string, string>>({});

function grant(member: Member) {
  const level = Number(pending.value[member.username] ?? ACCESS_READ);
  setAccess(member.username, level);
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

    <!-- 授予 -->
    <Card class="mt-6 p-5">
      <h2 class="text-sm font-semibold text-ink">{{ t("grant.title") }}</h2>
      <p class="mt-1 text-sm text-muted">{{ t("grant.help") }}</p>

      <div class="mt-4 max-w-sm">
        <Input
          v-model="search"
          type="search"
          :label="t('grant.search')"
          :placeholder="t('grant.searchPlaceholder')"
          autocomplete="off"
          @input="runSearch"
        />
      </div>

      <p v-if="searching" class="mt-3 text-sm text-muted">{{ t("loading") }}</p>

      <ul v-else-if="results.length" class="mt-4 space-y-2">
        <li
          v-for="m in results"
          :key="m.username"
          class="flex flex-wrap items-center gap-3 border-b border-subtle pb-2"
        >
          <span class="font-mono text-sm font-semibold text-ink">{{
            m.username
          }}</span>
          <span class="text-sm text-ink">{{ m.name }}</span>
          <span class="text-xs text-faint">{{ ratingShort(m.rating) }}</span>

          <div class="ml-auto flex items-center gap-2">
            <Select
              v-model="pending[m.username]"
              :options="levelOptions"
              :placeholder="t('levels.read')"
              class="w-32"
            />
            <Button
              size="sm"
              :disabled="busy === m.username"
              @click="grant(m)"
              >{{ t("grant.action") }}</Button
            >
          </div>
        </li>
      </ul>

      <p v-else-if="search.trim().length >= 2" class="mt-3 text-sm text-muted">
        {{ t("grant.noMatches") }}
      </p>
    </Card>

    <!-- 现有名单 -->
    <section class="mt-8">
      <h2
        class="mb-3 text-sm font-semibold uppercase tracking-wider text-muted"
      >
        {{ t("current.title") }}
      </h2>

      <Skeleton v-if="loading" variant="table" />

      <DataTable
        v-else
        :columns="columns"
        :rows="grantees"
        row-key="username"
        dense
      >
        <template #empty>
          <EmptyState
            icon="shieldCheck"
            :title="t('current.empty')"
            :description="t('current.emptyHelp')"
          />
        </template>

        <template #cell-username="{ row }">
          <span class="font-mono font-medium">{{ row.username }}</span>
          <span class="ml-2 text-muted">{{ row.name }}</span>
          <!-- 标出「这是你」。can-api 会拒绝改自己（409），所以这一行的按钮点下
               去必然失败 —— 提前说出来比让人点一次好。 -->
          <Badge v-if="row.username === props.sessionUserId" class="ml-2">{{
            t("current.you")
          }}</Badge>
        </template>

        <template #cell-rating="{ row }">
          <span class="text-muted">{{ ratingShort(row.rating) }}</span>
        </template>

        <template #cell-access="{ row }">
          <Badge
            :variant="
              row.access >= ACCESS_RESTRICTED_READ
                ? 'danger'
                : row.access >= ACCESS_WRITE
                  ? 'warning'
                  : 'info'
            "
          >
            {{ accessLabel(row.access) }}
          </Badge>
        </template>

        <!-- 从前这里是「升一级 / 降一级」两个按钮。四级之后那两个按钮没有意义了 ——
             「升级」只够得到 2，够不到受限的两级；而一个只能走一半的按钮比没有按钮更
             难懂。改成直接选目标级别，一步到位，也顺带让「降级」不再是个猜谜。 -->
        <template #cell-actions="{ row }">
          <div class="flex flex-wrap items-center justify-end gap-2">
            <Select
              :model-value="String(row.access)"
              :options="levelOptions"
              :disabled="busy === row.username"
              class="w-36"
              :aria-label="t('current.setLevel')"
              @update:model-value="
                (v: string) => setAccess(row.username, Number(v))
              "
            />
            <Button
              size="sm"
              variant="danger"
              :disabled="busy === row.username"
              @click="setAccess(row.username, ACCESS_NONE)"
              >{{ t("current.revoke") }}</Button
            >
          </div>
        </template>
      </DataTable>
    </section>
  </div>
</template>
