# MODESEES

一个女装店面，跑在 Shopify 的 **Paris** 主题上而不是 Dawn —— 浏览器端的选择器
与另外两个客户几乎没有交集。两个容器是从 eco-worthy 克隆来的，开工时还带着
它的缺陷，见下方 [克隆容器带来的缺陷](#克隆容器带来的缺陷)。

**什么都还没部署。** 截至 2026-08-20，`modesees.com` 上没有任何 GTM 容器 ——
只有 Shopify 自带的 gtag(`G-F5R3YM4Z73`)和两个 Google Ads tag。两个 GTM
workspace 里都是未发布的草稿，所以 GTM Preview 连不上店面，也没有任何端到端
验证过的东西。

## 标识符

| 占位符 | 值 |
| --- | --- |
| `<gtm-web-container-id>` | `GTM-KD9BJV54` —— account `6369409954`，container `260123513`，名为 `Modesees web GTM` |
| `<gtm-server-container-id>` | `GTM-538Z4G6H` —— account `6369409954`，container `260817352`，名为 `Modesees sGTM` |
| `<stape-container-identifier>` | `qbgxbxdc` |
| `<container-loading-path>` | `https://load.securedata.modesees.com` |
| `<tagging-server-url>` | `https://securedata.modesees.com` —— 它和 loading path 的 `/healthy` 都返回 200 |
| `<gcp-project>` | `modesees01`，数据库 `(default)`，FIRESTORE_NATIVE，us-central1 |

Loader 脚本 `28eqbgxbxdc.js` —— 前缀 `28e` + 容器标识 `qbgxbxdc`，query
string `3fev=CgBFJSwqTzonXTooLlJWVxVZSkxJQQYfXgkXBh0UBxQQShsNFQ%3D%3D`。两者
都出自 Shopify 的 Stape Conversion Tracking app 生成的 GTM 代码。已验证返回
200，且下发的 bundle 里含 `GTM-KD9BJV54`;不带 query string 的裸路径返回 404，
所以这一对只有成对使用才有效。`theme-liquid.html` 硬编码的 URL 与 pixel 用
常量拼出的是同一个，改要一起改。

Firestore 于 2026-08-20 从零创建(该项目此前 `firestore.googleapis.com` 未
启用，也没有数据库)。服务账号 `stape-sgtm@modesees01.iam.gserviceaccount.com`，
角色 **Cloud Datastore User**，JSON key 上传在 Stape —— 这是标准授权，见
[安全考量](../../ARCHITECTURE.md#安全考量)。数据库为 Restrictive。

## 店铺

| 店铺 | Hostname | Shop domain | Measurement ID |
| --- | --- | --- | --- |
| production | `modesees.com` | `yxz5tg-xz.myshopify.com` | `G-5LSR0MTS2B` |
| test | `modesees-fs-test.myshopify.com` | 同左 | `G-4FLMVWWG56` |

`www.modesees.com` 会 301 到裸域，所以 `{{Page Hostname}}` 永远是
`modesees.com`，web 的 Lookup Table 只需要一行。shop domain 是随机生成的店铺
名，和品牌毫无相似之处 —— 服务端的表按它取键，所以两张表没有任何共同的键。

## checkout token 的名字在这里被纠正

modesees 发的是 **`checkout_token`**，不是
[join 契约](../../ARCHITECTURE.md#join-契约)在 eco-worthy 上冻住的那个
`cart_token` 误称。纠正是在任何东西上线之前做的，按那一节列出的四处原子改动
完成:pixel 的字段、`ED - checkout_token` 的 keyPath，以及
`Firestore - ga_client_id` 和 `Firestore - ga_session_id` 两者的 queryKey。

> 这也是 `main` 现在带的名字，所以新客户继承的是它。不要把它推到 eco-worthy ——
> 那个容器已上线，读的是 `cart_token`。

webhook 一侧本来就是对的 —— Shopify 自己的 `checkout_token` —— 所以
`ED - webhook_checkout_token` 没有改动。纠正之后它和 `ED - checkout_token`
配置完全相同，只是读取的事件不同;两个都保留，是为了让每个值的来源仍然可见。

## Paris 主题

两个交互追踪 tag 是从 eco-worthy 的 Dawn 版本重写的;
[交互追踪 tag 的一致性](../../ARCHITECTURE.md#交互追踪-tag-的一致性)讲了哪些
东西可以通用到任何主题。共享的模块名是 `window.dlIdentifyModule` ——
eco-worthy 那个 `ecoworthyIdentifyModule` 已经没有了。

与 Dawn 的差异，以及为什么这次移植不是换选择器:

- **是 Flickity，不是 Swiper。** 所有 `[class*="swiper"]` 的规则都是死代码。
- **是 `<product-card>` 自定义元素**，不是 `.card-wrapper`。Paris 没有
  `.grid__item`，所以 v3 那套两段式的商品卡启发式没有必要。
- **三种不稳定 token 全都出现了**，而且 Paris 的 `element_id` 值还带着 Shopify
  的数字 id。
- **section 回退的十六进制防护在这里是承重的** —— 有好几个 Paris section 是用
  裸十六进制 id 命名的。
- **没有博客**，所以 `blog_list` 分支删掉了。Judge.me 存在且无改动。Frequently
  Bought Together(`cbb-*`)渲染在所有 `shopify-section` 之外，需要单独一条规则。

对着 live DOM 实测的 module 覆盖率:首页、集合页、商品详情页分别有
586 / 630 / 511 个可点击元素，各只有一个 `unknown` —— 跳到主内容的链接。
`debug_mode` 在测试期刻意保持 `true`。

> AI 的「三联 banner」section 命名为 **`promo_tiles`** 而不是 `*_banner`，
> 这样 `GA4 - banner_click` 的 `module contains banner` 条件就扫不到它。有两个
> module 值是契约:`hero_banner`，以及任何匹配 `/menu/` 的值。

## 克隆容器带来的缺陷

两个容器都是从 eco-worthy 复制的，连缺陷一起复制了。这里全部修好了;
eco-worthy 那边的原件**仍然在线上**。

- **`DLV - element_id` 读的 key 是 `button_state`** —— 复制粘贴的疏漏，导致这个
  参数永远是空的。pixel 两个 key 都不发，它们只来自 click tracker。
- **`GA4 - social_icon_click` 发的 Event Name 是 `menu_click`**，和
  `GA4 - menu_click` 逐字节相同，连参数表都一样，所以社交点击在 GA4 里和菜单
  点击无法区分。在 eco-worthy 上更糟:13 个社交链接里有 6 个位于
  `.menu-drawer` 内，两个 tag 都会触发，一次点击产生两条完全相同的
  `menu_click` 命中。
- **`element_id` 在三个 tag 的参数表里出现了两次。**
- **跨客户泄漏**:服务端 Lookup Table 的默认值是 eco-worthy 的
  `G-66S3XN5ND0`，`project id` 指向 `eco-worthy-20260701`，`server_url` 指向
  `https://securedata.eco-worthy.com`，`GA4 client` 的 `gtagMeasurementIds` 列
  的是 eco-worthy 的四个 ID。
- **凭据暴露**:`CST - OpenAI Ads API Key` 和它的测试孪生变量里仍然是
  eco-worthy 线上的 `sk-svcacct-…` 服务账号密钥。三个 `OpenAI Ads CAPI - *`
  tag 是暂停的，但任何能访问这个容器的人都能读到这些密钥。

> 这个教训已经写进 GTM 约定，见 [AGENTS.md](../../AGENTS.md#约定)。那份清单里
> 的每一项检查在这里都能查出东西。

## 本客户的未决事项

- **店面上什么都没装。** `modesees.com` 上找不到 `GTM-KD9BJV54`，所以没有
  Preview、没有端到端验证、没有数据。
- **两个容器都从未发布过。** 两者都只有一个版本 1 —— web 那个字面上就叫
  `Empty Container`。今天装上主题片段、或者把 backfill 指向 sGTM，接到的是一个
  里面没有任何 tag 的容器:不写 Firestore、不转发 GA4、也不报错。
- **OpenAI Ads 的密钥还留在 sGTM 容器里** —— 三个 CAPI tag 是暂停的，所以什么
  都不会发出去，但密钥仍然可读。
- **Stape 侧的服务账号密钥上传未验证** —— 只确认了 GCP 一侧(项目、数据库、
  服务账号、角色)。
- **eco-worthy 那两个缺陷的副本还没修**，修不修是客户的决定;两者都会影响 GA4
  的连续性。
- **无论 modesees 是否投放 OpenAI Ads，都应该把那些密钥从这个容器里删掉**，
  并在 eco-worthy 一侧轮换。
- **`Include webhook` 是死配置** —— 它的 `affectedTagTypes` 是 `cvt_P842H`，
  这个容器里没有任何 tag 属于该类型。
- **两处参数名拼写错误**:两个 webhook PageView tag 里的 `cus_hit_timestape`，
  以及 `Write Webhook Transaction ID`(已暂停)里的 `transasction_id`。
- **`cus_hit_timestamp` 可能以 `undefined` 开头**，如在 speediance 上观测到的
  那样 —— 配置相同，但这里未验证。
- **`CJS - click_product_name` 返回的是 URL handle，不是名称。** 首页 42 个
  商品 handle 里有 12 个超过 GA4 的 100 字符上限，而截断会把尾部标识商品的
  款式码切掉。
- **两个零引用的 Event Data 变量**:`ED - fake_client_id` 与 `ED - client_id`
  完全重复，`ED - user_id` 无人使用。
