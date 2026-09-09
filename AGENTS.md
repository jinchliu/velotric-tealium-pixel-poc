# AGENTS

这份文件写的是**在这个仓库里干活要遵守什么**。

**动跨端的东西之前先读 [ARCHITECTURE.md](ARCHITECTURE.md)。** join 契约、去重、
Firestore 布局都在里面，不读就动会静默改错数据。

怎么装和配见 [README.md](README.md);字段清单见
[docs/events.md](docs/events.md);数据对不上时见
[docs/troubleshooting.md](docs/troubleshooting.md)。

## 禁令

破坏下面任何一条都不会报错，只会让数据静默错掉。机制见 ARCHITECTURE 的
「关键契约」，这里只说不能做什么、以及做了会怎样。

### 1. 已上线的客户不要重命名 join 字段

这个名字同时存在于四个地方，漏掉任何一处 join 就返回空，没有任何报错:

1. pixel 发出的字段
2. sGTM `ED - checkout_token` —— keyPath
3. sGTM `ga_client_id` —— queryKey
4. sGTM `ga_session_id` —— queryKey

只有在**什么都还没上线**时改名才安全。

### 2. 两张 Lookup Table 故意用不同的输入，不要「对齐」

web 容器按 `{{Page Hostname}}` 查表，server 容器按
`{{Request Header - Shopify Shop Domain}}`。两者看得到的东西不同，行集合零重叠。

统一成任何一边都会静默失效:server 表填 hostname，请求头匹配不上，所有店铺落进
兜底 measurement ID;web 表填 shop domain，`{{Page Hostname}}` 匹配不上，而这张
表没有默认值，客户端什么都不上报。

### 3. 两个交互追踪 tag 的副本必须逐字节一致

`gtm/*.html` 是源码，GTM 里的 tag 是副本。不一致会导致同一次点击在两个 tag 上
解析出不同的 module 值。换主题时它是**重写**，不是换选择器。

### 4. Stape loader URL 在两个文件里各有一份，要一起改

`shopify/theme-liquid.html` 硬编码的 URL，与 `shopify/web-pixel.js` 用
`STAPE_*` 常量拼出的 URL，必须指向同一个 Stape 容器。只改一处，容器加载和
cookie 桥接会指向不同的地方。

### 5. `item_id` 的国家段拿 feed 导出核对，不要信文档

只影响 Google Ads 的商品级报表。向客户要一份 `item_id` csv 比对前缀;同时告诉
客户**不要卸载重装 Google & YouTube app**，那会把国家段变成 `ZZ`。改 `item_id`
会打断 GA4 商品报表的连续性，没有追溯映射。

## 优先怀疑的静默失败

以下每一种都产出格式正常的数据、不抛异常。
[docs/troubleshooting.md](docs/troubleshooting.md) 有每一条的症状、成因和确认
方法。

- **`measurementId` 不匹配** —— `ga_session_id` 静默回退成时间戳，而
  `ga_client_id` 依然正确，反而掩盖了问题。
- **`transaction_id` 回退链** —— `order` 为 null 时 purchase 写不出去重键，
  被重复计数。
- **webhook topic 订错** —— `carts/create` 而非 `orders/paid`，每次购物车创建
  都被报成 0.00 的 purchase。两个系统都不校验 topic。
- **Merchant Center 国家段不对** —— 格式正确但 join 不上任何东西。
- **postMessage 未校验来源** —— 任何 iframe 都能往 `dataLayer` 注入事件。
- **sGTM Preview 什么都不显示** —— pixel 的 `fetch` 不带 preview 头，跨域也不带
  cookie。Preview 里没有不能证明任何事。

## 约定

**代码**

- pixel 跑在 Shopify 沙箱里，只能用 `analytics`、`browser` 和 `init`;沙箱内
  `document.cookie` 不可读，cookie 必须走 `browser.cookie.get`。
- 代码注释用英文。实现取舍写在对应代码旁边，不要写进文档。

**构建**

- 构建交付文件前先读 `config`，不要假设 `main` 上是中性值。
- 新客户从 `main` 开始，不从分支。

**提交**

- 没被要求就不要提交。
- commit message 用英文，Conventional Commits，正文说明**为什么** —— 期望的
  详细程度参考 `c8d3e1d` 与 `d5f055e`。

**GTM**

- 改动停留在 workspace draft 里直到发布版本。创建版本前先用
  `get_workspace_status` 检查有没有无关的待发布改动 —— 发布会把 workspace 里
  的所有东西一起推上线。
- **克隆容器给新客户会把每一个缺陷一起带过去。** 交付前逐项 diff:tag 名与
  Event Name、变量名与它实际读的 key、参数表里的重复行、trigger 与 DOM 的
  对应关系，以及一切属于源客户的值(Lookup Table 默认值、`project id`、
  `server_url`、`gtagMeasurementIds`、API key)。这五类都至少错过一次 ——
  见 [docs/clients/modesees.md](docs/clients/modesees.md)。

**调查**

- 用数据验证，不要只靠文档推理。Shopify 的 Web Pixels API 文档对可空性写得很
  薄，代码依赖的好几个字段最后发现根本不存在。

## 客户记录

每个客户一个文件，在 `docs/clients/<name>.md`。

**动某个客户的东西之前先读它的文件。** 那些文件不会自动加载 —— 标识符，以及
每个客户在哪些地方与通用文档相悖，不打开就不知道。`ls docs/clients/` 回答有哪些
客户;`grep -rl <id> docs/clients/` 回答某个 measurement ID、容器或主机名属于谁。

新客户从 `docs/clients/_TEMPLATE.md` 复制。**记标识符，不记状态** —— 用现在时
写的部署状态在任何东西上线的那一刻就错了，而没人会回来改。状态值得留就给它一个
日期:「截至 2026-08-20 该店面没有任何 GTM 容器」永远成立，「未部署」不会。
