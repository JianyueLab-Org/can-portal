# can-portal

**教员与管理门户** — `portal.ceruleanavi.net`

Cerulean Aviation Network 的管理面：带学员、审晋升、办活动、发奖品、公示处理结果。
从 can-web 的 `/instr/*` 和 `/super/*` 整段搬出来的七个页面。

工程约定给人和模型看的那一份在 [`AGENTS.md`](AGENTS.md)（`CLAUDE.md` 是它的软链
接）。这份 README 只讲怎么跑起来。

## 页面

| 地址                | 做什么                             | 最低等级 |
| ------------------- | ---------------------------------- | -------- |
| `/`                 | 入口清单，按等级过滤               | 8 (I1)   |
| `/instr/roster`     | 花名册 —— 看和改管制员的分部权限   | 8 (I1)   |
| `/instr/promote`    | 晋升 —— 为够格的学员提交申请       | 8 (I1)   |
| `/instr/sweatbox`   | 模拟机场景生成器                   | 8 (I1)   |
| `/super/activities` | 活动管理 —— 开活动、点名、结算积分 | 11 (SUP) |
| `/super/prizes`     | 奖品管理 —— 积分商城和兑换         | 11 (SUP) |
| `/super/feedback`   | 处理结果公示                       | 11 (SUP) |
| `/super/promotions` | 晋升审批                           | 12 (ADM) |

等级门槛在三个地方生效，而且读的是同一组常量：中间件（进不去）、侧栏（看不见）、
首页卡片（列不出）。**真正拦住数据的是 can-api**，这三处都只是不给人看点下去必然
403 的东西。

## 跑起来

需要 Bun ≥ 1.3 和一个带 `read:packages` 的 GitHub 令牌 —— 设计系统
`@jianyuelab-org/can-ui` 装在 GitHub Packages 上，而 GitHub 的 npm registry 即使是
公开包也要求带令牌。

```bash
export GITHUB_TOKEN=$(gh auth token)   # 或者一个 read:packages 的 PAT
bun install
cp .env.example .env                   # 至少要设 PUBLIC_ORIGIN
bun run dev                            # http://localhost:4328
```

`.env` 里三个值都不是密钥，是主机名。**但要注意默认值指的是线上的 can-api** ——
这个站的写操作会真的晋升一个人、真的结算一场活动的积分。

登录：这个站没有登录页。它认 can-api 签在父域 `.ceruleanavi.net` 上的会话
cookie，本地开发时那枚 cookie 不会跟到 `localhost`，所以本地会一直被 302 去主站的
`/signin`。要在本地看页面，最省事的办法是在浏览器里把 `.ceruleanavi.net` 的
`can_session` 复制到 `localhost`。

## 门禁

```bash
bun run lint     # format:check + astro check + vue-tsc
bun run build
```

CI 跑的是同样这两条（`.github/workflows/check.yml`），一字不差。没有测试套件。

## SweatBox 参考数据

`src/data/sweatbox/` 是从 `Sector/` 扇区包生成的构建产物，已经提交，日常开发不用
管它。换 AIRAC 周期时重新生成：

```bash
SECTOR_REPO=~/Documents/Dev/CeruleanAviationNetwork/Sector bun run build:sweatbox
```

**这份数据不许进公开仓库。** 它派生自商用 AIRAC 周期和不属于我们的扇区包 —— 这也
是这个仓库必须保持私有的原因，详见 `AGENTS.md`。

## 部署

`deploy/k8s.yaml`，jyl-tyo 集群，namespace `can-portal`，Ingress 走
`cloudflare-tunnel`。推 `main` 就部署（`.github/workflows/deploy.yml`）。

**这个站没有任何应用级 Secret。**

## 相关仓库

- **can-api** — 数据全部来自它。这个站的每一次读写最终都落到它的 `/api/v1/super/*`。
- **can-web** — 主站。登录页在那儿，被搬走的七个地址在那儿有转向。
- **can-controller** — 管制员中心。它的侧栏链到这里的教员和 ADM 页面。
- **can-ui** — 设计系统。这个站的每一个组件都来自它。
- **Sector** — SweatBox 参考数据的来源。
