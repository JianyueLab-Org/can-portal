import type { APIRoute } from "astro";
import { CAN_API_ORIGIN, origin } from "@/lib/config";

export const prerender = false;

/**
 * 走白名单的 can-api 反代。
 *
 * **为什么有这一层，而不是让岛屿直接打 api.ceruleanavi.net。** can-web 是直连
 * 的，因为 `ceruleanavi.net` 写在 can-api 的 `ALLOWED_ORIGINS` 里；portal 这个域
 * 没写，加进去要改 can-api 的部署环境变量并重启。同源反代让这个站**今天**就能
 * 跑，一行 can-api 都不用动 —— can-controller 代理它那六条、can-radar 代理
 * `/track` 和 `/metar`、can-efb 代理它那一组，都是同一个理由。
 *
 * 顺带解决的两件事：浏览器不需要 CORS，会话 cookie 也不必跨站 travel（它在父域
 * 上，本来就会跟着同源请求过来，再由这里转发）。
 *
 * **白名单是重点，不是修饰，而且在这个站上尤其如此。** 这里转发的几乎全是
 * `/api/v1/super/*` —— 晋升、活动结算、奖品、公示，网络上权限最高的一批写操
 * 作。一个通配的 `/api/*` 转发等于在这里重建一遍当年拆掉的网关，而且是在一个专
 * 门用来放高权限操作的域名上。每一条都写清楚谁在用。
 *
 * 鉴权本身**不在这里判**。can-api 每条路由自己有守卫（`WithSuper` / `WithSup`
 * 加上每个 handler 内部按 division 的那一层），在这里再抄一份只会有两份可能不一
 * 致的判断 —— 而**宽的那一份会先被人发现**。这一层只管三件事：这个路径允许被转
 * 发吗、这个方法允许吗、写操作的 Origin 对吗。
 *
 * 中间件的评级门槛也不在这里重复，理由相同：那道门管的是「页面给不给看」，这一
 * 层管的是「路径给不给转」，而**能不能做**永远是 can-api 说了算。注意中间件对
 * `/api/` 前缀是放行的，所以一个不够格的成员理论上可以直接打这些路径 —— 他会拿
 * 到 can-api 的 403，这正是设计：如果这里也判一次 rating，那么哪天两处数字不一
 * 致，症状会是一个「界面能开、接口 404」的页面，比一个干脆的 403 难查得多。
 */

interface Allowed {
  /** 允许的方法。 */
  methods: string[];
  /** 谁在用它 —— 没有这一句，以后没人敢删任何一条。 */
  who: string;
}

/** 精确匹配的路径。 */
const ALLOW_LIST: Record<string, Allowed> = {
  // 外壳：账户区、退出按钮。
  "auth/session": { methods: ["GET"], who: "middleware / AppLayout" },
  "auth/signout": { methods: ["POST"], who: "AppShell 退出登录" },

  // 花名册（`/instr/roster`）。读的是 super/roster 而不是公开的 atc/roster：
  // 后者不带邮箱和分部权限，正是教员在这一页上要改的东西。
  "super/roster": { methods: ["GET"], who: "SuperRoster.vue" },

  // 晋升（`/instr/promote`）。两条路径是一条流程的两半，名字只差一个 s：
  //   promote   —— 谁**可以**被晋升（按调用者的权限范围过滤过的名单）
  //   promotions —— 已经**提出**的申请；POST 到这里是提一条新的
  // can-api 的 server.go 上记着这两条当年被写反过。
  "super/promote": { methods: ["GET"], who: "SuperPromote.vue 读候选名单" },
  "super/promotions": {
    methods: ["GET", "POST"],
    who: "SuperPromote.vue 提交申请 / SuperPromotions.vue 读队列",
  },

  // 活动管理（`/super/activities`）。
  "super/activity": {
    methods: ["GET", "POST"],
    who: "ManageActivities.vue 列表与新建",
  },

  // 奖品与兑换（`/super/prizes`）。
  //
  // 这两条的响应形状**不一样**，就在同一个岛屿里相隔十几行：prize 给的是
  // `data: [...]`，redemption 给的是 `data: {redemptions: [...]}`。那是
  // `lib/canApi.ts` 里 `unwrapList` 存在的原因，不是这一层的事 —— 写在这里只是
  // 因为下一个加路径的人多半正在看这张表。
  "super/prize": {
    methods: ["GET", "POST"],
    who: "ManagePrizes.vue 列表与新建",
  },
  "super/redemption": { methods: ["GET"], who: "ManagePrizes.vue 兑换记录" },

  // 处理结果公示（`/super/feedback`）。
  "super/feedback": {
    methods: ["GET", "POST"],
    who: "ManageFeedback.vue 列表与新建",
  },

  // 公示要点名一个成员，所以要一个搜人的接口。这是 can-api 上唯一一条会返回
  // 「调用者本来没有别的理由读到的成员」的 staff 路由，它自己是 SUP/ADM 门槛。
  "super/members": { methods: ["GET"], who: "ManageFeedback.vue 成员搜索" },
};

/**
 * 带一个动态段的路径。
 *
 * 精确白名单表达不了 `/api/v1/super/prize/<id>` 这种形状。正则是**收紧的**而不
 * 是 `.*`：`[0-9]{1,20}` 让 `super/prize/../../pilot/xxx` 这类东西连讨论的余地
 * 都没有。
 *
 * 顺序上精确表先查，这一点是**必须**的而不是顺手 —— 见 `lookup()`。
 */
const ALLOW_PATTERNS: Array<Allowed & { test: RegExp }> = [
  {
    // 三个岛屿都用它读自己的资料，为的是知道自己管得着哪些分部。
    test: /^pilot\/[A-Za-z0-9_-]{1,32}$/,
    methods: ["GET"],
    who: "SuperRoster / SuperPromote / SuperPromotions 读调用者自己的分部权限",
  },
  {
    test: /^super\/roster\/[0-9]{1,20}$/,
    methods: ["PATCH"],
    who: "SuperRoster.vue 改一个管制员的分部权限",
  },
  {
    // 批一条晋升。**POST 而不是 PATCH** —— 和 can-api 的路由表一致。
    test: /^super\/promotions\/[0-9]{1,20}$/,
    methods: ["POST"],
    who: "SuperPromotions.vue 审批",
  },
  {
    test: /^super\/activity\/[0-9]{1,20}$/,
    methods: ["GET", "PATCH"],
    who: "ManageActivities.vue 读一场活动 / 改期、点名、结算积分",
  },
  {
    test: /^super\/prize\/[0-9]{1,20}$/,
    methods: ["PATCH", "DELETE"],
    who: "ManagePrizes.vue 改一件奖品 / 下架",
  },
  {
    test: /^super\/redemption\/[0-9]{1,20}$/,
    methods: ["PATCH"],
    who: "ManagePrizes.vue 标记一笔兑换已发放",
  },
  {
    test: /^super\/feedback\/[0-9]{1,20}$/,
    methods: ["PATCH", "DELETE"],
    who: "ManageFeedback.vue 改一条公示 / 撤下",
  },
];

/**
 * 精确表先查，模式表后查。
 *
 * **顺序是必须的。** `super/roster` 和 `super/prize` 这些精确条目不会被下面的模
 * 式匹配上（模式都要求后面还有一个 id 段），但 `pilot/<id>` 那条模式会匹配
 * 到任何 `pilot/xxx`，而将来若有人加一条精确的 `pilot/data`，它必须先拿到自己
 * 的方法集，否则会被那条只允许 GET 的模式判成 405。can-controller 的同名文件正
 * 是被这一条咬过。
 */
function lookup(path: string): Allowed | undefined {
  return (
    ALLOW_LIST[path] ?? ALLOW_PATTERNS.find((entry) => entry.test.test(path))
  );
}

const UNSAFE = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * 逐字转发给 can-api 的响应头。
 *
 * `set-cookie` **必须**在里面：退出登录是 can-api 用一个 Set-Cookie 清掉会话
 * 的，漏掉它成员就永远登不出去。
 */
const PASS_THROUGH = ["content-type", "cache-control", "set-cookie"];

const handler: APIRoute = async (context) => {
  const rest = context.params.path ?? "";
  const entry = lookup(rest);

  if (!entry) {
    return Response.json(
      { error: "not_allowed", message: "该接口不在此站的转发白名单内。" },
      { status: 404 },
    );
  }

  const method = context.request.method.toUpperCase();
  if (!entry.methods.includes(method)) {
    return Response.json(
      { error: "method_not_allowed", message: "方法不被允许。" },
      { status: 405, headers: { allow: entry.methods.join(", ") } },
    );
  }

  // 写操作的 Origin 检查 —— Astro 的 checkOrigin 关掉了（反代下它永远误判，见
  // astro.config.mjs），这是补上的那一半。缺 Origin 头的请求放行：非浏览器的
  // 调用方本来就不带它，而它们要过的是 can-api 的守卫，不是这一关。
  if (UNSAFE.has(method)) {
    const sent = context.request.headers.get("origin");
    if (sent && sent !== origin()) {
      return Response.json(
        { error: "bad_origin", message: "跨站请求被拒绝。" },
        { status: 403 },
      );
    }
  }

  const target = CAN_API_ORIGIN + "/api/v1/" + rest + context.url.search;

  const headers = new Headers();
  const cookie = context.request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  const contentType = context.request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method,
      headers,
      body:
        method === "GET" || method === "HEAD"
          ? undefined
          : context.request.body,
      // body 是流，Node 的 fetch 要求显式声明才肯发。
      ...(method === "GET" || method === "HEAD" ? {} : { duplex: "half" }),
      signal: AbortSignal.timeout(15_000),
    } as RequestInit);
  } catch (error) {
    console.error(`can-api ${rest} unreachable:`, error);
    return Response.json(
      { error: "unreachable", message: "无法连接到 can-api，请稍后再试。" },
      { status: 502 },
    );
  }

  const out = new Headers();
  for (const name of PASS_THROUGH) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }

  return new Response(upstream.body, { status: upstream.status, headers: out });
};

export const GET = handler;
export const POST = handler;
export const PATCH = handler;
export const DELETE = handler;
