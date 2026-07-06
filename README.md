🌾 临渊羡鱼 · 导航页
一个美观的个人导航页面，支持动态背景、一言 API、深浅色模式切换，并带有完整的后台管理功能。

部署于 Cloudflare Pages + Workers，完全免费，无需服务器。

📸 预览
浅色模式	深色模式
暖色调毛玻璃风格	深色背景，护眼舒适
✨ 功能特性
🎨 美观的毛玻璃 UI 设计

🌓 深浅色模式切换（前后台统一，使用相同 localStorage key）

🖼️ 动态背景轮转（每 8 秒切换）

💬 一言 API 集成（每 8 秒轮转）

⏱️ 网站运行时间统计

🔗 自定义导航链接（从 Cloudflare KV 动态加载）

🔐 管理员后台（JWT 认证）

☁️ Cloudflare Pages + Workers 部署

💾 自动同步到 Cloudflare KV 存储

📱 响应式设计，支持移动端

🛠 技术栈
层级	技术
前端	HTML5 + CSS3 + Vanilla JavaScript
后端	Cloudflare Workers（纯 JS，无外部依赖）
存储	Cloudflare KV
认证	JWT（HMAC-SHA256）
部署	Cloudflare Pages
📁 项目结构
text
navigation-page/
├── index.html          # 主导航页面
├── admin.html          # 后台管理页面
├── admin.js            # 后台管理脚本
├── _worker.js          # Cloudflare Worker API（纯 JS）
├── wrangler.toml       # Cloudflare 部署配置
├── package.json        # 项目配置
└── README.md           # 说明文档
🚀 部署教程
前置要求
Cloudflare 账号

Node.js（v16 或更高版本）

Git（可选）

步骤 1：克隆/创建项目
bash
# 创建项目目录
mkdir navigation-page
cd navigation-page
将以下文件放入 navigation-page 目录：

index.html

admin.html

admin.js

_worker.js

步骤 2：初始化项目
bash
# 初始化 npm 项目
npm init -y

# 安装 Wrangler CLI
npm install -g wrangler

# 登录 Cloudflare
wrangler login
步骤 3：创建 wrangler.toml
在项目根目录创建 wrangler.toml：

toml
name = "navigation-page"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

pages_build_output_dir = "."
步骤 4：创建 KV 命名空间
bash
# 创建 KV 命名空间
wrangler kv:namespace create "NAV_LINKS"
输出示例：

text
Add the following to your wrangler.toml:
[[kv_namespaces]]
binding = "NAV_LINKS"
id = "abc123def456789..."
将输出的配置添加到 wrangler.toml 中：

toml
name = "navigation-page"
compatibility_date = "2024-01-01"
compatibility_flags = ["nodejs_compat"]

pages_build_output_dir = "."

[[kv_namespaces]]
binding = "NAV_LINKS"
id = "abc123def456789..."  # 替换为你的实际 ID
步骤 5：设置环境变量
bash
# 设置 JWT 密钥（必须，用于加密认证令牌）
wrangler secret put JWT_SECRET
# 输入一个强随机字符串，例如可用命令生成：openssl rand -base64 32

# 设置管理员密码
wrangler secret put ADMIN_PASSWORD
# 输入你的密码，例如：MySecurePass123!

# 设置管理员用户名
wrangler secret put ADMIN_USERNAME
# 输入：admin
步骤 6：部署到 Cloudflare Pages
bash
# 部署
wrangler pages deploy .
部署成功后会显示：

text
✨ Deployment complete!
🔗 https://navigation-page-xxx.pages.dev
步骤 7：配置自定义域名（可选）
进入 Cloudflare Dashboard → Workers & Pages → 你的项目

点击 Custom domains

添加你的域名，例如 nav.fnosi.top

Cloudflare 会自动配置 DNS 和 SSL 证书

📝 使用说明
前台导航页
访问首页即可看到导航链接，默认包含 6 个预设链接：

临渊羡鱼博客

临渊羡鱼图床

文件快递柜

飞牛NAS

临渊羡鱼资源站

临渊羡鱼标签页

后台管理
访问 /admin.html，例如 https://nav.fnosi.top/admin.html

使用设置的管理员账户登录

可以添加、编辑、删除导航链接

保存后自动同步到 Cloudflare KV，前台实时更新

默认管理员账户
项目	值
用户名	admin（或你在 ADMIN_USERNAME 中设置的值）
密码	你设置的 ADMIN_PASSWORD
🔧 自定义配置
修改背景图片
编辑 index.html 中的 bgImages 数组：

javascript
bgImages: [
    'https://your-image-1.jpg',
    'https://your-image-2.jpg',
    'https://your-image-3.jpg',
    // 可继续添加...
]
修改背景轮转间隔
javascript
bgRotateInterval: 8000,  // 单位：毫秒，8000 = 8秒
修改网站运行起始日期
javascript
startDate: '2025-12-01 00:00:00',
修改默认链接
编辑 _worker.js 中的 DEFAULT_LINKS 数组：

javascript
const DEFAULT_LINKS = [
    { id: '1', name: '你的链接', url: 'https://example.com', fallback: '🔗', status: 'active', order: 0 },
    // ...
];
🔌 API 接口
方法	路径	说明	认证
POST	/api/auth/login	管理员登录	❌
GET	/api/auth/verify	验证令牌	✅
GET	/api/links	获取链接列表	❌
PUT	/api/links	更新链接列表	✅
GET	/api/health	健康检查	❌
登录请求示例
bash
curl -X POST https://your-domain.com/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"your-password"}'
登录响应示例
json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "username": "admin",
    "role": "admin"
  },
  "expiresIn": 3600
}
更新链接请求示例
bash
curl -X PUT https://your-domain.com/api/links \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"links":[{"id":"1","name":"Google","url":"https://google.com","fallback":"G","status":"active","order":0}]}'
🔐 安全说明
措施	说明
JWT 认证	登录后生成令牌，1 小时后过期
环境变量加密	敏感信息通过 wrangler secret 加密存储
HTTPS	Cloudflare 自动提供 SSL 证书
CORS	已配置跨域访问控制
输入验证	前后端均验证链接 URL 格式
安全建议
修改默认密码：部署后立即修改 ADMIN_PASSWORD

使用强 JWT 密钥：JWT_SECRET 使用至少 32 位随机字符串

限制管理页面访问：可在 Cloudflare Dashboard 中设置 IP 访问规则

定期更新依赖：保持 Wrangler CLI 为最新版本

🧪 本地开发
bash
# 启动本地开发服务器
wrangler pages dev .

# 访问 http://localhost:8788
注意：本地开发时 KV 存储不可用，将使用默认链接数据。

📦 一键部署脚本
将以下内容保存为 deploy.sh：

bash
#!/bin/bash

echo "🚀 开始部署临渊羡鱼导航页..."
echo ""

# 检查 wrangler 是否安装
if ! command -v wrangler &> /dev/null; then
    echo "❌ 请先安装 wrangler: npm install -g wrangler"
    exit 1
fi

# 创建 KV 命名空间
echo "📦 创建 KV 命名空间..."
wrangler kv:namespace create "NAV_LINKS"

echo ""
echo "🔐 请设置以下环境变量："
echo ""
echo "  1. JWT_SECRET（JWT 签名密钥）"
echo "  2. ADMIN_PASSWORD（管理员密码）"
echo "  3. ADMIN_USERNAME（管理员用户名）"
echo ""

wrangler secret put JWT_SECRET
wrangler secret put ADMIN_PASSWORD
wrangler secret put ADMIN_USERNAME

echo ""
echo "📤 部署到 Cloudflare Pages..."
wrangler pages deploy .

echo ""
echo "✅ 部署完成！"
echo "请将 wrangler.toml 中的 KV ID 更新为上面输出的 ID"
运行：

bash
chmod +x deploy.sh
./deploy.sh
🐛 常见问题
Q: 部署时报错 Could not resolve "hono"
A: 本项目的 _worker.js 是纯 JS 实现，不依赖任何外部包。如果遇到此错误，请确认使用的是项目中的 _worker.js 文件。

Q: KV 存储未配置
A: 请确认已完成步骤 4，并在 wrangler.toml 中添加了正确的 KV 命名空间 ID。

Q: 后台管理页面无法登录
A: 检查环境变量是否正确设置：

bash
wrangler secret list
Q: 前台页面显示默认链接，不是后台设置的链接
A: 请检查是否在后台点击了保存（或等待自动保存完成），并且确认 KV 命名空间已正确绑定。

Q: 如何重置 KV 中的数据？
A: 在 Cloudflare Dashboard → Workers & Pages → KV → NAV_LINKS 中，删除 links 键即可。

🔄 更新日志
v1.0.0 (2024-01-01)

🎉 初始版本发布

✅ 导航页面基本功能

✅ 后台管理（增删改查）

✅ Cloudflare KV 存储

✅ JWT 认证

✅ 深浅色模式统一

✅ 自动保存到 KV

📄 许可证
MIT License

👤 作者
临渊羡鱼

博客：https://blog.fnosi.top

GitHub：https://github.com/your-username

⭐ 如果这个项目对你有帮助，请给一个 Star！
