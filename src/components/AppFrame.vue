<script setup lang="ts">
/**
 * 站点侧的外框：把 can-ui 的 `AppShell` 包一层，只为了接住 `@signout`。
 *
 * can-ui 的 AppShell 不再自己调 can-api —— 一个知道网络鉴权端点在哪的设计系统
 * 不是设计系统。退出登录现在是一个事件，而「发哪个请求」和「之后把人送去哪」
 * 本来就只有站点知道，所以那一行留在这里。
 *
 * 这一层还有个绕不开的理由：Astro 的岛屿没法从 `.astro` 模板上挂 Vue 的事件
 * 监听器，`@signout` 只能写在一个 Vue 组件里。所以 AppLayout.astro 渲染的是
 * 这个组件，不是 AppShell 本身。
 */
import {
  AppShell,
  type NavItem,
  type NavSecondary,
  type SiteOrigins,
  type Workspace,
} from "@jianyuelab-org/can-ui";
import { computed, onMounted, ref } from "vue";
import { api } from "@/lib/canApi";
import { createTranslator } from "@/lib/i18n";
import { AIP_RESTRICTED_CALL, readHideNaip, writeHideNaip } from "@/lib/naip";

const props = defineProps<{
  navigation: NavItem[];
  pathname: string;
  messages?: Record<string, unknown>;
  locale?: string;
  secondary?: NavSecondary;
  workspaces?: Workspace[];
  activeWorkspace?: string;
  userName?: string;
  userId?: string;
  /** 成员的 aipAccess。只决定「隐藏 NAIP」那一项出不出，不是权限判断。 */
  aipAccess?: number;
  /** AppShell 自己的页脚（SiteFooter compact）也要照这份地址走，和分区切换器同一份 SITE_ORIGINS。 */
  origins?: SiteOrigins;
}>();

const t = createTranslator(props.messages ?? {});

/** AppShell 不认识 `aipAccess`，别让它落成 DOM 上的一个属性。 */
const shellProps = computed(() => {
  const { aipAccess: _aipAccess, ...rest } = props;
  return rest;
});

/**
 * 「隐藏 NAIP」放在账户菜单里：它是这个成员在整个站上的偏好，不属于某一页。
 * 3 级以下不显示 —— 对他们 can-db 那边恒为空转，摆出来只会让人以为自己错过了什么。
 * 真相在 cookie 里（`src/lib/naip.ts`），这个 ref 只是它在界面上的影子；挂载后才读，
 * 因为服务端渲染时没有 `document`。
 */
const canHideNaip = computed(
  () => (props.aipAccess ?? 0) >= AIP_RESTRICTED_CALL,
);
const hideNaip = ref(true);
onMounted(() => {
  hideNaip.value = readHideNaip();
});
function toggleHideNaip() {
  hideNaip.value = !hideNaip.value;
  writeHideNaip(hideNaip.value);
}

function handleSignOut() {
  // 清 cookie 是 can-api 的事 —— 属性是它定的，一个对不上的 Set-Cookie 只会让
  // 浏览器同时留着两份。跳转是我们的事，而且请求成不成都要跳：一个按了退出的人
  // 不该因为请求失败就留在一个还显示着已登录的页面上。
  api("/api/v1/auth/signout", { method: "POST" }).finally(() => {
    window.location.assign("/");
  });
}
</script>

<template>
  <AppShell v-bind="shellProps" @signout="handleSignOut">
    <template v-if="canHideNaip" #profileMenu>
      <button
        type="button"
        role="menuitemcheckbox"
        :aria-checked="hideNaip"
        class="tap-row flex w-full items-start gap-2.5 px-4 py-2.5 text-left text-sm text-muted transition-colors hover:bg-surface-sunken hover:text-ink"
        @click="toggleHideNaip"
      >
        <input
          type="checkbox"
          :checked="hideNaip"
          tabindex="-1"
          aria-hidden="true"
          class="pointer-events-none mt-0.5"
        />
        <span>
          <span class="block font-medium text-ink">{{
            t("unrestricted")
          }}</span>
          <span class="mt-1 block text-xs text-faint">{{
            t("unrestrictedHint")
          }}</span>
        </span>
      </button>
    </template>
    <slot />
  </AppShell>
</template>
