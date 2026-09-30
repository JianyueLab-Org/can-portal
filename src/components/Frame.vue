<script setup lang="ts">
/**
 * 本站的网络外壳：can-ui 的 `CanFrame`，`layout="tool"`。
 *
 * 退出登录由 can-ui 的 AccountMenu 发：同源 `POST /api/v1/auth/signout`，反代把
 * can-api 的 Set-Cookie 原样带回。之后去 can-web 的 `/`（`afterSignOut="web"`）。
 *
 * 账户菜单多一项「隐藏 NAIP」（`profileMenu` 插槽），aipAccess ≥ 3 才出。真相在
 * cookie 里（`src/lib/naip.ts`），这个 ref 是它的影子；挂载后才读，服务端没有
 * `document`。
 *
 * `origins`：构建期的 `PUBLIC_CAN_<SITE>_ORIGIN`（`originsFromEnv`），叠上服务端传
 * 进来的运行期覆盖（`SITE_ORIGINS`，`src/lib/nav.ts`）。
 */
import { computed, onMounted, ref } from "vue";
import {
  CanFrame,
  originsFromEnv,
  type FrameUser,
  type NavItem,
  type NavSecondary,
  type SiteOrigins,
  type Workspace,
} from "@jianyuelab-org/can-ui";
import { createTranslator } from "@/lib/i18n";
import { AIP_RESTRICTED_CALL, readHideNaip, writeHideNaip } from "@/lib/naip";

const props = defineProps<{
  locale: string;
  pathname: string;
  nav: NavItem[];
  secondary?: NavSecondary;
  workspaces?: Workspace[];
  user: FrameUser | null;
  /** 成员的 aipAccess。只决定「隐藏 NAIP」那一项出不出。 */
  aipAccess: number;
  messages: Record<string, unknown>;
  origins?: SiteOrigins;
}>();

const origins: SiteOrigins = {
  ...originsFromEnv(import.meta.env),
  ...props.origins,
};

const t = createTranslator(props.messages);

const canHideNaip = computed(() => props.aipAccess >= AIP_RESTRICTED_CALL);
const hideNaip = ref(true);
onMounted(() => {
  hideNaip.value = readHideNaip();
});
function toggleHideNaip() {
  hideNaip.value = !hideNaip.value;
  writeHideNaip(hideNaip.value);
}
</script>

<template>
  <CanFrame
    layout="tool"
    current="portal"
    :locale="locale"
    :pathname="pathname"
    :nav="nav"
    :secondary="secondary"
    :workspaces="workspaces"
    active-workspace="controllers"
    :user="user"
    notifications
    :messages="messages"
    :origins="origins"
    after-sign-out="web"
  >
    <template v-if="canHideNaip" #profileMenu>
      <button
        type="button"
        role="menuitemcheckbox"
        :aria-checked="hideNaip"
        class="focus-ring tap-row flex w-full items-start gap-2.5 rounded-control px-2.5 py-2 text-left text-sm text-muted transition-colors hover:bg-surface-raised hover:text-ink"
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
  </CanFrame>
</template>
