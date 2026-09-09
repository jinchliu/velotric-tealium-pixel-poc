datalayer：Shopify → GA4 事件推送脚本，用于电商转化追踪。订阅店面与结账事件，
转换成 GA4 风格的 payload 推送到 `dataLayer`，并在结账阶段把
第一方 cookie 桥接到 Stape 服务端 GTM (sGTM)，供订单 webhook 事后回补归因。

整套埋点方案分三部分，本仓库是 **web 端**的全部源码 —— pixel、主题片段，以及
GTM web 容器里那两个 custom HTML tag。另外两部分分别是托管在 Stape 的 sGTM，
以及跑在 Cloud Run 上的 order-backfill。三部分如何协作见
[ARCHITECTURE.md](ARCHITECTURE.md#系统全景)。

## 配置

复用到新店铺时只需改 [shopify/web-pixel.js](shopify/web-pixel.js) 顶部的两个
区块，下方业务逻辑无需改动。

### 1. `config`

```js
const config = {
    conversionTracking: {
        measurementId: 'G-XXXXXXXXXX', // GA4 Measurement ID
        trackPageViews: true,          // 以下为各事件开关 (track*)
        // ...
    },
    store: {
        gmcCountryFallback: 'US',      // GMC item_id 的国家段回退值
        affiliationName: /* 自动取自 init.data.shop.name */,
    },
};
```

| 字段 | 填什么 | 填错会怎样 |
| --- | --- | --- |
| `measurementId` | GA4 数据流 (Data Stream) 的 ID，必须与店面 gtag.js 实际写入的属性一致 | `ga_session_id` 静默回退成时间戳，而 `ga_client_id` 依然正确，不看控制台发现不了 |
| `gmcCountryFallback` | Merchant Center feed 里真实 `item_id` 的国家段 | `item_id` 格式正常但 join 不上任何商品 |

`gmcCountryFallback` 只在 `init` 读不到店铺国家时才生效。

### 2. Stape 常量

```js
const STAPE_CONTAINER_LOADING_PATH = 'https://load.YOUR-DOMAIN.com'; // Stape 容器加载域名
const STAPE_LOADER_SCRIPT_NAME     = 'xxxxxxxxxxx.js';               // loader 文件名
const STAPE_LOADER_QUERY_STRING    = 'xxxx=...';                     // loader query string
```

这三个值分两步取，**后两个在 Stape 后台里看不到**:

**第一步 —— Stape 后台**(Custom Loader power-up → Code & Setup information)
给出三个值:Web GTM ID、Container loading path、Container identifier。其中
Container loading path 就是 `STAPE_CONTAINER_LOADING_PATH`。

**第二步 —— Shopify 的 Stape Conversion Tracking app**。把上面三个值填进去
(sGTM 容器 URL、勾选 Add custom loader、填 Container identifier)，app 会在页面
底部生成一段 GTM 代码。剩下两个常量从这段代码里复制:

```html
j.src="https://load.securedata.example.com/28eqbgxbxdc.js?"+i
...
(window,document,'script','dataLayer','3fev=CgBFJSwq…%3D%3D');
```

| 常量 | 从哪复制 |
| --- | --- |
| `STAPE_LOADER_SCRIPT_NAME` | `j.src` 里的文件名，如 `28eqbgxbxdc.js` |
| `STAPE_LOADER_QUERY_STRING` | 最后一个参数，如 `3fev=CgBFJSwq…%3D%3D` |

文件名是 **app 生成的前缀 + Stape 的 Container identifier**，前缀不可推导 ——
modesees 是 `28e`(3 位)，speediance 是 `3g83`(4 位)。query string 同理，只在
生成的代码里。两者成对使用才有效。

这段生成的代码也正是要贴进 `theme.liquid` 的那段，所以同一个 URL 在
`theme-liquid.html` 和 `web-pixel.js` 里各有一份。

## 部署

### 1. Web Pixel

Shopify 后台 **Settings → Customer events → Add custom pixel**，粘贴
[shopify/web-pixel.js](shopify/web-pixel.js) 全文，填好上述两个区块后保存。

**可选：压缩后再粘贴（以 `terser` 为例）。**交给客户自行部署时通常给一份压缩产物:

```bash
terser shopify/web-pixel.js -o web-pixel.min.js
```

**不要加任何 flag。** 产物是 gitignored 的交付件，不是源码，检查方法见
[排查手册](docs/troubleshooting.md#检查产物-build-artefacts)。

### 2. theme.liquid 接收端

Pixel 跑在 Shopify 的沙箱 iframe 里，事件通过 `postMessage` 镜像给父页面，必须
由主题里的监听器接进顶层 `dataLayer`，顶层 GTM 才消费得到 —— 所以装完 pixel
还得改主题。

完整片段见 [shopify/theme-liquid.html](shopify/theme-liquid.html)，里面是两段
script，整段加到
[`theme.liquid`](https://shopify.dev/docs/storefronts/themes/architecture/layouts)
的 `<head>`：GTM 容器在前尽早加载，下面这段监听器在后。GTM 会持续消费
`dataLayer`，所以监听器放在容器之后也不会漏事件。

```html
<script>
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push({ event: "cus_page_view" });
  window.addEventListener('message', function (event) {
    if (event.data && event.data.event) {
      window.dataLayer.push(event.data);
      window.dataLayer.push({ ecommerce: null });
    }
  });
</script>
```

## 参考文档

| 文档 | 什么时候读 |
| --- | --- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 系统怎么搭的、三端如何协作、关键契约 |
| [AGENTS.md](AGENTS.md) | 在这个仓库里改东西要遵守的规则 |
| [docs/events.md](docs/events.md) | 在 GTM 里配变量，查某个事件发了什么字段 |
| [docs/troubleshooting.md](docs/troubleshooting.md) | 数据看起来正常但对不上 |
| [docs/clients/](docs/clients/) | 各客户的标识符与部署记录 |
