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
  type Workspace,
} from "@jianyuelab-org/can-ui";
import { api } from "@/lib/canApi";

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
}>();

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
  <AppShell v-bind="props" @signout="handleSignOut">
    <slot />
  </AppShell>
</template>
