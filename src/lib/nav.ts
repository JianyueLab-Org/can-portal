/**
 * 侧栏是**一份**数据，不是每个页面各自拼的一串链接。
 *
 * 它在 can-web 上叫 `StaffShell.vue`（更早叫 `ControllersShell.vue`），是一个
 * Vue 组件；搬过来之后拆成了「数据在这里、渲染交给 can-ui 的 `CanFrame`」两
 * 半，原因和 can-controller 的同名文件一样但很硬：
 *
 * 跨站地址只有主站一个：`SITE_ORIGINS` 把 `CAN_WEB_ORIGIN` 交给 can-ui。
 *
 * 名字是 i18n 的**键**，不是文案：翻译发生在 `buildNavigation()` 里。
 *
 * ## 两个前缀，一个侧栏 —— 这是这个站存在的形状
 *
 * 侧栏三组：教员（8）、监理（11）、ADM（12）。
 *
 * 这些页面分在 `/instr/*` 和 `/super/*` 下，而侧栏只有一个。这两句都要成立：
 *
 * 前缀分开，是因为 `super` 读作「监理」（SUP，等级 11），而花名册、晋升、
 * SweatBox 是**教员**（等级 8）的活 —— 一个 I1 教员点开 `/super/roster` 会以为
 * 自己走错了地方。搬到这个域名之后前缀**留着**，没有像 can-controller 那样拉
 * 平：can-controller 拉平是因为它整站是一件事，而这里前缀编码的是一道真实的评
 * 级边界，而且拉平会让 `/promote`（谁可以被晋升）和 `/promotions`（晋升审批队
 * 列）变成一字之差的两个不同页面。
 *
 * 侧栏不分开，是因为一个既是教员又是 ADM 的人在两半之间要能走过去。分成两个
 * 侧栏之后，他在 `/instr/roster` 上就没有通往 `/super/promotions` 的入口了，只
 * 能背地址。导航按等级出现，教员、监理、ADM 三组各自按门槛显隐。
 */
import type { Translator } from "@/lib/i18n";
import type { IconName, NavItem, SiteOrigins } from "@jianyuelab-org/can-ui";
import {
  RATING_ADMIN,
  RATING_INSTRUCTOR,
  RATING_SUP,
} from "@jianyuelab-org/can-ui/sites";
import { CAN_WEB_ORIGIN } from "@/lib/config";

/**
 * 传给 can-ui 的 dev/staging 覆盖。这个仓库的 `config.ts` 只读得到
 * `CAN_WEB_ORIGIN`，所以只覆盖这一个：本地和 staging 上指向主站的链接会落在本
 * 环境自己的主站，而不是永远指向线上；生产环境这个变量本来就是线上地址，行为
 * 不变。
 */
export const SITE_ORIGINS: SiteOrigins = {
  web: CAN_WEB_ORIGIN,
};

/** 教员那一组 —— 等级 8 起。三条都是本站的页面。 */
const INSTRUCTOR: Array<{ key: string; href: string; icon: IconName }> = [
  { key: "instructors.items.roster", href: "/instr/roster", icon: "users" },
  {
    key: "instructors.items.promotion",
    href: "/instr/promote",
    icon: "academicCap",
  },
  {
    key: "instructors.items.sweatbox",
    href: "/instr/sweatbox",
    icon: "computerDesktop",
  },
];

/**
 * 监理那一组 —— 等级 11 起，八条。
 *
 * 活动管理是 SUP/ADM（发积分的就是他们），所以配奖品的也是 SUP；处理结果公示
 * 同理。
 */
const SUP: Array<{ key: string; href: string; icon: IconName }> = [
  { key: "activitiesManage", href: "/super/activities", icon: "calendarDays" },
  { key: "prizesManage", href: "/super/prizes", icon: "gift" },
  // 抽奖。和奖品同一档（11）：奖品是 SUP 配的，拿奖品开抽奖的也是 SUP。
  { key: "lotteryManage", href: "/super/lottery", icon: "sparkles" },
  // 积分手动调整。和奖品、抽奖同一档（11）：can-api 的路由是 `WithSup`。
  { key: "pointsManage", href: "/super/points", icon: "adjustments" },
  { key: "feedbackManage", href: "/super/feedback", icon: "megaphone" },
  // 服务器目录。和上面几条同一档（11）：搬一台 FSD 或语音服务器是运维决定，而跑
  // 活动的那一层就是做运维的那一层。
  { key: "servers", href: "/super/servers", icon: "signal" },
  // 晋升审批。SUP 起就能批（can-api 的决定路由是 `WithSup`）；教员提，SUP/ADM 批。
  {
    key: "admin.items.promote",
    href: "/super/promotions",
    icon: "checkCircle",
  },
  // 虚拟航空平台管理：开航审批、处置航空公司、经济参数。can-va-api 的 staff
  // 路由按 rating ≥ 11 判，和这一组同档。
  {
    key: "airlinesManage",
    href: "/super/airlines",
    icon: "buildingOffice",
  },
];

/** ADM 那三条 —— 等级 12。都是「决定别人能做什么」，或看他们做过什么。 */
const ADMIN: Array<{ key: string; href: string; icon: IconName }> = [
  // 航行资料库（can-db）的访问授权。
  { key: "admin.items.aipAccess", href: "/super/aip-access", icon: "key" },
  // 开发者授权（can-dev）：谁能做出一张挂着本网络名字、向其他成员要授权的同意页。
  {
    key: "admin.items.developers",
    href: "/super/developers",
    icon: "commandLine",
  },
  // 管理操作时间线。读 can-api 的 `GET /api/v1/super/audit`（WithAdmin）。
  { key: "admin.items.audit", href: "/super/audit", icon: "clipboardCheck" },
];

/**
 * 把上面的键解析成当前语言的文案。在 Astro 侧调用，结果作为 props 进岛屿。
 *
 * `t` 是 `frame` 命名空间上的翻译器；`rating` 来自会话（`Astro.locals.user`），
 * can-api 每个请求都解一次，所以一次晋升在下一次翻页时就生效，而不是等到下次
 * 登录。
 *
 * **rating 缺失时什么都不显示**，而不是显示教员那一组 —— 一个读不出等级的会话
 * 应该看到更少的东西而不是更多。中间件本来就不会让这样的请求走到这里（见
 * `src/middleware.ts`），这里的 `typeof` 判断是第二道：`undefined >= 8` 本来就
 * 是 `false`，但写成 `rating! >= 8` 等于把这件事交给运气。
 *
 * **ADM 那条是 `===` 而不是 `>=`，和 can-web 逐字相同。** 今天两种写法结果一
 * 样，因为 12 就是最高的一级；哪天 `ratingTrans` 上面再加一级，`===` 会让那一
 * 级看不到晋升审批。改它之前先去改 can-web —— 两边对同一个菜单给出不同答案，
 * 比这个菜单本身错了更难查。
 */
export function buildNavigation(t: Translator, rating?: number): NavItem[] {
  if (typeof rating !== "number") return [];

  const children = (entries: typeof SUP) =>
    entries.map((entry) => ({
      name: t(entry.key),
      href: entry.href,
      icon: entry.icon,
    }));

  const items: NavItem[] = [];

  if (rating >= RATING_INSTRUCTOR) {
    items.push({
      name: t("instructors.title"),
      icon: "academicCap",
      children: children(INSTRUCTOR),
    });
  }

  if (rating >= RATING_SUP) {
    items.push({
      name: t("sup.title"),
      icon: "shieldCheck",
      children: children(SUP),
    });
  }

  if (rating === RATING_ADMIN) {
    items.push({
      name: t("admin.title"),
      icon: "cog6Tooth",
      children: children(ADMIN),
    });
  }

  return items;
}

/**
 * 首页去哪：成员看得见的第一页。和侧栏读同一份 `buildNavigation`。
 * 没有可见的页面时是 null。
 */
export function homePath(rating?: number): string | null {
  for (const item of buildNavigation((key) => key, rating)) {
    if (item.href) return item.href;
    const child = item.children?.find((entry) => entry.href);
    if (child) return child.href;
  }
  return null;
}
