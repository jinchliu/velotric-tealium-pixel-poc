# Shopify Web Pixel for GA4 and Stape sGTM

Shopify Web Pixel,用于电商转化追踪 (conversion tracking)。订阅 Shopify 店面与结账 (checkout) 事件,转换成 GA4 风格的 payload 推送到 `dataLayer`,并在结账阶段把第一方 cookie 桥接到 Stape 服务端 GTM (server-side GTM / sGTM),供订单 webhook 事后回补归因 (attribution)。

## 仓库结构 (Layout)

| 文件 | 用途 |
| --- | --- |
| [shopify/web-pixel.js](shopify/web-pixel.js) | Web Pixel 主体,粘贴到 Shopify 后台的 custom pixel |
| [shopify/theme-liquid.html](shopify/theme-liquid.html) | `theme.liquid` `<head>` 片段:GTM 容器 + postMessage 接收端 |

交付给客户的压缩产物 `*.min.js` （optional）不入库,见 [.gitignore](.gitignore)。

## 数据流 (Data Flow)

```
Storefront / Checkout 事件
        │  analytics.subscribe(...)
        ▼
  GA4-style payload  (pushEventToDataLayer)
        ├─► window.dataLayer.push()      // 沙箱内 dataLayer(结账页注入 GTM 后才被消费)
        └─► window.parent.postMessage()   // 镜像给父页面,由 theme.liquid 接收端推入顶层 dataLayer

checkout_started / checkout_completed 时额外:
  loadGTM()            // 注入 Stape 自定义 GTM loader(延迟到结账,保持店面轻量)

checkout_started 起,每个结账步骤:
  sendStoreCookies()   // 把 GA / Meta / UTM cookie POST 到 Stape /data,按 checkout token 去重与重试
```

> 完整的事件清单与逐字段参数见文末 [追踪的事件与参数](#追踪的事件与参数-tracked-events--parameters);cookie 桥接的 payload 见 [store_cookies 桥接](#store_cookies-桥接-cookie-bridge)。

## 配置 (Configuration)

复用到新店铺时**只需改两处**([shopify/web-pixel.js](shopify/web-pixel.js) 顶部),下方业务逻辑无需改动。

### 1. `config` 块

```js
const config = {
    conversionTracking: {
        gtmContainerId: 'GTM-XXXXXX',    // Web GTM 容器 ID(仅作记录,loader 由下方常量决定)
        measurement_id: 'G-XXXXXXXXXX',  // GA4 Measurement ID
        get g_id() { ... },              // 派生:去掉 G- 前缀,用于拼 _ga_<g_id> cookie 名
        trackPageViews: true,            // 以下为各事件开关 (track*)
        // ...
    },
    store: {
        country: 'US',                   // 用于 ecomm_prodid: shopify_<country>_<product>_<variant>
        affiliationName: /* 自动取自 init.data.shop.name */,
    },
};
```

### 2. Stape 常量(紧跟 `config` 之后)

```js
const STAPE_GTM_SCRIPT_URL_BASE   = 'https://load.YOUR-STAPE-DOMAIN.com'; // Stape custom loader 域名
const STAPE_GTM_CONTAINER_ID      = 'xxxxxxxx';                          // custom loader 容器 ID
const STAPE_GTM_LOADER_PREFIX     = 'xxx';                               // loader 文件名前缀:<prefix><containerId>.js
const STAPE_GTM_BASE_QUERY_PARAMS = 'xxxxxx=...';                        // Shopify「Stape Server GTM」插件生成
```

`STAPE_GTM_SCRIPT_URL` 由前三个常量拼出(`<base>/<prefix><containerId>.js`),`loadGTM()` 消费它;`sendStoreCookies()` 复用 `STAPE_GTM_SCRIPT_URL_BASE`,POST 到同域的 `/data` 端点。

| 字段 | 来源 |
| --- | --- |
| `gtmContainerId` | Google Tag Manager 容器 |
| `measurement_id` | GA4 数据流 (Data Stream) |
| `STAPE_GTM_SCRIPT_URL_BASE` / `STAPE_GTM_CONTAINER_ID` / `STAPE_GTM_LOADER_PREFIX` | Stape 后台 custom loader |
| `STAPE_GTM_BASE_QUERY_PARAMS` | Shopify「Stape Server GTM」插件 |
| `store.country` | 店铺所在国家代码 |

## 部署 (Deployment)

### 1. Web Pixel

在 Shopify 后台 **Settings → Customer events → Add custom pixel**,把 [shopify/web-pixel.js](shopify/web-pixel.js) 全部内容粘贴进去,填好 `config` 与 `STAPE_*` 占位符后保存。

Pixel 运行在沙箱中,通过 Shopify 提供的 `analytics`、`browser`、`init` API 工作,无构建步骤、无依赖。

### 2. theme.liquid 接收端

Web Pixel 跑在沙箱 iframe 里,事件通过 `window.parent.postMessage` 镜像给父页面。需要在主题里加一段监听器,把这些事件接到顶层(父页面)的 `dataLayer`,顶层 GTM 才能消费。

完整片段见 [shopify/theme-liquid.html](shopify/theme-liquid.html),加到 [`theme.liquid`](https://shopify.dev/docs/storefronts/themes/architecture/layouts) 的 `<head>` 中:GTM 容器尽量靠前放,让它尽早加载;监听器随后注册。两段都用 `dataLayer = dataLayer || []` 兜底,`cus_page_view` 与后续 postMessage 事件都在 GTM 加载后才推入,GTM 会持续消费 `dataLayer`,故监听器放在容器之后也能正常上报。

**① Google Tag Manager 容器**(Stape 自定义 loader,域名与 query 参数需与 `STAPE_*` 常量一致):

```html
<!-- Google Tag Manager -->
<script>
  (function (w, d, s, l, i) {
    w[l] = w[l] || [];
    w[l].push({ 'gtm.start': new Date().getTime(), event: 'gtm.js' });
    var f = d.getElementsByTagName(s)[0], j = d.createElement(s);
    j.async = true;
    j.src = "https://load.YOUR-STAPE-DOMAIN.com/<prefix><containerId>.js?" + i;
    f.parentNode.insertBefore(j, f);
  })(window, document, 'script', 'dataLayer', 'xxxxxx=...');
</script>
<!-- End Google Tag Manager -->
```

**② 接收端监听器**(放在 GTM 容器之后):

```html
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "cus_page_view" });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.event) {
      window.dataLayer.push(event.data);
      window.dataLayer.push({ ecommerce: null }); // Clear ecommerce object
    }
  });
</script>
```

说明:

- `cus_page_view` 在父页面直接补发一次页面浏览。Pixel 内的 `page_viewed` 订阅只推沙箱 dataLayer、不镜像给父页面,细节见 [`cus_page_view` 事件条目](#cus_page_view--页面浏览)。
- `message` 监听器接收 Pixel 镜像过来的事件并推入 `dataLayer`;每次推送后追加 `{ ecommerce: null }`,与 Pixel 端一致,避免连续事件的 ecommerce 数据互相污染。
- GTM 容器的 `j.src` 域名与末尾 query 参数,应与 [shopify/web-pixel.js](shopify/web-pixel.js) 中 `STAPE_GTM_SCRIPT_URL_BASE` / `STAPE_GTM_LOADER_PREFIX` / `STAPE_GTM_CONTAINER_ID` / `STAPE_GTM_BASE_QUERY_PARAMS` 指向同一个 Stape 容器。

### 3. 容器会加载两个脚本,不是重复加载

装好之后,Stape 域名上会出现**两个不同的脚本请求**。这是 GTM + GA4 的固有模式,不是配置错误:

| 请求 | 是什么 | 职责 |
| --- | --- | --- |
| `/<prefix><containerId>.js?<queryParams>` | GTM 容器(Stape custom loader) | 标签管理运行时,承载 tag / trigger / variable 配置并决定何时触发。**自身不测量、不写 cookie、不发数据** |
| `/<containerId>/<proxyPath>?<param>=<base64>` | gtag.js | GA4 衡量库,写 `_ga` / `_ga_<gaContainerId>` cookie、维护会话、组装并发送命中 |

第二个请求的 base64 参数解开后就是 `/gtag/js?id=G-XXXXXXXXXX`。在 DevTools 的 **Initiator** 列可以直接看到它由第一个脚本发起。

两者职责不同,Google 的官方定义([Google Tag Manager vs. gtag.js](https://support.google.com/tagmanager/answer/7582054)):

> gtag.js is a JavaScript **tagging framework** that allows you to **send data** from your site to Google measurement products.
>
> Google Tag Manager is a **tag management system** that allows you to **set up and manage tags** on your site without changing your website's code.

所以 GTM 不替代 gtag.js,而是包在它外面;用 GTM 部署 GA4 必然产生两个请求。标准(不走代理)的站点上这两个请求是 `googletagmanager.com/gtm.js?id=GTM-XXXXXXX` 和 `googletagmanager.com/gtag/js?id=G-XXXXXXXXXX`,一眼可辨。这里两者都被 Stape 代理到自有域名(为绕过 ITP),且第二个的目标 URL 被 base64 编码进 query 参数,所以外观高度相似,容易误判成同一个脚本加载了两次。

> 注:官方文档没有一处明写「用 GTM 时会额外请求 gtag.js」。最接近的是 [CSP 指南](https://developers.google.com/tag-platform/security/guides/csp) 中的 "Tag Manager will propagate the nonce to any scripts that **it adds to the page**",以及它给出的主机级白名单 `https://www.googletagmanager.com`(同时覆盖 `/gtm.js` 与 `/gtag/js`)。最后一环以 DevTools 的 Initiator 列为实证。

两个脚本的响应头均为 `Cache-Control: private, max-age=900`,缓存 15 分钟。排查时若勾了 DevTools 的 **Disable cache**,每次刷新都会重新下载,看起来像每次都在重复加载。

## store_cookies 桥接 (Cookie Bridge)

结账页把店面写下的第一方 cookie POST 到 Stape 的 `/data` 端点,sGTM 以 checkout token 为键存入 Firestore。前端 purchase 事件丢失时,订单 webhook 可以凭 `checkout_token` 回查这份记录补齐归因。

### Payload

| 字段 | 来源 |
| --- | --- |
| `event` | 固定 `store_cookies` |
| `cart_token` | `checkout.token`。字段名沿用线上已部署 sGTM 的 `cart_token`(不可改),但**值是 checkout token**,对应订单 webhook 的 `checkout_token`,而非 webhook 的 `cart_token` |
| `_ga` | `_ga` cookie 原值 |
| `_ga_<g_id>` | GA4 session cookie 原值(键名随 `measurement_id` 变化) |
| `ga_client_id` | 从 `_ga` 解析(取末两段);失败回退随机 UUID |
| `ga_session_id` | 从 `_ga_<g_id>` 解析,兼容 `GS1` / `GS2` 两种格式;失败回退当前 unix 秒 |
| `fbp` / `fbc` | `_fbp` / `_fbc` cookie |
| `shopify_customer_id` | `checkout.customer.id`(可为 `null`) |
| `gtm_dd_sep_campaign` / `_content` / `_medium` / `_source` / `_source_platform` / `_term` | 店面 GTM 写入的 UTM cookie |

所有 cookie 均通过沙箱的 `browser.cookie.get()` 并行读取。

### 触发与重试

| Shopify 事件 | 作用 |
| --- | --- |
| `checkout_started` | 首次发送(同时 `loadGTM()`) |
| `checkout_contact_info_submitted` | 重试 |
| `checkout_address_info_submitted` | 重试 |
| `checkout_shipping_info_submitted` | 重试 |
| `payment_info_submitted` | 重试 |
| `checkout_completed` | 重试 |

`checkout_started` 只有一次机会,请求若被页面卸载打断,该订单就再也无法归因。后续每个结账步骤都携带同一个 `checkout.token`,重发一次即可兜底;顺利时只是一次短路,不产生额外写入。

两个模块级 Set 保证幂等:

- `sentCheckoutTokens` —— 已被 sGTM 以 2xx 确认的 token,后续事件直接短路。发送失败的 token 不会进来,所以下一步会自动重试。
- `inFlightCheckoutTokens` —— 请求已发出但未收到响应的 token。结账步骤可能在同一个 tick 内触发,若只看 `sentCheckoutTokens`,会在首个响应回来之前漏过去,导致同一 token 在 Firestore 里写两次。该 Set 在第一个 `await` 之前同步占位。

这组订阅**不受 `track*` 开关控制** —— 它服务的是订单归因而非 GA4 报表,必须在开关关闭时依旧工作。

## 设计要点 (Design Notes)

- **价格按实付计算**:优先使用 `finalLinePrice` / `cost.totalAmount`,逐项还原折扣 (discount) 与优惠码 (coupon),仅 `DISCOUNT_CODE` 类型计入 coupon。
- **GA id 纯 cookie 解析**:直接读 `_ga` / `_ga_<g_id>` 解出 client id 与 session id,不走 gtag 回调,因此没有超时等待;解析失败分别回退随机 UUID 与当前 unix 秒。
- **cookie 立即发送,不设延时**:这些 cookie 由店面 GTM 在进入结账之前就已写好,等待不会等出新值,只会拉长「页面卸载打断请求」的窗口。`keepalive` 保的是已发出的请求,救不了从没发出的请求。
- **`fetch` 使用 `keepalive`**:页面跳转进结账时请求仍能完成。
- **GA4 ecommerce 重置**:携带 `ecommerce` 的事件在推送后追加 `dataLayer.push({ ecommerce: null })`,防止连续事件的 item 数据互相污染。

## 追踪的事件与参数 (Tracked Events & Parameters)

每个事件都可在 `config.conversionTracking` 的对应 `track*` 开关中独立启停;所有事件都携带下方**公共字段**。

### 公共字段 (Common Fields)

所有事件都携带以下字段,各 handler 从 `event.context.document` 就地读取:

| 参数 | 来源 | 说明 |
| --- | --- | --- |
| `event` | — | 推送到 dataLayer 的事件名 |
| `page_location` | `document.location.href` | 当前页 URL |
| `page_referrer` | `document.referrer` | 来源页 |
| `page_title` | `document.title` | 页面标题 |

Pixel 加载时还会用 `init.context.document` 先推一条**不带 `event` 名**的页面上下文(同样三个字段)到沙箱 dataLayer,作为后续事件的默认值。

### 商品对象 (Item Object)

GA4 `ecommerce.items[]` 有三种构造方式,下方各事件会引用:

**A. 变体商品** —— 在 `cus_view_item` / `cus_add_to_cart` / `cus_remove_from_cart` 各自的 handler 内联构造

| 参数 | 来源 |
| --- | --- |
| `item_id` | `product.id` |
| `item_name` | `product.title` |
| `affiliation` | `config.store.affiliationName`(店铺名) |
| `item_brand` | `product.vendor` |
| `item_category` | `product.type` |
| `item_variant` | `sku` \|\| `title` |
| `price` | `price.amount` |
| `quantity` | 数量 |

**B. 结账 / 购物车行** —— `processCheckoutProducts()`,用于 `cus_view_cart` / 各 checkout 步骤 / `cus_purchase`。在 A 的基础上增加:

| 参数 | 来源 |
| --- | --- |
| `coupon` | 行级 `DISCOUNT_CODE` 优惠码(多个用逗号拼接) |
| `discount` | 每单位折扣额(由实付价还原) |
| `index` | 行序号(从 1 起) |

> 注:此处 `price` 为**折后每单位实付价**(`finalLinePrice / quantity`),而非原价。

**C. 商品列表** —— `cus_view_item_list` 内联构造。字段同 A(无 `sku` 级 `item_variant`),并额外带 `index`、`item_list_id`、`item_list_name`。

### 事件明细 (Event Details)

下表按事件列出,标题为推送到 dataLayer 的事件名,参数表仅列**公共字段之外**的字段。

#### `cus_page_view` — 页面浏览

**Shopify 事件** `page_viewed` · **开关** `trackPageViews`

无额外参数。

> 该事件直接调 `window.dataLayer.push`,不走 `pushEventToDataLayer`,因此**不会镜像给父页面** —— 只有结账页(`loadGTM()` 已把 GTM 注入沙箱)才会被消费。店面的页面浏览由 theme.liquid 里那次 `cus_page_view` 负责;两者在结账页会各报一次,如需去重可关掉 `trackPageViews`。

#### `custom_click_storefront` / `custom_click_link_storefront` — 店面点击

**Shopify 事件** `custom_click` / `custom_link_click` · **开关** `trackClicks`

| 参数 | 来源 |
| --- | --- |
| `data` | `event.customData`(原样透传) |

#### `custom_click_checkout` — 结账内点击

**Shopify 事件** `clicked` · **开关** `trackClicks`

| 参数 | 来源 |
| --- | --- |
| `data.click_element` | `element.tagName` |
| `data.click_id` | `element.id` |
| `data.click_classes` | `element.className` |
| `data.click_text` | `element.textContent` \|\| `element.value` |
| `data.click_target` | `element.target` |
| `data.click_url` | `element.href` |

> 仅当 Pixel 初始化时的 URL 含 `/checkouts/` 才注册该订阅。

#### `cus_view_search_results` — 站内搜索

**Shopify 事件** `search_submitted` · **开关** `trackSearch`

| 参数 | 来源 |
| --- | --- |
| `search_term` | `searchResult.query` |

#### `form_submit` — 表单提交

**Shopify 事件** `form_submitted` · **开关** `trackFormSubmit`

| 参数 | 来源 |
| --- | --- |
| `form_action` | `element.action` |
| `form_id` | `element.id` |

> 跳过 `action` 含 `/cart/add` 的加购表单(由 `cus_add_to_cart` 单独追踪)。

#### `cus_view_item_list` — 浏览商品列表

**Shopify 事件** `collection_viewed` · **开关** `trackViewItemList`

| 参数 | 来源 |
| --- | --- |
| `ecommerce.item_list_id` | `collection.id` |
| `ecommerce.item_list_name` | `collection.title` |
| `ecommerce.items[]` | 商品对象 **C** |

#### `cus_view_item` — 浏览商品详情

**Shopify 事件** `product_viewed` · **开关** `trackViewItem`

| 参数 | 来源 |
| --- | --- |
| `ecomm_prodid` | `shopify_<country>_<product>_<variant>` |
| `ecommerce.currency` | `price.currencyCode` |
| `ecommerce.value` | `price.amount` |
| `ecommerce.items[]` | 商品对象 **A**(单件) |

#### `cus_add_to_cart` / `cus_remove_from_cart` — 加入 / 移出购物车

**Shopify 事件** `product_added_to_cart` / `product_removed_from_cart` · **开关** `trackAddToCart` / `trackRemoveFromCart`

| 参数 | 来源 |
| --- | --- |
| `ecomm_prodid` | `shopify_<country>_<product>_<variant>` |
| `ecommerce.currency` | `merchandise.price.currencyCode` |
| `ecommerce.value` | 单价 × 加购/移除数量 |
| `ecommerce.items[]` | 商品对象 **A** |

#### `cus_view_cart` — 查看购物车

**Shopify 事件** `cart_viewed` · **开关** `trackViewCart`

| 参数 | 来源 |
| --- | --- |
| `ecomm_prodid` | 各行 prodid 逗号拼接 |
| `ecommerce.currency` | `cart.cost.totalAmount.currencyCode` |
| `ecommerce.value` | `cart.cost.totalAmount.amount` |
| `ecommerce.coupon` | 订单级 `DISCOUNT_CODE` 优惠码 |
| `ecommerce.items[]` | 商品对象 **B** |

#### `cus_begin_checkout` / `cus_add_shipping_info` / `cus_add_payment_info` — 结账步骤

**Shopify 事件** `checkout_started` / `checkout_shipping_info_submitted` / `payment_info_submitted` · **开关** `trackBeginCheckout` / `trackAddShippingInfo` / `trackAddPaymentInfo`

三者 payload 结构一致;`checkout_started` 还会触发 `loadGTM()` 与首次 cookie 桥接。

| 参数 | 来源 |
| --- | --- |
| `ecomm_prodid` | 各行 prodid 逗号拼接 |
| `ecommerce.currency` | `checkout.currencyCode` |
| `ecommerce.value` | `checkout.subtotalPrice.amount` |
| `ecommerce.coupon` | 订单级 `DISCOUNT_CODE` 优惠码 |
| `ecommerce.items[]` | 商品对象 **B** |
| `ecommerce.shipping_tier` | 仅 `cus_add_shipping_info`:配送方式名称 |

#### `cus_purchase` — 下单完成

**Shopify 事件** `checkout_completed` · **开关** `trackPurchase`

该 handler 会再调一次 `loadGTM()`。

顶层字段:

| 参数 | 来源 |
| --- | --- |
| `cart_token` | `checkout.token`。字段名沿用线上已部署 sGTM 的 `cart_token`(不可改),但**值是 checkout token**,对应订单 webhook 的 `checkout_token`,而非 webhook 的 `cart_token` |
| `ecomm_prodid` | 各行 prodid 逗号拼接 |
| `user_email` | `checkout.email` |
| `user_data.address.*` | `first_name` / `last_name` / `street` / `city` / `region` / `postal_code` / `country`,优先配送地址,回退账单地址 |
| `total_value_before_discount` | 折前总额(各行原单价 × 数量) |
| `total_value_after_discount` | `subtotalPrice`(折后、税/运费前) |
| `total_value_without_tax_shipping` | 同上 |
| `total_value_with_tax_shipping` | `totalPrice`(含税含运费) |

`ecommerce` 字段:

| 参数 | 来源 |
| --- | --- |
| `transaction_id` | `order.name` \|\| `order.id` \|\| `checkout.token` |
| `affiliation` | 店铺名 |
| `currency` | `checkout.currencyCode` |
| `value` | `subtotalPrice`(折后、税/运费前) |
| `tax` | `totalTax.amount` |
| `shipping` | `shippingLine.price.amount`(回退 order 运费) |
| `shipping_tier` | 配送方式名称 |
| `coupon` | 订单级 `DISCOUNT_CODE` 优惠码 |
| `discount` | `discountsAmount.amount`(订单级折扣总额) |
| `payment_type` | `transactions[0].gateway` |
| `items[]` | 商品对象 **B** |
