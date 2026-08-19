<script setup lang="ts">
/**
 * 开发者授权。**只有 ADM。**
 *
 * 这一页管的是 can-api `user.developer` 那一列 —— 谁能打开
 * platform.ceruleanavi.net（can-dev），也就是谁能注册 OAuth 应用。
 *
 * ## 为什么这是一张独立的清单，而不是花名册上的一栏
 *
 * 和隔壁资料库权限（`/super/aip-access`）同一条理由，而且更彻底：写客户端和管制
 * 资历完全无关。写这个网络第三方工具的那个人很可能是 OBS，而一个 ADM 完全可能一
 * 行代码都不写。挂在花名册上会暗示「升一级顺手发一份」，而那正是 can-api 的
 * schema 注释里特意写下不要做的事。
 *
 * ## 「有应用、没权限」那一块是干什么的
 *
 * 这一列是加在一个**已经有人注册过应用**的网络上的，`db push` 会把所有人置为
 * false。schema 里带了一句回填 SQL，而这一块是**检查那句话有没有跑**的唯一办法：
 * 它列出所有拥有应用却不再持有权限的人。
 *
 * 它不是一个错误。撤销一个仍然拥有应用的人的权限是完全正当的操作 —— 不正当的是
 * 在不知道的情况下做这件事。所以它是一块常驻的清单，而不是一次性的迁移脚本输出。
 *
 * ## 三件事这个岛屿刻意不做
 *
 * **不判自己够不够格。** 页面能不能开由中间件按 12 级决定，请求成不成由 can-api
 * 的 `WithAdmin` 决定。在这里再抄一份只会多一处可能不一致的判断。
 *
 * **不拦「改自己」。** 隔壁资料库那一页会撞上 409（撤销了自己就没人能撤回），这
 * 一条**没有**那个限制，而且不该有：这条路由是按 rating 把门的，ADM 把自己关掉还
 * 能自己打开。在前端补一个上游没有的限制，等于凭空造一条规则。
 *
 * **不停用被撤销者的应用。** 撤销只是「以后不能再注册」；那些应用的用户是没做错
 * 事的第三方，把他们全部登出是另一个更响的决定。停用某个应用走的是
 * `oauthClient.disabled`，不是这一页。
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

interface Developer {
  username: string;
  name: string;
  /** can-api 展开后的 `{id, short, long, zh}`，不是裸的数字。见 tools.ts。 */
  rating: RatingRef;
  /** 名下的 OAuth 应用数。撤销之前该看的就是这个数字。 */
  apps: number;
}

interface Member {
  username: string;
  name: string;
  rating: RatingRef;
}

const developers = ref<Developer[]>([]);
/** 有应用但已经不持有权限的人 —— 回填有没有做对，看这一块。 */
const orphaned = ref<Developer[]>([]);
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
  { key: "apps", label: t("columns.apps") },
  { key: "actions", label: "" },
];

async function load() {
  loading.value = true;
  error.value = "";
  const result = await api<unknown>("/api/v1/super/developers");
  loading.value = false;

  if (!result.ok) {
    error.value = result.message;
    return;
  }
  developers.value = unwrapList<Developer>(result.data, "developers");
  orphaned.value = unwrapList<Developer>(result.data, "orphaned");
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
 * `developer` 一定显式送出去，包括 false —— can-api 那边它是个指针，缺字段是 400
 * 而不是「撤销」。`{}` 和 `{"developer":false}` 在这件事上必须是两个意思。
 */
async function setDeveloper(username: string, developer: boolean) {
  busy.value = username;
  error.value = "";
  notice.value = "";

  const result = await api<{ username: string; developer: boolean }>(
    `/api/v1/super/developers/${encodeURIComponent(username)}`,
    { method: "PATCH", body: JSON.stringify({ developer }) },
  );
  busy.value = null;

  if (!result.ok) {
    error.value = result.message;
    return;
  }

  notice.value = developer
    ? t("granted", { id: username })
    : t("revoked", { id: username });

  search.value = "";
  results.value = [];
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

          <Button
            size="sm"
            class="ml-auto"
            :disabled="busy === m.username"
            @click="setDeveloper(m.username, true)"
            >{{ t("grant.action") }}</Button
          >
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
        :rows="developers"
        row-key="username"
        dense
      >
        <template #empty>
          <EmptyState
            icon="commandLine"
            :title="t('current.empty')"
            :description="t('current.emptyHelp')"
          />
        </template>

        <template #cell-username="{ row }">
          <span class="font-mono font-medium">{{ row.username }}</span>
          <span class="ml-2 text-muted">{{ row.name }}</span>
          <Badge v-if="row.username === props.sessionUserId" class="ml-2">{{
            t("current.you")
          }}</Badge>
        </template>

        <template #cell-rating="{ row }">
          <span class="text-muted">{{ ratingShort(row.rating) }}</span>
        </template>

        <!-- 应用数。撤销之前唯一该看的数字：0 就是一个名字，4 就是四张挂着本网络
             名字的授权页。 -->
        <template #cell-apps="{ row }">
          <Badge :variant="row.apps > 0 ? 'info' : 'neutral'">{{
            t("current.apps", { count: row.apps })
          }}</Badge>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex justify-end">
            <Button
              size="sm"
              variant="danger"
              :disabled="busy === row.username"
              @click="setDeveloper(row.username, false)"
              >{{ t("current.revoke") }}</Button
            >
          </div>
        </template>
      </DataTable>
    </section>

    <!-- 有应用、没权限。空的时候整块不画：它是一个异常清单，不是一张常规报表。 -->
    <section v-if="!loading && orphaned.length" class="mt-10">
      <h2
        class="mb-1 text-sm font-semibold uppercase tracking-wider text-muted"
      >
        {{ t("orphaned.title") }}
      </h2>
      <p class="mb-3 max-w-3xl text-sm text-muted">{{ t("orphaned.help") }}</p>

      <DataTable :columns="columns" :rows="orphaned" row-key="username" dense>
        <template #cell-username="{ row }">
          <span class="font-mono font-medium">{{ row.username }}</span>
          <span class="ml-2 text-muted">{{ row.name }}</span>
        </template>

        <template #cell-rating="{ row }">
          <span class="text-muted">{{ ratingShort(row.rating) }}</span>
        </template>

        <template #cell-apps="{ row }">
          <Badge variant="warning">{{
            t("current.apps", { count: row.apps })
          }}</Badge>
        </template>

        <template #cell-actions="{ row }">
          <div class="flex justify-end">
            <Button
              size="sm"
              :disabled="busy === row.username"
              @click="setDeveloper(row.username, true)"
              >{{ t("orphaned.restore") }}</Button
            >
          </div>
        </template>
      </DataTable>
    </section>
  </div>
</template>
