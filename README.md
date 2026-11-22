# 🌾 临渊羡鱼 · 导航页

一个美观的个人导航页面，支持动态背景、一言 API、深浅色模式切换，并带有完整的后台管理功能。

部署于 Cloudflare Pages + Workers，完全免费，无需服务器。

---

## ✨ 功能特性

- 🎨 暖纸墨色毛玻璃 UI（OKLCH 色彩系统）
- 🌓 深浅色模式切换（前后台统一 `theme` key）
- 🖼️ 动态背景淡入淡出轮转（12s 间隔）
- 💬 一言 API 集成（自动回退本地句子）
- ⏱️ 网站运行时间统计
- 🔗 导航链接云端管理（KV 持久化）
- 📝 站点标题/副标题/建站日期自定义
- 🔐 JWT 认证后台（登录限流 + 服务端令牌验证）
- 🛡️ XSS 防护：渲染走 DOM API + `textContent`，不拼接 HTML
- ☁️ 双平台部署：Cloudflare Pages/Workers ／ 腾讯云 EdgeOne Makers（同一仓库）
- 💾 增删改自动同步到 KV
- 📱 响应式设计，适配移动端
- ⚡ 首屏优化：链接数据注入 HTML（免等接口）、静态资源边缘缓存、图标按需小并发加载
- 🔍 部署自诊断：`/api/health` 自述 KV 绑定、读写权限与环境变量状态

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JavaScript（零框架） |
| 后端 | Cloudflare Workers（纯 JS，无外部依赖） |
| 存储 | Cloudflare KV |
| 认证 | JWT（HMAC-SHA256） |
| 部署 | Cloudflare Pages ／ 腾讯云 EdgeOne Makers（二选一，同一仓库均可） |

---

## 📁 项目结构

```
nav-iyqi/
├── index.html              # 主导航页（内联样式/脚本，避免首屏 FOUC）
├── admin.html              # 后台管理页
├── admin.js                # 后台逻辑
│
├── shared/
│   ├── core.js             # 【唯一来源】后端平台无关逻辑（JWT/校验/默认数据）
│   └── frontend.js         # 【唯一来源】前端公共层（存储键/接口路径/主题）
├── scripts/build.js        # 统一构建入口：注入前端公共层 + 生成两平台后端产物
│
├── _worker.js              # 【生成】Cloudflare Worker（勿手改）
├── edge-functions/         # 【生成】EdgeOne 函数（勿手改）
│   └── api/{health,links,settings}.js, api/auth/{login,verify}.js
├── edgeone.json            # EdgeOne 部署配置
│
├── wrangler.toml           # Cloudflare 部署配置
├── .dev.vars.example       # 本地开发环境变量模板
├── package.json            # 项目配置
├── LICENSE                 # MIT 许可证
└── README.md               # 说明文档
```

> **生成物说明**：带【生成】标记的文件、以及 `index.html`/`admin.html` 中的
> `@inject:frontend-common` 注入区，均由 `npm run build` 产出，**请勿手改**。
>
> - 改后端逻辑（JWT/校验/接口）→ 改 `shared/core.js`
> - 改存储键 / 接口路径 / 主题逻辑 → 改 `shared/frontend.js`
> - 改完执行 `npm run build` 同步到所有产物
>
> **为什么内联而不拆成外部文件**：`applyTheme` 必须首屏渲染前执行，外链会延迟导致
> 主题闪白；内联 + 单一源生成可同时保证一致性与首屏速度。

---

## 🚀 部署教程

### 前置要求

- Cloudflare 账号
- Node.js（v16+）
- Wrangler CLI（`npm install -g wrangler`）

### 步骤 1：克隆项目

```bash
git clone git@github.com:jeio258/nav-iyqi.git
cd nav-iyqi
npm install
```

### 步骤 2：创建 KV 命名空间

```bash
wrangler kv:namespace create "NAV_LINKS"
```

将输出的 `id` 填入 `wrangler.toml`：

```toml
[[kv_namespaces]]
binding = "NAV_LINKS"
id = "你的KV_ID"
```

### 步骤 3：设置环境变量（⚠️ 必须，不可跳过）

部署前**必须**设置三个 secret，否则 Worker 将拒绝启动。

**本地开发：**

```bash
# 复制模板并填入实际值
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入你的用户名、密码和 JWT 密钥
```

**.dev.vars 内容：**
```
ADMIN_USERNAME=admin
ADMIN_PASSWORD=你的密码
JWT_SECRET=你的JWT密钥（至少32位）
```

**部署到 Cloudflare Pages：**

```bash
# JWT 签名密钥（至少 32 位随机字符串）
wrangler pages secret put JWT_SECRET
# 输入例如: openssl rand -base64 32 生成的字符串

# 管理员密码
wrangler pages secret put ADMIN_PASSWORD
# 输入你的密码

# 管理员用户名
wrangler pages secret put ADMIN_USERNAME
# 输入你的用户名
```

> ⚠️ 注意：Pages 项目必须用 `wrangler pages secret put`，**不是** `wrangler secret put`。

### 步骤 4：部署

```bash
wrangler pages deploy .
```

部署成功后会显示访问地址：

```
✨ Deployment complete!
🔗 https://nav-xxx.pages.dev
```

### 步骤 5：配置自定义域名（可选）

Cloudflare Dashboard → Workers & Pages → 你的项目 → Custom domains → 添加域名。

---

## 📝 使用说明

### 前台导航页

访问首页即可看到导航链接，默认包含 6 个预设链接。

### 后台管理

1. 访问 `/admin.html`，例如 `https://你的域名/admin.html`
2. 使用设置的管理员账户登录
3. 添加、编辑、删除导航链接
4. 修改站点标题、副标题、建站日期
5. 保存后自动同步到 Cloudflare KV，前台实时更新

### 默认链接

| 名称 | 地址 |
|------|------|
| 临渊羡鱼博客 | https://blog.fnosi.top |
| 临渊羡鱼图床 | https://imge.fnosi.top |
| 文件快递柜 | https://file.fnosi.top |
| 飞牛NAS | https://fnos.fnosi.top |
| 临渊羡鱼资源站 | https://list.fnosi.top |
| 临渊羡鱼标签页 | https://tab.fnosi.top |

---

## 🔧 自定义配置

### 修改背景图片

编辑 `index.html` 中的 `bgImages` 数组：

```javascript
bgImages: [
    'https://your-image-1.jpg',
    'https://your-image-2.jpg',
    // 可继续添加...
]
```

### 修改轮转 / 一言间隔

```javascript
bgRotateInterval: 12000,   // 背景切换间隔（毫秒）
hitokotoInterval: 10000,   // 一言刷新间隔（毫秒）
```

### 修改默认链接

编辑 **`shared/core.js`** 中的 `DEFAULT_LINKS` 数组（KV 不可用时的回退数据），
然后执行 `npm run build` 同步到两平台产物。

> 改为后台管理页维护即可，无需改代码——`DEFAULT_LINKS` 只是 KV 异常时的兜底。

### 修改存储键 / 接口路径 / 主题

编辑 **`shared/frontend.js`** 中的 `NAV` 常量对象：

```javascript
NAV.storage   // localStorage 键名（前后台必须一致）
NAV.api       // 接口路径
NAV.themeColor // 深浅色下的地址栏颜色
```

改完执行 `npm run build`，会注入到 `index.html` 与 `admin.html`。

> 切勿直接在页面里改这些值：两页面 + 后台脚本共用同一份定义，
> 分散修改会出现「后台写入与前台读取的键不一致」这类问题。

---

## 🔌 API 接口

| 方法 | 路径 | 说明 | 认证 | 速率限制 |
|------|------|------|------|----------|
| POST | `/api/auth/login` | 管理员登录 | ❌ | 8次/分钟 |
| GET | `/api/auth/verify` | 验证令牌 | ✅ | - |
| GET | `/api/links` | 获取链接列表 | ❌ | - |
| PUT | `/api/links` | 更新链接列表 | ✅ | - |
| GET | `/api/settings` | 获取站点设置 | ❌ | - |
| PUT | `/api/settings` | 更新站点设置 | ✅ | - |
| GET | `/api/health` | 健康检查 + 部署自诊断 | ❌ | - |

### 健康检查 / 部署自诊断

`GET /api/health` 不仅返回服务状态，还**自述部署状态**，用于一次性定位
「KV 绑定 / 环境变量 / 读写权限」问题，无需来回猜测。

```bash
curl https://your-domain.com/api/health
```

EdgeOne 部署的完整返回示例：

```json
{
  "status": "ok",
  "kv": true,
  "kvBound": true,
  "kvSources": {
    "globalNAV_LINKS": "object",
    "contextEnvNAV_LINKS": "absent"
  },
  "envs": { "ADMIN_USERNAME": true, "ADMIN_PASSWORD": true, "JWT_SECRET": true },
  "kvReadable": true,
  "kvProbeValue": "null",
  "expectedBindingName": "NAV_LINKS",
  "runtime": "edgeone"
}
```

字段含义：

| 字段 | 含义 |
|------|------|
| `kv` / `kvBound` | 是否成功取得 KV 对象（`true` 即绑定成功） |
| `kvSources.globalNAV_LINKS` | 全局变量形态状态：`object` 可用 / `undefined` 未注入 / `throw` 异常 |
| `kvSources.contextEnvNAV_LINKS` | `context.env` 形态状态：`object` / `absent` 无此变量 / `not-kv` 有值但不是 KV 对象 |
| `kvReadable` | 实际读一次的结果，验证读写权限 |
| `kvProbeValue` | 探测键的值，`null` 表示键不存在（正常，不代表绑定失败） |
| `envs` | 三个环境变量是否就位（只报有无，不回显值） |
| `expectedBindingName` | 控制台里应填的绑定变量名 |

> **反直觉提醒**：`kvProbeValue: "null"` 只说明该探测键没有数据，
> **不代表 KV 未绑定**。以 `kvBound` 与 `kvReadable` 为准。

### 登录

```bash
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
```

响应：

```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": { "username": "admin", "role": "admin" },
  "expiresIn": 3600
}
```

### 更新链接

```bash
curl -X PUT https://your-domain.com/api/links \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"links":[{"id":"1","name":"Google","url":"https://google.com","fallback":"G","status":"active","order":0}]}'
```

---

## 🔐 安全说明

| 措施 | 说明 |
|------|------|
| JWT 认证 | HMAC-SHA256 签名，1 小时过期 |
| 速率限制 | 登录接口 8次/分钟/IP，返回 429 |
| XSS 防护 | 渲染统一走 DOM API + `textContent`（不拼接 HTML）；服务端只做截断 |
| URL 校验 | 仅允许 http/https 协议（拒绝 `javascript:` 等） |
| 凭据存储 | Cloudflare 用 `wrangler pages secret`；EdgeOne 用控制台环境变量，均不回显 |
| HTTPS | Cloudflare / EdgeOne 均自动签发证书 |
| CORS | 已配置跨域访问控制 |
| 数量限制 | 链接上限 200 条，字段长度限制 |

### 安全建议

1. **JWT_SECRET 至少 32 位随机字符串**：`openssl rand -base64 32`
2. **使用强密码**：避免常见密码
3. **限制管理页面访问**：在 Cloudflare Dashboard 中设置 WAF 规则
4. **定期轮换密钥**：更新 JWT_SECRET 和 ADMIN_PASSWORD

---

## 🧪 本地开发

```bash
# 1. 安装依赖
npm install

# 2. 创建本地环境变量文件（首次必须）
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars 填入实际值

# 3. 启动开发服务器
npx wrangler pages dev . --local
# 访问 http://localhost:8788
```

> `--local` 下 wrangler 会提供**本地 KV 模拟**，读写与线上一致（启动后访问
> `/api/health` 应看到 `"kv": true`）。只有 KV 绑定异常时才回退默认链接数据。

### 修改代码后重新生成产物

后端逻辑与前端公共层是「单一源生成」模式，**改了源文件必须重新生成**：

```bash
npm run build
```

| 要改什么 | 改哪里 |
|----------|--------|
| 后端逻辑（JWT / 校验 / 接口） | `shared/core.js` |
| 存储键 / 接口路径 / 主题逻辑 | `shared/frontend.js` |
| 页面文案与样式 | `index.html` / `admin.html` |
| 改完统一执行 | `npm run build` |

> 生成物（`_worker.js`、`edge-functions/api/*.js`、以及两个 HTML 里的
> `@inject:frontend-common` 注入区）**请勿手改**，下次构建会被覆盖。

---

## ☁️ 部署到腾讯云 EdgeOne Makers

本项目同时支持 EdgeOne，与 Cloudflare 版并存于同一仓库（`_worker.js` 供 Cloudflare，
`edge-functions/` 供 EdgeOne，互不干扰）。

### 步骤 1：创建项目
1. 打开 <https://console.cloud.tencent.com/edgeone/makers>
2. 创建项目 → **导入 Git 仓库** → 选本仓库、分支 `main`
3. 构建命令**留空**（无需构建），输出目录填 `./`
4. 部署

### 步骤 2：开通并绑定 KV（必须）
1. 控制台 → **存储 - KV** → 首次需点「**立即申请**」开通（免费额度 1GB）
2. **创建命名空间**
3. 回项目 → **KV 存储** → **绑定命名空间** → **变量名必须填 `NAV_LINKS`**

> **KV 的注入形态**（实测确认）：绑定的「变量名」会作为**全局变量**注入运行环境，
> 代码里直接写 `NAV_LINKS.get(...)` 即可（这也是官方示例的写法）。
> 本项目同时兼容 `context.env.NAV_LINKS` 形态，两种都能取到。
>
> 变量名**区分大小写、不能带空格**，必须与代码里的 `NAV_LINKS` 完全一致。

### 步骤 3：配置环境变量（必须）
项目 → **设置** → **环境变量**，添加：

```
ADMIN_USERNAME=你的管理员用户名
ADMIN_PASSWORD=你的管理员密码
JWT_SECRET=至少32位随机字符串
```

### 步骤 4：验证
访问 `你的域名/api/health`，重点看三个字段：

```json
{ "kvBound": true, "kvReadable": true, "runtime": "edgeone" }
```

| 字段 | 期望值 | 含义 |
|------|--------|------|
| `kvBound` | `true` | KV 绑定成功 |
| `kvReadable` | `true` | 读写权限正常 |
| `runtime` | `"edgeone"` | 确认跑的是 EdgeOne 版本 |

再对照 `kvSources` 与 `envs`，可精确看出卡在哪一环（字段详解见
[健康检查 / 部署自诊断](#健康检查--部署自诊断)）。

最后做一次真实闭环：**登录后台 → 添加一个链接 → 保存**，
出现「✅ 已同步到云端」即全部链路打通。

### 部署问题对照表

| 现象 | 原因 | 解决 |
|------|------|------|
| `kvSources` 两项都是 `undefined` / `absent` | 绑定未生效 | 步骤 2，变量名必须为 `NAV_LINKS` |
| `contextEnvNAV_LINKS: "not-kv"` | 变量名对了但绑的不是 KV | 检查绑的是命名空间，不是其他资源 |
| `kvBound: true` 但 `kvReadable: false` | 绑定成功但无读写权限 | 检查命名空间额度/权限 |
| `envs` 中有 `false` | 环境变量缺失 | 步骤 3 补齐 |
| 登录报「服务器未配置环境变量」 | 同上 | 同上 |
| 保存报「KV 存储未绑定」 | 跑的是旧代码 | 控制台**重新部署**到最新提交 |
| `/api/health` 404 | 函数目录未识别 | 确认仓库含 `edge-functions/api/health.js` |
| `kvProbeValue: "null"` | **这不是错误** | 探测键无数据而已，看 `kvBound` 即可 |

---

## 🐛 常见问题

**Q: 部署后 Worker 报错 / 登录提示"用户名或密码错误"**

A: 检查以下几点：
1. 本地开发：确认已创建 `.dev.vars` 文件（`cp .dev.vars.example .dev.vars`）并填入了正确的值
2. 部署环境：确认使用 `wrangler pages secret put`（不是 `wrangler secret put`）
3. 验证 secret 已生效：`wrangler pages secret list`
4. 在 Cloudflare Dashboard → Workers & Pages → 你的项目 → Settings → Environment variables 确认变量存在

**Q: 后台管理页面无法登录**

A: 检查 secret 是否正确设置：`wrangler secret list`

**Q: 前台显示默认链接而非后台设置的链接**

A: 确认 wrangler.toml 中 KV namespace id 是否正确，且已点击保存。

**Q: 如何重置 KV 数据**

A: Cloudflare Dashboard → Workers & Pages → KV → NAV_LINKS → 删除 `links` 和 `settings` 键。
EdgeOne：控制台 → 存储 - KV → 命名空间详情 → 删除 `links` 与 `settings` 记录。

**Q: EdgeOne 上控制台显示 KV 里没有数据，是不是没绑定成功？**

A: **不是。**「KV 里没数据」与「KV 未绑定」是两件事。以 `/api/health` 的
`kvBound` 与 `kvReadable` 为准——两者为 `true` 就说明绑定与读写都正常，
只是还没写入过数据（首次保存链接后才会出现 `links` / `settings` 键）。

**Q: EdgeOne 后台保存链接报「KV 存储未绑定」，但 health 显示已绑定**

A: 说明那次请求跑的是**旧版本代码**。在 EdgeOne 控制台**重新部署**
（触发一次构建），确保部署到最新提交后再试。

**Q: 两个平台（Cloudflare / EdgeOne）会互相影响吗？**

A: 不会。`_worker.js` 供 Cloudflare，`edge-functions/` 供 EdgeOne，
各自独立、代码来源同为 `shared/`。同一个仓库可同时部署到两处。

---

## 🔄 更新日志

### v1.2.0 (2026-11)

- ☁️ 新增腾讯云 EdgeOne Makers 部署支持（`edge-functions/` + `edgeone.json`）
- 🔧 代码结构：后端逻辑收敛到 `shared/core.js`，前端公共层收敛到 `shared/frontend.js`
  （存储键 / 接口路径 / 主题），统一由 `npm run build` 生成到两平台产物与两个页面，
  消除「同一存储键多处硬编码」导致的改 A 坏 B
- 🔍 `/api/health` 升级为部署自诊断：自述 KV 绑定形态、读写权限、环境变量就位情况
- 🐛 EdgeOne KV 取值兼容「全局变量」与「context.env」两种注入形态，并校验值确为 KV 对象
- ⚡ 首屏：Worker 注入链接数据到 HTML（首访免等接口）、Cache API 边缘缓存、
  CSP 阻断统计脚本、移除 103KB 自托管字体（总传输 135KB → 32KB）
- 🐛 修复有缓存路径卡片不可见（禁用入场动画未恢复 opacity）
- 🐛 修复后台改链接后首页需刷新两遍（no-store + 更新时间戳失效缓存）

### v1.1.0 (2025-07)

- 🛡️ 移除硬编码默认凭据，强制环境变量配置
- 🛡️ 全链路 XSS 防护（escapeHtml + 服务端清理）
- 🛡️ 登录速率限制（8次/分钟/IP）
- 🛡️ 服务端令牌验证 + URL 合法性校验
- ⚡ 延迟加载优化：背景/一言异步，首屏优先
- 🎯 胶囊链接文字居中
- 🎨 危险按钮样式匹配 design.md 规范
- 🧹 清理 package.json 冗余依赖
- 📄 添加 MIT LICENSE 文件

### v1.0.0 (2024-01)

- 🎉 初始版本发布
- ✅ 导航页面 + 后台管理 + KV 存储 + JWT 认证

---

## 📄 许可证

[MIT](LICENSE)

---

## 👤 作者

**临渊羡鱼**

- 博客：[blog.fnosi.top](https://blog.fnosi.top)
- GitHub：[jeio258/nav-iyqi](https://github.com/jeio258/nav-iyqi)

---

⭐ 如果这个项目对你有帮助，请给一个 Star！
