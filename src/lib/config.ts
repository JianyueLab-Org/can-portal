/**
 * 这个站要知道的三个地址，集中在一处。
 *
 * 和 can-controller / can-efb 的同名文件几乎一样，是有意抄的而不是抽包共用：
 * 几个卫星站点各自部署、各自有自己的默认值，把它们绑成一个包意味着改 EFB 的默
 * 认端口会顺手改掉这里的。
 *
 * can-dev 当年把 can-api 的地址和同意页的地址塞进同一个 `CAN_ISSUER`，结果是
 * 改其中一个的人以为自己改完了。这里从一开始就分开命名。
 */

function clean(value: string | undefined): string {
  return (value || "").replace(/\/+$/, "");
}

/**
 * can-api 的 origin。数据全部来自它。
 *
 * `PUBLIC_` 前缀让 Astro 把它内联进客户端包 —— 它是主机名，不是密钥。但**浏
 * 览器其实用不到它**：岛屿走本站的同源反代（见
 * `src/pages/api/v1/[...path].ts`），那样就不需要 can-api 那边为
 * portal.ceruleanavi.net 开一条 CORS。真正用它的是 SSR 和那个反代。
 *
 * 兜底成生产地址而不是空串：can-web 的 `src/server/canApi.ts` 记着这一条的代
 * 价 —— 空串在浏览器里能解析成同源相对地址，在服务端却是 `ERR_INVALID_URL`，
 * 而且每一个请求都失败，日志看起来像是 can-api 挂了，其实只是没人设过这个
 * 变量。
 */
export const CAN_API_ORIGIN =
  clean(process.env.CAN_API_ORIGIN) ||
  clean(import.meta.env.PUBLIC_CAN_API_ORIGIN) ||
  "https://api.ceruleanavi.net";

/**
 * can-web 的 origin。指登录页，以及那些**没有**跟着搬过来的页面。
 *
 * 这个站自己没有登录页，也不该有：会话由 can-api 签在父域上，主站上登录过的成
 * 员到这里本来就带着 cookie。
 *
 * 侧栏底部那一排跨站链接也走它 —— 花名册（公开那一份）、活动、积分兑换、处理
 * 结果公示的**成员视角**都还在主站。这个站搬走的是那几件事的**管理端**，不是
 * 它们本身。
 */
export const CAN_WEB_ORIGIN =
  clean(process.env.CAN_WEB_ORIGIN) ||
  clean(import.meta.env.PUBLIC_CAN_WEB_ORIGIN) ||
  "https://ceruleanavi.net";

/**
 * can-db 的 API，SweatBox 参考数据从它来。
 *
 * **集群内地址，不是公网主机名。** can-db 没有 Ingress —— 它服务的是有许可限制的
 * 航行资料，只在集群内监听。所以兜底值是 localhost 而不是某个 https 地址：写一个
 * 公网地址当兜底，会让「忘了配」悄悄变成「打到了别的东西上」。
 *
 * 这是**服务端专用**的值，只有 `src/server/sweatboxData.ts` 读它。岛屿仍然打本站
 * 的 `/instr/sweatbox/*`，一个字都没改。
 */
export const CAN_DB_ORIGIN =
  clean(process.env.CAN_DB_ORIGIN) || "http://127.0.0.1:8080";

/**
 * 本站自己的 origin，写操作的 Origin 头要和它比对。
 *
 * 必须是**显式配置**的值，不能从 `Host` 头推：这个站跑在 TLS 终止的反代后面，
 * 推出来的是 `http://…`，浏览器发的是 `https://…`，永远对不上。
 * `astro.config.mjs` 里关掉 `checkOrigin` 正是这个原因，而这里是补上的那一半。
 */
export function origin(): string {
  return (
    clean(process.env.PUBLIC_ORIGIN) ||
    clean(import.meta.env.PUBLIC_ORIGIN) ||
    "https://portal.ceruleanavi.net"
  );
}

/**
 * 登录去哪儿。
 *
 * **不带 callbackUrl。** can-web 的 `/signin` 只接受站内绝对路径
 * （`/^\/(?!\/)/`），那是一道防开放重定向的检查，把
 * `https://portal.ceruleanavi.net/...` 传过去只会被丢掉、回落到 `/pilots`。
 * 要让成员登录完回到这里，得先在 can-web 那边显式放行这个域 —— 那是一处对钓鱼
 * 很敏感的改动，属于 can-web 的评审范围，不该在这里偷偷绕过去。
 * can-controller 的同名函数上写着同一段话。
 */
export function signInUrl(): string {
  return `${CAN_WEB_ORIGIN}/signin`;
}

/** 主站上某个页面的绝对地址。侧栏的跨站链接都由它拼。 */
export function webUrl(path: string): string {
  return `${CAN_WEB_ORIGIN}${path}`;
}

/**
 * 三道评级门槛，和 can-web 的 `ratingTrans` 逐字对齐。
 *
 * 8 是教员（I1/I2/I3），11 是监理（SUP），12 是管理员（ADM）。这三个数在这个仓
 * 库里只出现在这里 —— 中间件、侧栏、页面各自 import 同一份，因为**它们必须一
 * 致**：侧栏按一个数显示、中间件按另一个数放行，会做出一个「看得见但点不进去」
 * 的菜单，而那种不一致没有任何东西能发现。
 *
 * **这些是便利，不是边界。** 真正的判断在 can-api 每条路由自己的守卫上
 * （`WithSuper` / `WithSup`，再加每个 handler 内部的 division 检查）。把这里的
 * 数字改小不会放开任何东西，只会让人看见一组点下去必然 403 的页面。
 */
export const RATING_INSTRUCTOR = 8;
export const RATING_SUP = 11;
export const RATING_ADMIN = 12;
