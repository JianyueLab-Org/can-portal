// @ts-check
import { defineConfig } from "astro/config";
import node from "@astrojs/node";
import vue from "@astrojs/vue";
import tailwindcss from "@tailwindcss/vite";

/**
 * 教员与管理门户。第七个站，和 can-web / can-dev / can-radar / can-efb /
 * can-exam / can-controller 同一套形状：Astro SSR（standalone Node 适配器）+
 * Vue 岛屿 + Tailwind v4。**不要在这里发明第八套。**
 *
 * `output: "server"` 是必需的而不是预留：这个站每一页都要登录**而且要评级**，
 * 页面渲染前要拿会话 cookie 去问 can-api「你是谁、几级」，预渲染的页面既拿不到
 * cookie 也拿不到评级。
 *
 * **没有 mdx，也没有 @tailwindcss/typography。** can-controller 有那两样是因为
 * 它带着管制规则那批 MDX 文档；这个站一份长文都没有，七个页面全是表单和表格。
 * 抄一个站的配置时顺手把它的内容管线也抄过来，是依赖列表长出无人使用的条目的
 * 常见方式 —— 而每一条都要跟着升级、跟着出安全公告。
 *
 * `security.checkOrigin: false` 的理由和另外六个站逐字相同：Astro 从 `Host` 头
 * 推导本站 origin 再和浏览器的 `Origin` 比对，而这个站跑在 TLS 终止的反代后
 * 面，推出来的是 `http://…`、浏览器发的是 `https://…`，**永远对不上**，于是每
 * 一个 POST 都是 403。在这里那意味着晋升、活动、奖品、公示全部写不进去。关掉
 * 不等于不检查：写操作的 Origin 要比对显式的 `PUBLIC_ORIGIN`，见
 * `src/pages/api/v1/[...path].ts`，那个值反代动不了。
 */

// https://astro.build/config
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  integrations: [vue()],
  security: { checkOrigin: false },
  vite: {
    plugins: [tailwindcss()],

    /**
     * can-ui 发的是**源码**（`.vue` / `.ts` / `.css`）而不是构建产物。代价是必须
     * 告诉 Vite 不要把它当外部依赖：不加这行，SSR 会去 `require` 一个 `.vue`
     * 文件，首屏直接 500。
     */
    ssr: { noExternal: ["@jianyuelab-org/can-ui"] },
  },
});
