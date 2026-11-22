#!/usr/bin/env node
// ===== EdgeOne Edge Functions 构建脚本 =====
// 读 edge-functions/_shared.js（唯一来源），内联到各 handler，生成自包含的
// edge-functions/api/**/*.js。产物已提交入库，部署时无需构建（EdgeOne 直接用）。
// 改完 _shared.js 或本文件的 handler 后必须运行：node scripts/build-edgeone.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const API_DIR = path.join(ROOT, 'edge-functions', 'api');

// 共享逻辑去掉 export 前缀，变成同作用域的普通函数
const shared = fs
  .readFileSync(path.join(ROOT, 'edge-functions', '_shared.js'), 'utf8')
  .replace(/^export\s+/gm, '');

const HANDLERS = {
  'api/health.js': {
    methods: 'GET',
    desc: '健康检查：确认部署成功、KV 是否绑定',
    body: `
export default function onRequest(context) {
  if (context.request.method === 'OPTIONS') return preflight();
  return json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    kv: !!getKV(context),
    runtime: 'edgeone'
  });
}`
  },

  'api/auth/login.js': {
    methods: 'POST',
    desc: '管理员登录，签发 1 小时 JWT',
    body: `
export default async function onRequest(context) {
  const request = context.request;
  if (request.method === 'OPTIONS') return preflight();
  if (request.method !== 'POST') return json({ error: 'Method Not Allowed' }, 405);

  const cfg = getConfig(context);
  if (!cfg) return json({ error: '服务器未配置环境变量 ADMIN_USERNAME / ADMIN_PASSWORD / JWT_SECRET' }, 500);

  let body;
  try { body = await request.json(); } catch (e) { return json({ error: '无效的请求体' }, 400); }

  const username = body && body.username;
  const password = body && body.password;
  if (!username || !password) return json({ error: '请提供用户名和密码' }, 400);
  if (username !== cfg.username || password !== cfg.password) {
    return json({ error: '用户名或密码错误' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await jwtSign(
    { username, role: 'admin', exp: now + 3600, iat: now },
    cfg.jwtSecret
  );
  return json({ token, user: { username, role: 'admin' }, expiresIn: 3600 });
}`
  },

  'api/auth/verify.js': {
    methods: 'GET',
    desc: '校验令牌是否有效',
    body: `
export default async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return preflight();
  try {
    const user = await requireAuth(context.request, context);
    return json({ valid: true, user });
  } catch (e) {
    return authError(e);
  }
}`
  },

  'api/links.js': {
    methods: 'GET, PUT',
    desc: '链接列表：GET 公开读取，PUT 需鉴权写入',
    body: `
export default async function onRequest(context) {
  const request = context.request;
  if (request.method === 'OPTIONS') return preflight();

  if (request.method === 'GET') {
    const result = await readKV(context, 'links', DEFAULT_LINKS);
    return json({ links: result.value, source: result.source });
  }

  if (request.method === 'PUT') {
    try { await requireAuth(request, context); } catch (e) { return authError(e); }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '无效的请求体' }, 400); }

    const links = body && body.links;
    if (!Array.isArray(links)) return json({ error: '无效的数据格式' }, 400);
    if (links.length > 200) return json({ error: '链接数量不能超过 200 个' }, 400);

    const cleaned = [];
    for (const link of links) {
      if (!link || !link.id || !link.name || !link.url) {
        return json({ error: '链接数据不完整：需要 id、name、url' }, 400);
      }
      if (!isValidUrl(link.url)) return json({ error: '无效的 URL（仅允许 http/https）' }, 400);
      cleaned.push(sanitizeLink(link));
    }

    const failure = await writeKV(context, 'links', cleaned);
    if (failure) return failure;
    return json({ success: true, message: '链接已保存', count: cleaned.length });
  }

  return json({ error: 'Method Not Allowed' }, 405);
}`
  },

  'api/settings.js': {
    methods: 'GET, PUT',
    desc: '站点设置：GET 公开读取，PUT 需鉴权写入',
    body: `
export default async function onRequest(context) {
  const request = context.request;
  if (request.method === 'OPTIONS') return preflight();

  if (request.method === 'GET') {
    const result = await readKV(context, 'settings', DEFAULT_SETTINGS);
    return json({ settings: result.value, source: result.source });
  }

  if (request.method === 'PUT') {
    try { await requireAuth(request, context); } catch (e) { return authError(e); }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: '无效的请求体' }, 400); }

    const settings = body && body.settings;
    if (!settings || typeof settings !== 'object') return json({ error: '无效的数据格式' }, 400);

    const cleaned = {
      title: String(settings.title || '').substring(0, 100),
      subtitle: String(settings.subtitle || '').substring(0, 200),
      startDate: String(settings.startDate || '').substring(0, 50)
    };

    const failure = await writeKV(context, 'settings', cleaned);
    if (failure) return failure;
    return json({ success: true, message: '设置已保存' });
  }

  return json({ error: 'Method Not Allowed' }, 405);
}`
  }
};

let count = 0;
for (const [file, spec] of Object.entries(HANDLERS)) {
  const outPath = path.join(API_DIR, file);
  const header = `// EdgeOne Makers Edge Function —— 路由 /${file.replace(/^api\//, 'api/').replace(/\.js$/, '')}\n` +
    `// 支持方法：${spec.methods}；${spec.desc}\n` +
    `// 本文件由 scripts/build-edgeone.js 从 _shared.js 生成，请勿手改（改 _shared.js 后重新生成）\n`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, header + '\n' + shared + '\n' + spec.body + '\n');
  console.log('生成:', file);
  count++;
}
console.log(`完成，共 ${count} 个函数文件 → edge-functions/api/`);
