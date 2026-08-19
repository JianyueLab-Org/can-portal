/**
 * 侧栏是**一份**数据，不是每个页面各自拼的一串链接。
 *
 * 它在 can-web 上叫 `StaffShell.vue`（更早叫 `ControllersShell.vue`），是一个
 * Vue 组件；搬过来之后拆成了「数据在这里、渲染交给 can-ui 的 `AppShell`」两
 * 半，原因和 can-controller 的同名文件一样但很硬：
 *
 * **这个站的一部分链接是跨站的绝对地址**，而那些地址来自环境变量。
 * `src/lib/config.ts` 在模块顶层读 `process.env`，任何被岛屿 import 的模块这么
 * 做都会在浏览器里炸成 `process is not defined`。所以链接在 Astro 侧（服务端）
 * 拼好，作为 props 进岛屿。
 *
 * 名字是 i18n 的**键**，不是文案：翻译发生在 `buildNavigation()` 里，键名一个
 * 字都没改，和 can-web 的 `frame` 命名空间对得上，所以四本词典是从那边整段切
 * 过来的而不是重写的。
 *
 * ## 两个前缀，一个侧栏 —— 这是这个站存在的形状
 *
 * 七个页面分在 `/instr/*` 和 `/super/*` 下，而侧栏只有一个。这两句都要成立：
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
 * 能背地址。导航按等级出现，本来就已经把两拨人分开了。
 */
import type { Translator } from "@/lib/i18n";
import type { NavItem, NavSecondary, Workspace } from "@jianyuelab-org/can-ui";
import { visibleSites } from "@jianyuelab-org/can-ui";
import {
  RATING_ADMIN,
  RATING_INSTRUCTOR,
  RATING_SUP,
  webUrl,
} from "@/lib/config";

/**
 * 教员那一组 —— 等级 8 起。三条都是本站的页面。
 *
 * 折叠成一组而不是三条平铺：一个 SUP 同时看得见这一组和下面那几条，平铺会让侧
 * 栏变成七条没有层次的链接，而它们本来就分属两件事。
 */
const INSTRUCTOR: Array<{ key: string; href: string }> = [
  { key: "instructors.items.roster", href: "/instr/roster" },
  { key: "instructors.items.promotion", href: "/instr/promote" },
  { key: "instructors.items.sweatbox", href: "/instr/sweatbox" },
];

/**
 * SUP 那三条 —— 等级 11 起，平铺而不折叠。
 *
 * 活动管理是 SUP/ADM（发积分的就是他们），所以配奖品的也是 SUP；处理结果公示
 * 同理。这三条在 can-web 上就是平铺的，照搬。
 */
const SUP: Array<{ key: string; href: string; icon: string }> = [
  { key: "activitiesManage", href: "/super/activities", icon: "calendarDays" },
  { key: "prizesManage", href: "/super/prizes", icon: "gift" },
  { key: "feedbackManage", href: "/super/feedback", icon: "megaphone" },
  // 服务器目录。和上面三条同一档（11）：搬一台 FSD 或语音服务器是运维决定，而跑
  // 活动的那一层就是做运维的那一层。
  { key: "servers", href: "/super/servers", icon: "signal" },
];

/**
 * ADM 那一条 —— 等级 12。
 *
 * 晋升审批和「晋升」分开，是因为它们是同一条流程的两端：教员提，ADM 批。合成
 * 一组会让一个只有 I1 的人以为自己按得动那个按钮。
 */
const ADMIN: Array<{ key: string; href: string }> = [
  { key: "admin.items.promote", href: "/super/promotions" },
  // 航行资料库（can-db）的访问授权。和晋升审批同一组，因为它们是 ADM 仅有的两件
  // 事 —— 都是「决定别人能做什么」，而不是网络的日常运营。
  { key: "admin.items.aipAccess", href: "/super/aip-access" },
  // 开发者授权（can-dev）。和上面两条同一组，同一条理由：都是「决定别人能做什
  // 么」。这一条决定的是谁能做出一张挂着本网络名字、向其他成员要授权的同意页。
  { key: "admin.items.developers", href: "/super/developers" },
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

  const items: NavItem[] = [];

  if (rating >= RATING_INSTRUCTOR) {
    items.push({
      name: t("instructors.title"),
      icon: "shieldCheck",
      children: INSTRUCTOR.map((entry) => ({
        name: t(entry.key),
        href: entry.href,
      })),
    });
  }

  if (rating >= RATING_SUP) {
    items.push(
      ...SUP.map((entry) => ({
        name: t(entry.key),
        href: entry.href,
        icon: entry.icon,
      })),
    );
  }

  if (rating === RATING_ADMIN) {
    items.push({
      name: t("admin.title"),
      icon: "shieldCheck",
      children: ADMIN.map((entry) => ({
        name: t(entry.key),
        href: entry.href,
      })),
    });
  }

  return items;
}

/**
 * 钉在轨底的常用链接，全部跨站。
 *
 * 每一条都是「在这个工作台上做完事之后，要去核对的那一面」：公开花名册是花名册
 * 页面写完之后成员看到的样子，活动、积分兑换、处理结果公示同理 —— 管理端在这
 * 里，成员端在主站，管理员两边都要看。
 *
 * 它们是钉住的而不是一个「快速访问」折叠菜单 —— can-web 上正是后者，那让最常用
 * 的几条多了两次点击。
 */
export function buildSecondary(
  t: Translator,
  opts: { locale: string; rating?: number; signedIn: boolean },
): NavSecondary {
  return {
    label: t("controllers.quickAccess.title"),
    items: [
      { name: t("atcRoster"), href: webUrl("/roster"), icon: "users" },
      {
        name: t("activities"),
        href: webUrl("/activities"),
        icon: "calendarDays",
      },
      { name: t("rewards"), href: webUrl("/rewards"), icon: "gift" },
      { name: t("feedback"), href: webUrl("/feedback"), icon: "megaphone" },
      // 网络上的其它站。从前这里只硬编码着「会员文档」一条 —— 于是一个教员从门
      // 户去不了雷达、EFB、考试中心，而全网另外三个仓库各自维护着一份不一样的
      // 清单。现在这份来自 can-ui，九个站一份，门户和资料库按评级决定露不露。
      ...visibleSites({
        locale: opts.locale,
        current: "portal",
        rating: opts.rating,
        signedIn: opts.signedIn,
        excludeCurrent: true,
      }).map((site) => ({
        name: site.name,
        href: site.href,
        icon: site.icon,
      })),
    ],
  };
}

/**
 * 顶上的分区切换器。
 *
 * 它不是这个站的内容，是网络外壳的一部分 —— 成员从这个域名走出去的唯一一条
 * 路。删掉它，离开这个站就只剩下浏览器的地址栏。
 *
 * **高亮的是「管制员」而不是新开一格。** 和 can-web 的 `StaffShell` 逐字相同的
 * 理由：这些页面是从管制员中心的侧栏点进来的，教员做完手上的事要回去的也是那
 * 里。给教员与管理开第四格，等于告诉每个成员这里有一个他们进不去的分区。
 */
export function buildWorkspaces(t: Translator): Workspace[] {
  return [
    {
      key: "pilots",
      name: t("workspace.pilots"),
      href: webUrl("/pilots/"),
      icon: "paperAirplane",
    },
    {
      key: "controllers",
      name: t("workspace.controllers"),
      href: "https://controller.ceruleanavi.net",
      icon: "signal",
    },
    {
      key: "exams",
      name: t("workspace.exams"),
      href: "https://exam.ceruleanavi.net",
      icon: "academicCap",
    },
  ];
}
