# 排查手册 (Troubleshooting)

数据看起来正常但对不上时查这里。本文覆盖浏览器端与它到 sGTM 的那一跳;
契约本身见 [AGENTS.md](../AGENTS.md)，字段清单见 [events.md](events.md)。

## 先确认这几件事

1. **控制台有没有 `[pixel]` 开头的 warn。** 所有静默回退都会打一条，那是唯一
   的信号。
2. **`measurementId` 是不是店面 gtag.js 实际写入的属性。** 不一致时
   `ga_session_id` 会回退成时间戳，而 `ga_client_id` 依然正确，足以骗过肉眼。
3. **sGTM Preview 里看不到，不代表没送到。** 见下方最后一条。
4. **数据落没落 Firestore。** 比看 GA4 快，也比 Preview 可信。

## 静默失败模式

以下每一种都产出格式正常的数据、不抛异常，排查时优先怀疑。

### `measurementId` 不匹配

Pixel 读的是 `_ga_<measurementId>`，这个 cookie 由店面的 gtag.js 写入。两者
不一致时 `ga_session_id` 回退成 `Math.floor(Date.now()/1000)` —— 一个外观正常、
与任何 GA4 会话都无关的整数。`_ga` 与属性无关，所以 `ga_client_id` 仍然正确，
反而掩盖了问题。

### `transaction_id` 回退链

`order?.name || order?.id || checkout.token` 三项里只有中间一项真正有效:
`Order` 根本没有 `name` 字段，`checkout.token` 在 `checkout_completed` 上疑似
为 null。`order` 为 null 时，purchase 会不带 transaction id 进入 GA4，写不出
去重键，于是 webhook 补发的那条被重复计数。

### webhook 订阅了错误的 topic

订成 `carts/create` 而不是 `orders/paid`，补发脚本就会转发购物车创建事件，
sGTM 把每一条都报成 0.00 的 purchase，键是 cart token。两个系统都不校验 topic。

### Merchant Center 国家段不对

feed 里是 `shopify_CA_…` 而 pixel 发 `shopify_US_…`，是一个格式完全正确、但
join 不上任何东西的 ID。国家段无法从 pixel 观测，必须拿客户的 Merchant Center
feed 导出核对，不能只看文档。

### postMessage 未校验来源

`theme-liquid.html` 把任何带 `event` 属性的消息推进 `dataLayer`，不检查
`origin` 或 `source`，所以页面上任何 iframe 都能注入事件。

### sGTM Preview 什么都不显示

Pixel 的 `fetch` 不带 `X-Gtm-Server-Preview` 头，且默认 `credentials:
'same-origin'` 意味着跨域请求不带 cookie。**Preview 里没有不能证明任何事** ——
改看 Firestore，或看响应里的 `unique_event_id`。

## 两个脚本请求不是重复加载

装好后 Stape 域名上会出现两个不同的请求，这是 GTM + GA4 的固有模式:

| 请求 | 是什么 | 职责 |
| --- | --- | --- |
| `/<loaderScript>.js?<query>` | GTM 容器 | 标签管理运行时，决定何时触发。自身不测量、不写 cookie、不发数据 |
| `/<containerId>/<proxyPath>?<param>=<base64>` | gtag.js | GA4 衡量库，写 `_ga` / `_ga_<id>` cookie、维护会话、发送命中 |

第二个请求的 base64 参数解开就是 `/gtag/js?id=G-XXXXXXXXXX`，在 DevTools 的
**Initiator** 列能看到它由第一个脚本发起。用 GTM 部署 GA4 必然产生这两个请求
([官方对比](https://support.google.com/tagmanager/answer/7582054))。不走代理时
它们是 `googletagmanager.com/gtm.js` 与 `/gtag/js`，一眼可辨;这里两者都被 Stape
代理到自有域名、目标 URL 又被 base64 编码，才容易误判成同一个脚本加载了两次。

两个响应均为 `Cache-Control: private, max-age=900`。排查时若勾了 DevTools 的
**Disable cache**，每次刷新都会重新下载，看起来像每次都在重复加载。

## 检查产物 (Build Artefacts)

交付的 `*.min.js` 是单行文件，所以:

- 用 `node --check` 验证语法。
- 数出现次数用 `grep -o … | wc -l`，不要用 `grep -c` —— 后者对单行文件永远
  返回 1。
