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
- 🔗 导航链接云端管理（Cloudflare KV 持久化）
- 📝 站点标题/副标题/建站日期自定义
- 🔐 JWT 认证后台（速率限制 + 服务端验证）
- 🛡️ 全链路 XSS 防护 + 输入清理
- ☁️ Cloudflare Pages + Workers 零服务器部署
- 💾 增删改自动同步到 KV
- 📱 响应式设计，适配移动端
- ⚡ 延迟加载优化：首屏优先，背景/一言异步

---

## 🛠 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | HTML5 + CSS3 + Vanilla JavaScript（零框架） |
| 后端 | Cloudflare Workers（纯 JS，无外部依赖） |
| 存储 | Cloudflare KV |
| 认证 | JWT（HMAC-SHA256） |
| 部署 | Cloudflare Pages |

---

## 📁 项目结构

```
nav-iyqi/
├── index.html          # 主导航页面
├── admin.html          # 后台管理页面
├── admin.js            # 后台管理脚本
├── _worker.js          # Cloudflare Worker API
├── wrangler.toml       # Cloudflare 部署配置
├── package.json        # 项目配置
├── LICENSE             # MIT 许可证
└── README.md           # 说明文档
```

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

部署前**必须**设置三个 secret，否则 Worker 将拒绝启动：

```bash
# JWT 签名密钥（至少 32 位随机字符串）
wrangler secret put JWT_SECRET
# 输入例如: openssl rand -base64 32 生成的字符串

# 管理员密码
wrangler secret put ADMIN_PASSWORD
# 输入你的密码

# 管理员用户名
wrangler secret put ADMIN_USERNAME
# 输入你的用户名
```

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

编辑 `_worker.js` 中的 `DEFAULT_LINKS` 数组（KV 不可用时的回退数据）。

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
| GET | `/api/health` | 健康检查 | ❌ | - |

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
| XSS 防护 | 全链路 escapeHtml()，输入截断清理 |
| URL 校验 | 仅允许 http/https 协议 |
| 环境变量加密 | 凭据通过 `wrangler secret` 加密存储 |
| HTTPS | Cloudflare 自动提供 SSL 证书 |
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
wrangler pages dev .
# 访问 http://localhost:8788
```

> 本地开发时 KV 存储不可用，将使用默认链接数据。

---

## 🐛 常见问题

**Q: 部署后 Worker 报错 "缺少必需的环境变量"**

A: 必须通过 `wrangler secret put` 设置 `JWT_SECRET`、`ADMIN_PASSWORD`、`ADMIN_USERNAME`。项目不再包含默认值。

**Q: 后台管理页面无法登录**

A: 检查 secret 是否正确设置：`wrangler secret list`

**Q: 前台显示默认链接而非后台设置的链接**

A: 确认 wrangler.toml 中 KV namespace id 是否正确，且已点击保存。

**Q: 如何重置 KV 数据**

A: Cloudflare Dashboard → Workers & Pages → KV → NAV_LINKS → 删除 `links` 和 `settings` 键。

---

## 🔄 更新日志

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
