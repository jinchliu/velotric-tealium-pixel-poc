# ARCHITECTURE

> The current Velotric test files are Tealium-only and retain the original per-event Pixel layout. See [Velotric integration notes](docs/clients/velotric.md). The original production GTM Pixel is a separate installation.

## Tealium POC flow

```text
Shopify events -> original per-event calculations -> Tealium UDO mapper
  -> Pixel-owned consent checks, preparation queue, readiness and deduplication
     Storefront: minimal parent loader/receiver -> utag.view / utag.link
     Checkout:  SDK inside the Pixel          -> utag.view / utag.link
Shopify privacy API -> Pixel state -> permission snapshot in each bridge message
```

Only approved origins activate this POC. There are no dataLayer writes,
GTM/Stape loaders, or store-cookie POSTs. The theme contains no copy of the Pixel
runtime, queues, or timers. Consentmo live integration is deferred. Both files
use bridge protocol version 3 and must be installed together.

## Legacy production architecture reference

The remaining description documents the original GTM production integration,
including its legacy file names. It does not describe the current Tealium-only
POC implementation or authorize changes to the production store.

整套方案分三端 —— web 端、server 端、补发 —— 难点几乎都在接缝处。本仓库是
web 端的源码。

## 仓库结构

| 路径 | 内容 |
| --- | --- |
| `shopify/web-pixel.js` | Web Pixel 主体，粘贴进 Shopify 后台的 custom pixel |
| `shopify/theme-liquid.html` | `theme.liquid` `<head>` 片段:GTM 容器 + postMessage 接收端 |
| `gtm/*.html` | web 容器里两个交互追踪 custom HTML tag 的源码，GTM 里是逐字节副本 |
| `docs/` | 字段参考、排查手册、各客户记录 |

The base Shopify files are standalone. The Velotric Dev delivery has a local
Node.js build and tests; see the client integration notes above.

## 系统全景

| 端 | 源码 / 配置在哪 | 职责 |
| --- | --- | --- |
| **web 端** | **本仓库** —— `shopify/`(pixel + 主题片段)与 `gtm/`(web 容器的 custom HTML tag)；容器其余配置(tag、trigger、变量、Lookup Table)只在 GTM web 容器 `<gtm-web-container-id>` 界面里 | 产出 GA4 形状的事件推进 `dataLayer`，把第一方 cookie 桥接给 sGTM，并按 `{{Page Hostname}}` 查表决定发往哪个 GA4 属性 |
| **server 端** | GTM server 容器 `<gtm-server-container-id>`，托管在 Stape，容器标识 `<stape-container-identifier>` | 写 Firestore、做 join、去重、转发 GA4 |
| **补发** | [order-backfill](https://github.com/jinchliu/order-backfill)，跑在 Cloud Run | 接 Shopify 订单 webhook，重放给 server 端 |

下文的 **sGTM** 一律指 GTM server 容器。

**所有 join 与去重逻辑都在 sGTM** —— 不在 pixel，也不在 backfill。backfill 只
负责重发。

### 两个端点

同一个服务端容器有两个主机名，两家产品各叫各的名字:GTM 管
`<tagging-server-url>` 叫 *tagging server URL*，Stape 管
`<container-loading-path>` 叫 *container loading path*(自定义 loader 域名)。

- pixel 把 cookie POST 到 `<container-loading-path>/data`
- backfill POST 到 `<tagging-server-url>/data`

### 归因回补路径

一次结账可能自始至终没有可用的 purchase 上报 —— 页面卸载、拦截器吃掉请求、
用户未同意。回补路径是:结账时抓住买家的 cookie，以 checkout token 为键存进
Firestore，之后让订单 webhook 反查回来。

```
checkout_started ──► sendStoreCookies() ──► sGTM ──► Firestore /{checkoutToken}/
                                                             │
Shopify orders/paid ──► order-backfill ──► sGTM ─────────────┘ 按 checkout token join
                                             │
                                             └─► GA4 purchase(若尚未被追踪)
```

### store_cookies 的重发

`checkout_started` 首次发送，此后每个结账步骤各重试一次 —— 首次发送只有一次
机会，请求被页面卸载打断这单就再也无法归因。所以 **server 端会收到同一个
checkout token 的多次 POST**，pixel 侧用两个模块级 Set 保证幂等，正常情况下
Firestore 只落一次写。

这组订阅**不受 `track*` 开关控制**：它服务的是订单归因而非 GA4 报表，客户关掉
GA4 事件开关时它必须照常工作。

pixel 侧其余的实现取舍(价格怎么算、GA id 怎么解析、为什么不设延时、
`keepalive` 保什么)记在 `shopify/web-pixel.js` 的注释里，就在对应代码旁边。

### pixel 内部数据流

```
Storefront / Checkout 事件
        │  analytics.subscribe(...)
        ▼
  GA4-style payload  (pushEventToDataLayer)
        ├─► window.dataLayer.push()      // 沙箱内 dataLayer，结账页注入 GTM 后才被消费
        └─► window.parent.postMessage()  // 镜像给父页面，由 theme.liquid 接收端推入顶层 dataLayer

checkout_started / checkout_completed  额外触发 loadGTM()
checkout_started 起的每个结账步骤       额外触发 sendStoreCookies()
```

## 数据存储

Firestore，GCP 项目 `<gcp-project>`，数据库 `(default)`。用 Firestore REST API
加 `gcloud auth application-default print-access-token` 读取。

根集合按标识符命名，不按实体类型:

```
/{checkoutToken}/{autoId}          store_cookies payload (_ga, _fbp, UTM, ga_client_id, …)
/{orderId}/{autoId}                purchase 记录，带 `tracked: true` —— 去重键
/shopify_webhooks/{topic}-{id}     webhook 原始回执:checkout_token, status, original_body_b64
```

**两个 `client_id` 形状的字段含义相反。** 在 store_cookies 文档里，
`ga_client_id` 是从 `_ga` 解析出的真值，而 `client_id` 是 sGTM 合成的 `dcid.…`
(pixel 的跨域 fetch 不带 cookie)。在 purchase 文档里，`client_id` 才是真值。
下游代码必须从 store_cookies 读 `ga_client_id`。

## 外部集成

| 服务 | 用途 | 接口 |
| --- | --- | --- |
| Shopify Web Pixels API | 订阅店面与结账事件 | 沙箱内的 `analytics` / `browser` / `init` |
| Shopify Admin(webhook) | `orders/paid` 推给 backfill | HTTP webhook |
| Stape | 托管 sGTM、自定义 loader 域名、`/data` 端点 | Custom Loader power-up、Google Service Account power-up |
| Google Analytics 4 | 最终落点 | 由 sGTM 转发 |
| Google Merchant Center | `item_id` 的真值来源 | 只能靠人工导出 feed 核对 |

## 部署拓扑

**每店一个 GA4 属性**，由两个容器各自的 Lookup Table 变量解析:

| 容器 | 输入 | 默认值 |
| --- | --- | --- |
| GTM web | `{{Page Hostname}}` | 无 —— 未列入的店铺客户端什么都不追踪 |
| GTM server | `{{Request Header - Shopify Shop Domain}}` | 一个兜底 measurement ID —— 未列入的店铺全落进它 |

两张表**故意用不同的输入**:店铺的 shop domain 常常是随机生成的字符串，和品牌
域名毫无关系，而客户端只看得到 hostname。

每店一份交付文件，由 `shopify/web-pixel.js` 改 `measurementId` 与
`gmcCountryFallback` 得到，压缩可选。取值与步骤见
[README](README.md#配置)。

## 关键契约

三条契约破坏后都不报错，只是数据静默错掉。

### join 契约

pixel 发出的字段**名为 `checkout_token`，值是 `checkout.token`** —— Shopify 的
结账 token(32 位十六进制)，`orders/paid` webhook 用同名字段暴露同一个值。
Shopify 自己在同一张订单上的 `cart_token` 是另一个格式的另一个值，join 率为 0。

有一个已上线的客户用 `cart_token` 这个名字发同一个值，是被它已经上线的 sGTM
容器冻住的误称，见 [eco-worthy](docs/clients/eco-worthy.md)。

`Write Checkout Token` 会把整个 event data payload 送进 Firestore，于是这个
字段名同时变成存储文档里的字段名，而两个 lookup 要按它过滤。所以这个名字同时
存在于 pixel 的发出字段、sGTM 的 keyPath 和两个 queryKey 上，改名必须四处同时
动 —— 四处的清单与后果见 [AGENTS.md](AGENTS.md)。

### 去重

sGTM 变量 `is transaction tracked` 查 `/{transaction_id}/` 的 `tracked` 字段，
backfill 的 purchase tag 只在它不为 `true` 时触发。所以一条**没带
`transaction_id`** 的客户端 purchase 写不出去重键，backfill 会把同一张订单再报
一次。

两条路径会自报家门，这是在 GA4 里区分它们最快的办法 —— 把
`transaction_source` 加成次要维度:

| Tag | `transaction_source` | `page_location` |
| --- | --- | --- |
| `GA4 Tag`(客户端直传) | `ga_server_side` | 真实页面 URL |
| `Webhook Purchase GA4`(backfill) | `shopify_webhook` | 硬编码的 `/thank_you` |

### 交互追踪 tag 的一致性

两个 tag 是同一份源码的两个副本，共享 `window.dlIdentifyModule`，但触发时机不同
(Initialization / Page View)，所以两份副本必须保持完全一致。

**换主题是重写，不是换选择器。** 仓库里这一对针对 Shopify 的 Paris 主题，与它
移植自的 Dawn 版本几乎不共享任何选择器:轮播库、商品卡元素、section 命名、
哪些 app 渲染在 `shopify-section` 之外，每个主题都不同。三点可以通用:

- `normalizeToken()` 必须剥掉 class 名里不稳定的部分(Shopify Magic 的
  `...aigenblock...` 后缀、`template--<digits>__` 的 section 作用域、构建哈希)
  并保留语义前缀。
- section 回退需要防住裸十六进制 id，否则它会原样变成 module 值。
- 覆盖率要对着 live DOM 数 —— 统计有多少可点击元素落到 `unknown`，不要靠假设。

module 的命名要让 tag 的 `contains` 条件扫不到错误的 section:一个叫 `*_banner`
的推广块会被 `GA4 - banner_click` 的 `module contains banner` 捞走。

## Merchant Center item ID

只影响 Google Ads 的商品级报表，不影响转化追踪本身 —— 客户不投 Shopping 广告
时优先级很低。

`item_id` 必须与 Merchant Center feed 里的 `id` 逐字节一致，格式是
`shopify_<country>_<productId>_<variantId>`，**一个变体一行**，所以 `items[]`
带变体级 id，`product.id` 放 `item_group_id`(GMC 的叫法，不是 GA4 标准参数，
要先在 GA4 注册才进报表)。

国家段在 pixel 侧无法观测:`resolveGmcCountry()` 只能从
`init.data.shop.countryCode` 推断，而店铺注册国不等于销售市场;已迁移到
Merchant API 的店铺 feed 里是 `ZZ`，没有任何 Shopify 字段会返回它。唯一可靠的
办法是拿 feed 导出核对前缀。

## 安全考量

- **Firestore 的授权只给 `roles/datastore.user`** —— Stape 通过它的
  **Google Service Account power-up** 连 Firestore，上传一个 JSON key，不是
  GCP 托管凭据。
- **Firestore security rules 在这里不适用** —— 它们管的是客户端 SDK，而 IAM
  认证的服务端访问会绕过它们，所以数据库可以保持 Restrictive。

## 术语表

三个容易混淆的标识符:

| 标识符 | 格式 | 出现在哪 |
| --- | --- | --- |
| checkout token | 32 位十六进制，如 `74f42247acd2a4eb80a8b4ebe6ee2f14` | `checkout.token`、webhook 的 `checkout_token`、Firestore 集合名 |
| checkout **session** token | 24 位 base62，如 `hWNFGsv0RqSB6fPRQKIoS7By` | `/checkouts/cn/<token>/` 这段 URL |
| order id | 数字，如 `6829546569893` | `order.id`、webhook 的 `id`、Firestore 集合名 |

`store_cookies` 指 pixel 在结账时 POST 给 sGTM 的 cookie 快照，是归因回补的
原料;`cus_*` 是推送到 `dataLayer` 的自定义事件名前缀，如 `cus_purchase`。
