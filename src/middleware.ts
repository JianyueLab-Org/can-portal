import { defineMiddleware } from "astro:middleware";
import { resolveSession } from "@/server/canApi";
import {
  RATING_ADMIN,
  RATING_INSTRUCTOR,
  RATING_SUP,
  signInUrl,
  webUrl,
} from "@/lib/config";

/**
 * 每个请求先问一次 can-api「你是谁」，答案放进 `Astro.locals.user`。
 *
 * **这个站整站都要登录，而且整站都要评级** —— 后半句是它和另外六个站的区别。
 *
 * 在 can-web 上，`/instr` 和 `/super` 只在 `PROTECTED_PREFIXES` 里，也就是**只
 * 判有没有登录**。于是一个普通飞行员打开 `/super/prizes` 会看见一个完整的奖品
 * 管理界面，只不过每一次请求都被 can-api 拒掉 —— 页面渲染出来了，表格是空的，
 * 保存按钮点下去弹一句 403。那不是安全问题（can-api 挡住了），是一个会让人以为
 * 系统坏了的界面。
 *
 * 这个站整个就是教员和管理的工作台，所以门槛提到进门这一层：不够格的人在**看
 * 见任何东西之前**就被送回主站，而不是看见一个空壳。
 *
 * **这仍然是便利，不是边界。** 真正的判断在 can-api 每条路由自己的守卫上，还有
 * 每个 handler 内部按 division 的那一层。把下面的数字改小不会放开任何数据，只
 * 会让人看见一组点下去必然 403 的页面 —— 也就是退回 can-web 当初的样子。
 *
 * 重定向去的是 **can-web**：这个站自己没有登录页，也不该有。会话由 can-api 在
 * 父域上签发，主站上登录过的成员到这里本来就带着 cookie。`signInUrl()` 把当前地
 * 址当 callbackUrl 带过去，登录完直接回到他本来要去的那一页。
 */

/**
 * 不问会话、也不重定向的两条路径。
 *
 * - `/api/` 是本站的反代，它自己有白名单，而且它的调用方要的是状态码不是
 *   302 —— 把一个 fetch 重定向到登录页，岛屿拿到的会是一段 HTML，然后它会试
 *   着把 `<!doctype html>` 当 JSON 解析。
 * - `/healthz` 是探活，理由写在那个文件里：它必须能在 can-api 挂掉时照样回
 *   200，否则上游一抖，kubelet 就会把这边的 Pod 一起滚掉。
 */
function isUnguarded(pathname: string): boolean {
  return pathname.startsWith("/api/") || pathname === "/healthz";
}

/**
 * 一条路径要几级。
 *
 * 和侧栏（`src/lib/nav.ts`）用的是同一组常量，这一点是刻意的：两处对同一个页面
 * 给出不同答案，会做出一个「看得见但进不去」或者「进得去但找不到入口」的菜单，
 * 而那种不一致没有任何测试会发现。
 *
 * **`/super/promotions` 是 12 而不是 11**，和 can-web 的 `StaffShell` 逐字相
 * 同：晋升审批是 ADM 的事，SUP 提不了也批不了。剩下三个 `/super/*` 是 11 ——
 * 发积分的是 SUP，所以配奖品的也是 SUP。
 *
 * 顺序上先长后短：`/super/promotions` 必须排在 `/super` 前面，否则它会先被
 * `/super` 那条以 11 匹配上，ADM 那道门就形同虚设。这是这张表唯一的陷阱。
 */
const FLOORS: Array<{ prefix: string; rating: number }> = [
  { prefix: "/super/promotions", rating: RATING_ADMIN },
  // 资料库授权也是 ADM。**它必须排在 `/super` 前面**，否则会被那条以 11 匹配
  // 上，于是一个 SUP 能打开一张发放数据库权限的界面 —— 请求会被 can-api 的
  // `WithAdmin` 拒掉，但那时他已经看见了完整的持有人名单。
  { prefix: "/super/aip-access", rating: RATING_ADMIN },
  // 开发者授权同理，同样必须排在 `/super` 前面。这一页泄漏出去的东西比资料库那
  // 一页更具体：它列的是谁在这个网络上注册了应用、各注册了几个。
  { prefix: "/super/developers", rating: RATING_ADMIN },
  { prefix: "/super", rating: RATING_SUP },
  { prefix: "/instr", rating: RATING_INSTRUCTOR },
];

/**
 * 进这个站的最低门槛。
 *
 * 首页、404 和任何将来加的公共页面都按它判 —— 一个连教员都不是的人在这个域名
 * 上没有任何一页看得到，所以门开在最外面而不是每一页各自判。
 */
const SITE_FLOOR = RATING_INSTRUCTOR;

function requiredRating(pathname: string): number {
  return (
    FLOORS.find((f) => pathname.startsWith(f.prefix))?.rating ?? SITE_FLOOR
  );
}

export const onRequest = defineMiddleware(async (context, next) => {
  const { pathname } = context.url;

  if (isUnguarded(pathname)) {
    context.locals.user = null;
    return withSecurityHeaders(await next());
  }

  const user = await resolveSession(context);
  context.locals.user = user;

  if (!user) {
    return withSecurityHeaders(context.redirect(signInUrl(context.url)));
  }

  // 够格登录但不够格进这个站的成员，送回主站的飞行员面板 —— 那是他们本来就有
  // 的地方。**不是** 403 页面：他们没有做错任何事，多半只是点了一条过期的书签
  // 或者别人转发的链接。
  if (user.rating < requiredRating(pathname)) {
    return withSecurityHeaders(context.redirect(webUrl("/pilots/")));
  }

  return withSecurityHeaders(await next());
});

/**
 * 和几个兄弟站一致的安全头。
 *
 * 用函数包一层而不是在 `next()` 之后就地设置：上面那两个重定向是提前返回的，内
 * 联写法会让它们成为仅有的什么头都没有的响应 —— can-web 正是被这一条咬过。
 */
function withSecurityHeaders(response: Response): Response {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "origin-when-cross-origin");
  return response;
}
