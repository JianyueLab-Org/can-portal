# AGENTS.md

给在这个仓库里工作的人和模型看的。`CLAUDE.md` 是指向本文件的软链接。

## 这是什么

**教员与管理门户** —— `portal.ceruleanavi.net`，Cerulean Aviation Network 的第七个
Web 组件、第六个 can-api 卫星站。它是从 can-web 的 `/instr/*` 和 `/super/*` 整段搬
出来的，搬的是**七个页面**：

| 这里                | 原来在 can-web      | 岛屿                    | 门槛 |
| ------------------- | ------------------- | ----------------------- | ---- |
| `/`                 | （新）              | 纯 Astro                | 8    |
| `/instr/roster`     | `/instr/roster`     | `SuperRoster.vue`       | 8    |
| `/instr/promote`    | `/instr/promote`    | `SuperPromote.vue`      | 8    |
| `/instr/sweatbox`   | `/instr/sweatbox`   | `SweatboxGenerator.vue` | 8    |
| `/super/activities` | `/super/activities` | `ManageActivities.vue`  | 11   |
| `/super/prizes`     | `/super/prizes`     | `ManagePrizes.vue`      | 11   |
| `/super/feedback`   | `/super/feedback`   | `ManageFeedback.vue`    | 11   |
| `/super/promotions` | `/super/promotions` | `SuperPromotions.vue`   | 12   |

技术形状和 can-controller / can-efb / can-dev / can-radar / can-exam 一样，**不要
在这里发明第八套**：Astro SSR（standalone Node 适配器）+ Vue 岛屿 + Tailwind v4，
跑在 jyl-tyo 上，由 CI 部署，Ingress 走 `cloudflare-tunnel`。开发端口 **4328**
（4321 can-web、4322 can-dev、4323 can-radar、4324 can-efb、4325 can-exam、
4326 can-controller、4327 can-ui）。

## 四条不变量

**没有数据库口令。** 一条都没有，将来也不该有。所有数据都来自 can-api。

**没有 Secret，一个都没有。** 和 can-efb / can-controller 一样，比 can-dev 更严：
这个站不参与 OAuth，也不签会话。会话是 can-api 签在**父域** `.ceruleanavi.net`
上的那一枚 cookie，成员在主站登录过，浏览器本来就把它带到这里来；这个站做的全部
事情是把它**原样转发**回 can-api，再读回答案。多存一份 `SESSION_SECRET` 等于多一
处能签发任何人身份的地方，省下的只是一次内网 HTTP。

**没有自己的登录页。** 未登录一律 302 去主站的 `/signin`（`src/lib/config.ts` 的
`signInUrl()` 上写着为什么不带 `callbackUrl`）。

**这个仓库可以是公开的。** 它一度不能：`src/data/sweatbox/` 装着从 `Sector/` 扇区
包和一个商用 AIRAC 周期派生的 2.8 MB 数据，不许进公开仓库。

而私有在这个组织里是有代价的：**JianyueLab-Org 是 GitHub Free 计划，Free 计划的组
织级 secret 到不了私有仓库**，所以私有仓库拿不到 `KUBECONFIG_B64`，**根本部署不
了**。can-efb 至今没上线就是卡在这一条上。一份 2.8 MB 的数据锁死了这个站的可见性和
上线能力。

那份数据现在在 **can-db**（`database.ceruleanavi.net` 那个服务）里，这个仓库一个字
节都不带 —— 于是它和 can-dev / can-radar / can-exam / can-controller / can-docs 完
全一样：公开仓库、组织 secret、三行的共享部署工作流、`ghcr.io/jianyuelab-org` 的镜
像。

**一件还没做完的事**：GHCR 上那个包是在仓库还私有时第一次推上去的，而**包的可见性
不跟着仓库变**（只能在网页上手动改）。所以 `deploy/k8s.yaml` 里那两行
`imagePullSecrets` 暂时留着，等有人把包改成 public 再删 —— 顺序反了会让全站
ImagePullBackOff。

## 两个前缀，一个侧栏 —— 这是这个站的形状

七个页面分在 `/instr/*` 和 `/super/*` 下，而侧栏只有一个。这两句都要成立，而且都
不是顺手。

**前缀留着，没有像 can-controller 那样拉平。** can-controller 搬家时把
`/controllers` 前缀去掉了（can-efb 也把 `/pilots` 去掉了），理由是「这个站整个就
是管制员中心，再套一层等于把主站的目录结构搬到一个只有它自己的域名上」。这里不适
用，两个原因：

1. 前缀编码的是一道**真实的评级边界**。`super` 读作「监理」（SUP，等级 11），而花
   名册、晋升、SweatBox 是**教员**（等级 8）的活 —— can-web 当初把这三页从
   `/super` 拆到 `/instr` 正是为了这个。拉平之后那条信息就没了。
2. 拉平会撞车。`/promote`（谁**可以**被晋升）和 `/promotions`（晋升**申请**队列）
   是两个不同的页面、两拨不同的人用，一字之差。带着前缀它们是
   `/instr/promote` 和 `/super/promotions`，一眼分得开。

**侧栏不分开**，因为一个既是教员又是 ADM 的人要能在两半之间走过去。分成两个侧栏
之后，他在 `/instr/roster` 上就没有通往 `/super/promotions` 的入口了，只能背地
址。导航按等级出现（`src/lib/nav.ts`），本来就已经把两拨人分开了。

## 中间件按 rating 挡人，这是这个站和另外六个的区别

在 can-web 上，`/instr` 和 `/super` 只在 `PROTECTED_PREFIXES` 里，也就是**只判有
没有登录**。于是一个普通飞行员打开 `/super/prizes` 会看见一个完整的奖品管理界面，
只不过每一次请求都被 can-api 拒掉 —— 页面渲染出来了，表格是空的，保存按钮点下去
弹一句 403。那不是安全问题（can-api 挡住了），是一个会让人以为系统坏了的界面。

这个站整个就是教员和管理的工作台，所以门槛提到进门这一层（`src/middleware.ts`）：
不够格的人在**看见任何东西之前**就被送回主站的 `/pilots/`，而不是看见一个空壳。
送回去而不是给 403 页面，因为他们没有做错任何事 —— 多半只是点了一条过期的书签。

三个数字（8 / 11 / 12）在这个仓库里只出现在 `src/lib/config.ts` 一处，中间件、侧
栏和首页卡片各自 import 同一份。**它们必须一致**：侧栏按一个数显示、中间件按另一
个数放行，会做出一个「看得见但点不进去」的菜单，而那种不一致没有任何测试会发现。

**这仍然是便利，不是边界。** 真正的判断在 can-api 每条路由自己的守卫上
（`WithSuper` / `WithSup`），再加每个 handler 内部按 division 的那一层 —— 一个
ZGZU 的教员看得见花名册，但改不动 ZBPE 的人，那道判断这个仓库里一行都没有。

## 反代白名单：这个站上权限最高的一段代码

`src/pages/api/v1/[...path].ts` 转发的几乎全是 `/api/v1/super/*` —— 晋升、活动结
算、奖品、公示，网络上权限最高的一批写操作。一个通配的 `/api/*` 转发等于在这里重
建一遍当年拆掉的网关，而且是在一个专门用来放高权限操作的域名上。**加一条之前先写
清楚谁在用它**，那个 `who` 字段不是装饰：没有它，以后没人敢删任何一条。

鉴权不在这一层判，理由写在那个文件里。注意中间件对 `/api/` 前缀是放行的，所以一
个不够格的成员理论上可以直接打这些路径 —— 他会拿到 can-api 的 403，这正是设计。

## SweatBox 的参考数据在 can-db，不在这个仓库

`/instr/sweatbox` 仍然一个 can-api 调用都没有，但它读的东西变了：从前是
`src/data/sweatbox/` 里 247 个提交进来的文件，现在是 **can-db**。

链路：岛屿打本站的 `/instr/sweatbox/*.json` → 那些端点调
`src/server/sweatboxData.ts` → 它调 can-db 并把形状翻译回生成器认识的样子。

**端点有两个，从前是另外两个。** `[icao].json` 一直在；`airways.json` 没有了，换成
了 `route.json?from=&to=`：

| 现在          | 给什么                                            |
| ------------- | ------------------------------------------------- |
| `[icao].json` | 一个机场的跑道、机位、程序，加它所在 FIR 的航路点 |
| `route.json`  | **一条城市对航路**，由 can-db 规划                |

`airways.json` 从前把**全国航路网整张图**（134 KB）发给浏览器，由岛屿自己跑一趟
A*。那套实现和 can-db 的 `internal/aip/route.go` 是同一件事的两份代码，而两份从来
没一致过 —— 这边的图是无向的（全库 32% 的航段单向），不知道汇编发布的 13904 条城
市对航线，也会把 `J` 打头的进离场连接线和 L888 的 `FANS-*` 脱离航线当普通航段接进
航路。三条都不报错，产出的是**看起来完全正常**、但一条都放行不了的航路。

所以规划整个交给 can-db，连 SID/STAR 也用它挑的（它按搜索挑，每条能接上航路网的程
序都是候选边）。**代价写下来**：can-db 不知道这次演练用哪条跑道，所以它挑的程序可
能不是教员选的那条跑道的。没有 plan 时才退回本地按跑道挑 ——
`src/lib/sweatbox.ts` 的 `SweatboxRoutePlan` 上写着全部理由。

**`Astro` 的路由里静态段胜过动态段**，这就是 `route.json` 能和 `[icao].json` 并存
的原因（否则 `route` 会被当成一个机场代号）。在那个目录里加第三个静态文件之前值得
知道这一点。

**那个适配器是刻意留在这一侧的**：can-db 的形状是给「航行资料」设计的（程序是一张
带 `kind` 的表，航路点叫 `ident`），生成器的是给「EuroScope 场景」设计的（`sids`
和 `stars` 两个数组，航路点叫 `name`）。两者都对。在 can-db 里加一个
`?shape=sweatbox` 等于让一个通用资料服务知道某个消费者的界面长什么样；改岛屿等于
动那 1518 行里的取数逻辑。一个有注释的适配器是三条里唯一可逆的。

**鉴权不再由这个站兜底。** 那些端点从前自带一道 rating 检查，注释写着「这是本站
唯一一处本地守卫就是边界的地方，因为上游根本不存在」—— 上游现在存在了。can-db 按
会话判：教员（8 级及以上）**或者**持有 `aipAccess` 的人可以读。本地那道检查留着，
但降成便利：它只是让绕过页面直接打地址的人拿到一句本地化的 403。

数据怎么进 can-db、`build-sweatbox.mjs` 现在在哪，看 can-db 的 `AGENTS.md`。那个脚
本跟着数据搬过去了，因为「从 Sector 提取 → 导入 → 提供」是一条链。

`src/lib/sweatbox.ts` 和 `src/lib/sweatboxPerf.ts` **留在这里**，它们是场景**格式**
和机型性能表，不是航行资料。里面记着一件重要的事：monorepo 的 `SweatBox/` 目录里那
批手写场景中，有八份把场压指令拼成了 `AIRPORE_ALT`（正确的是 `AIRPORT_ALT`），随附
的 `ES模拟机机组航向计算.py` 还把航向常量写成了 2.88（十位 pbh 字段要的是
2.8444…）。那十四张 `PERFAC` 表是**逐字**从那批文件抄的，所以校准某一行时优先挑一
份指令拼对了的源文件。

## 词典是切出来的，不是抄整本

`language/*.json` 是从 can-web 的四本词典里**按用到的命名空间切**下来的（65 KB →
25 KB），只有 `portal` 一个命名空间是这里新写的。理由：`AppLayout.astro` 把整本
`frame` 词典当 prop 序列化进每个页面的 HTML，一条没人用的文案是七个页面各发一遍的
字节。can-dev 和 can-controller 出于同一个理由做过同样的事。

改文案时**先去 can-web 改**再切过来，如果那条文案两边都在用；只有这个站有的，直接
改这里。目前只有 `portal` 属于后者。

## 和 can-web 共享的那些文件

`src/lib/tools.ts`、`src/lib/activities.ts`、`src/lib/rewards.ts`、
`src/lib/flightplan.ts` 和 `src/lib/i18n.ts` 是从 can-web **逐字复制**的，两边现在
各有一份，没有抽成包。

这是有意的，和几个卫星站各自抄 `config.ts` 是同一个理由：各站各自部署、各自有自己
的节奏，绑成一个包意味着改主站的一个日期格式会顺手改掉这里。代价是它们会慢慢漂移，
所以：**改动这些文件之前，先去 can-web 看一眼那边是什么样**，如果是通用的修复，两
边都改。

`src/lib/flightplan.ts` 是其中最要紧的一份：SweatBox 生成器用它的 `joinAircraft` 拼
`B738/L`，而主站的飞行计划表单用同一个函数拼成员填的那一份 —— **两边拼出来的东西必
须长得一样**，否则生成的进程单读起来就不像一份真的飞行计划。没有任何东西在盯着这一
点。

**搬过来之后就只有这边有的**：`src/lib/feedback.ts`（处理结果公示的校验）、
`src/lib/sweatbox.ts`、`src/lib/sweatboxPerf.ts`、`src/server/sweatboxData.ts`。
can-web 上已经删掉了，那边没有别的东西在用它们。

## 命令

```bash
bun install
bun run dev        # :4328
bun run lint       # format:check + astro check + vue-tsc —— CI 跑的就是这个
bun run build && bun run start
```

没有测试套件，和另外五个卫星站一样。门禁是 `bun run lint` 加一次 `bun run build`。
`astro check` 看不见 `.vue`，而这个站的七个页面除了一层 `.astro` 外壳之外全是 Vue
岛屿 —— 所以 `typecheck` 同时跑 `vue-tsc`，**两个都要留着**。

## 还没做的事

1. **上线。** `portal.ceruleanavi.net` 至今不解析。清单本身不缺
   （`deploy/k8s.yaml` 写好了），缺的是两件外部事项，和 can-efb 当初一样：把它接
   进 Cloudflare 隧道，确认 can-api 的会话 cookie 域覆盖它（已经覆盖
   controller 和 exam，所以多半是确认而不是改动）。
2. **登录后跳回本站。** 现在未登录会被送去主站的 `/signin`，登录完停在
   `/pilots`。要跳回来得先在 can-web 那边显式放行这个域 —— 那是一处对开放重定向
   敏感的改动，属于 can-web 的评审范围。can-controller 和 can-efb 都欠着同一件事，
   值得一起做。
3. **can-web 的旧地址转向。** 已经加了（`src/pages/instr/[...path].astro` 和
   `src/pages/super/[...path].astro`），但那七个地址在教员们的书签和各分部的文档里
   躺了很久，转向要留足够久。
