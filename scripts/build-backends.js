#!/usr/bin/env node
// ===== 后端产物生成器 =====
// 唯一来源：shared/core.js（平台无关逻辑）+ 本文件中的平台适配层
// 产物：_worker.js（Cloudflare Pages 高级模式）、edge-functions/api/**/*.js（EdgeOne Makers）
// 产物均已提交入库，部署时无需构建。修改后必须运行：node scripts/build-backends.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// core.js 去掉 export 后内联（两平台产物都是单文件/自包含，不能 import）
const core = fs
  .readFileSync(path.join(ROOT, 'shared', 'core.js'), 'utf8')
  .replace(/^export\s+/gm, '');

// ===================== Cloudflare 适配层 =====================
const CLOUDFLARE_ADAPTER = `
// ===== Cloudflare 适配层 =====
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

// 动态数据统一 no-store；避免浏览器缓存导致后台改动不生效
const json = (data, status = 200, extraHeaders) =>
  new Response(JSON.stringify(data), {
    status,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
      CORS,
      extraHeaders
    )
  });

class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

function getConfig(env) {
  const { ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET } = env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !JWT_SECRET) {
    throw new AuthError('服务器未正确配置，请联系管理员', 500);
  }
  return { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, jwtSecret: JWT_SECRET };
}

async function requireAuth(request, env) {
  const config = getConfig(env);
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw new AuthError('未提供认证令牌');
  try {
    return await jwtVerify(header.slice(7), config.jwtSecret);
  } catch (e) {
    throw new AuthError('令牌无效或已过期');
  }
}

function guarded(handler) {
  return async (request, env) => {
    try { await requireAuth(request, env); }
    catch (e) { return json({ error: e.message }, e.status || 401); }
    return handler(request, env);
  };
}

// 内存速率限制：按 isolate 生效；跨 isolate 需 KV/Durable Object
const rateLimiter = new Map();
function allowRequest(ip, limit = 8, windowMs = 60000) {
  const now = Date.now();
  if (rateLimiter.size > 1000) {
    for (const [k, rec] of rateLimiter) if (now - rec.start > windowMs) rateLimiter.delete(k);
  }
  const rec = rateLimiter.get(ip);
  if (!rec || now - rec.start > windowMs) {
    rateLimiter.set(ip, { start: now, count: 1 });
    return true;
  }
  if (rec.count >= limit) return false;
  rec.count++;
  return true;
}

// ===== 端点 =====
async function handleLogin(request, env) {
  let config;
  try { config = getConfig(env); }
  catch (e) { return json({ error: e.message }, e.status); }

  // 仅用 CF-Connecting-IP（Cloudflare 注入，客户端无法伪造）
  // 勿改用 X-Forwarded-For：该头可被客户端伪造绕过限流
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allowRequest(ip, 8, 60000)) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'Retry-After': '60' });
  }

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: '无效的请求体' }, 400); }

  const { username, password } = body || {};
  if (!username || !password) return json({ error: '请提供用户名和密码' }, 400);
  if (username !== config.username || password !== config.password) {
    return json({ error: '用户名或密码错误' }, 401);
  }

  const token = await issueAdminToken(username, config.jwtSecret);
  return json({ token, user: { username, role: 'admin' }, expiresIn: TOKEN_TTL_SECONDS });
}

async function handleGetLinks(env) {
  try {
    if (env.NAV_LINKS) {
      const raw = await env.NAV_LINKS.get('links');
      if (raw) return json({ links: JSON.parse(raw), source: 'kv' });
    }
    return json({ links: DEFAULT_LINKS, source: 'default' });
  } catch (e) {
    console.error('[Worker] 读取链接失败:', e.message);
    return json({ links: DEFAULT_LINKS, source: 'fallback' });
  }
}

async function handlePutLinks(request, env) {
  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: '无效的请求体' }, 400); }

  const result = validateLinks(body && body.links);
  if (result.error) return json({ error: result.error }, 400);
  if (!env.NAV_LINKS) return json({ error: 'KV 存储未配置' }, 500);

  try {
    await env.NAV_LINKS.put('links', JSON.stringify(result.links));
    return json({ success: true, message: '链接已保存', count: result.links.length });
  } catch (e) {
    console.error('[Worker] 保存链接失败:', e.message);
    return json({ error: '保存失败' }, 500);
  }
}

async function handleGetSettings(env) {
  try {
    if (env.NAV_LINKS) {
      const raw = await env.NAV_LINKS.get('settings');
      if (raw) return json({ settings: JSON.parse(raw), source: 'kv' });
    }
    return json({ settings: DEFAULT_SETTINGS, source: 'default' });
  } catch (e) {
    console.error('[Worker] 读取设置失败:', e.message);
    return json({ settings: DEFAULT_SETTINGS, source: 'fallback' });
  }
}

async function handlePutSettings(request, env) {
  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: '无效的请求体' }, 400); }

  const settings = body && body.settings;
  if (!settings || typeof settings !== 'object') return json({ error: '无效的数据格式' }, 400);
  if (!env.NAV_LINKS) return json({ error: 'KV 存储未配置' }, 500);

  try {
    await env.NAV_LINKS.put('settings', JSON.stringify(sanitizeSettings(settings)));
    return json({ success: true, message: '设置已保存' });
  } catch (e) {
    console.error('[Worker] 保存设置失败:', e.message);
    return json({ error: '保存失败' }, 500);
  }
}

const ROUTES = {
  'POST /api/auth/login': (request, env) => handleLogin(request, env),
  'GET /api/auth/verify': async (request, env) => {
    try {
      const user = await requireAuth(request, env);
      return json({ valid: true, user });
    } catch (e) { return json({ error: e.message }, e.status || 401); }
  },
  'GET /api/links': (_request, env) => handleGetLinks(env),
  'PUT /api/links': guarded((request, env) => handlePutLinks(request, env)),
  'GET /api/settings': (_request, env) => handleGetSettings(env),
  'PUT /api/settings': guarded((request, env) => handlePutSettings(request, env)),
  'GET /api/health': (_request, env) =>
    json({ status: 'ok', timestamp: new Date().toISOString(), kv: !!env.NAV_LINKS })
};

// ===== 静态资源（边缘缓存 + 首屏数据注入 + CSP）=====
// Pages 高级模式下所有请求经 Worker 出，Cloudflare 不会自动缓存 Worker 响应，
// 必须用 Cache API 显式写入边缘缓存（实测 HTML TTFB 0.8~1.9s → 命中后 ~50ms）
function assetsTtl(pathname) {
  if (pathname === '/' || pathname === '/index.html') return 60; // 含注入数据，短缓存
  return 300;
}

// 首屏数据注入：把 KV 里的链接与设置写进 HTML，首访无需等 /api/links
// （原逻辑 HTML 到达后必须等 API 才渲染，实测空窗 600~1300ms）
async function injectBoot(html, env) {
  let links = DEFAULT_LINKS;
  let settings = DEFAULT_SETTINGS;
  try {
    if (env.NAV_LINKS) {
      const [rawLinks, rawSettings] = await Promise.all([
        env.NAV_LINKS.get('links'),
        env.NAV_LINKS.get('settings')
      ]);
      const parsedLinks = rawLinks ? JSON.parse(rawLinks) : null;
      const parsedSettings = rawSettings ? JSON.parse(rawSettings) : null;
      if (Array.isArray(parsedLinks)) links = parsedLinks;
      if (parsedSettings && typeof parsedSettings === 'object') settings = parsedSettings;
    }
  } catch (e) {
    console.warn('[Worker] 首屏数据注入失败，用默认值:', e.message);
  }
  // 转义 < 防止数据里出现 </script> 提前闭合（JSON 内 < 转 \\u003c 仍合法）
  const boot = JSON.stringify({ links, settings }).replace(/</g, '\\\\u003c');
  // CSP 阻止 Cloudflare 自动注入的 Web Analytics beacon：它是 type=module（defer 语义），
  // 实测其加载完成时刻正是 DCL 触发点，白占首访 1.2~1.3s。
  // 仅限定 script-src（不影响 img/font/connect），放行同源与内联脚本。
  const csp = '<meta http-equiv="Content-Security-Policy" content="script-src \\'self\\' \\'unsafe-inline\\'">';
  return html
    .replace('</head>', '<script>window.__BOOT__=' + boot + '</script></head>')
    .replace('<head>', '<head>' + csp);
}

async function serveAsset(request, env, pathname, method) {
  if (!env.ASSETS) return new Response('Not Found', { status: 404 });
  if (method !== 'GET') return env.ASSETS.fetch(request);

  const cache = caches.default;
  const cacheKey = new Request(new URL(pathname, request.url).toString(), { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const response = await env.ASSETS.fetch(request);
  if (response.status !== 200 && !(response.status >= 300 && response.status < 400)) return response;

  const isHtml = pathname === '/' || pathname === '/index.html';
  let body = response.body;
  if (isHtml && response.status === 200) {
    body = await injectBoot(await response.text(), env);
  }

  // ASSETS 响应头不可变，必须 new Response 包一层才能改
  const cached = new Response(body, response);
  cached.headers.set('Cache-Control', 'public, max-age=' + assetsTtl(pathname));
  if (isHtml) cached.headers.delete('Content-Length'); // 注入后长度变化
  try { await cache.put(cacheKey, cached.clone()); } catch (e) { /* 缓存失败不影响响应 */ }
  return cached;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    if (!pathname.startsWith('/api/')) {
      return serveAsset(request, env, pathname, method);
    }

    const handler = ROUTES[method + ' ' + pathname];
    if (!handler) return json({ error: 'Not Found' }, 404);

    try {
      return await handler(request, env);
    } catch (error) {
      console.error('[Worker] ' + method + ' ' + pathname + ' 异常:', error.message);
      return json({ error: 'Internal Server Error' }, 500);
    }
  }
};
`;

// ===================== EdgeOne 适配层 =====================
const EDGEONE_PRELUDE = `
// ===== EdgeOne 适配层 =====
// KV 绑定：控制台绑定命名空间时填的「变量名」= 运行时全局变量名（NAV_LINKS）。
// 同时兜底 context.env.NAV_LINKS，两种取值方式都可用。
function getKV(context) {
  try {
    if (typeof NAV_LINKS !== 'undefined' && NAV_LINKS) return NAV_LINKS;
  } catch (e) { /* 未绑定 */ }
  return (context && context.env && context.env.NAV_LINKS) || null;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign(
      { 'Content-Type': 'application/json; charset=UTF-8', 'Cache-Control': 'no-store' },
      CORS_HEADERS,
      extraHeaders || {}
    )
  });
}

function preflight() {
  return new Response(null, { headers: CORS_HEADERS });
}

function getConfig(context) {
  const env = (context && context.env) || {};
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.JWT_SECRET) return null;
  return {
    username: env.ADMIN_USERNAME,
    password: env.ADMIN_PASSWORD,
    jwtSecret: env.JWT_SECRET
  };
}

async function requireAuth(request, context) {
  const cfg = getConfig(context);
  if (!cfg) throw new Error('服务器未配置环境变量');
  const header = request.headers.get('Authorization') || '';
  if (header.indexOf('Bearer ') !== 0) throw new Error('未提供认证令牌');
  return jwtVerify(header.slice(7), cfg.jwtSecret);
}

// 鉴权失败统一按错误类型返回状态码
function authError(e) {
  const unconfigured = String(e.message).indexOf('未配置') >= 0;
  return json({ error: e.message }, unconfigured ? 500 : 401);
}

async function readKV(context, key, fallback) {
  const kv = getKV(context);
  if (!kv) return { value: fallback, source: 'default' };
  try {
    const raw = await kv.get(key);
    if (!raw) return { value: fallback, source: 'default' };
    return { value: JSON.parse(raw), source: 'kv' };
  } catch (e) {
    return { value: fallback, source: 'fallback' };
  }
}

async function writeKV(context, key, value) {
  const kv = getKV(context);
  if (!kv) {
    return json({ error: 'KV 存储未绑定：请在控制台绑定命名空间，变量名填 NAV_LINKS' }, 500);
  }
  try {
    await kv.put(key, JSON.stringify(value));
    return null;
  } catch (e) {
    return json({ error: '保存失败: ' + e.message }, 500);
  }
}
`;

const EDGEONE_HANDLERS = {
  'health.js': {
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
  'auth/login.js': {
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

  const token = await issueAdminToken(username, cfg.jwtSecret);
  return json({ token, user: { username, role: 'admin' }, expiresIn: TOKEN_TTL_SECONDS });
}`
  },
  'auth/verify.js': {
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
  'links.js': {
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

    const result = validateLinks(body && body.links);
    if (result.error) return json({ error: result.error }, 400);

    const failure = await writeKV(context, 'links', result.links);
    if (failure) return failure;
    return json({ success: true, message: '链接已保存', count: result.links.length });
  }

  return json({ error: 'Method Not Allowed' }, 405);
}`
  },
  'settings.js': {
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

    const failure = await writeKV(context, 'settings', sanitizeSettings(settings));
    if (failure) return failure;
    return json({ success: true, message: '设置已保存' });
  }

  return json({ error: 'Method Not Allowed' }, 405);
}`
  }
};

// ===================== 生成 =====================
let count = 0;

// 1) Cloudflare
const workerHeader = `// Cloudflare Pages 高级模式 Worker\n` +
  `// 本文件由 scripts/build-backends.js 生成（源：shared/core.js + 本脚本适配层），请勿手改\n`;
fs.writeFileSync(path.join(ROOT, '_worker.js'), workerHeader + '\n' + core + '\n' + CLOUDFLARE_ADAPTER);
console.log('生成: _worker.js');
count++;

// 2) EdgeOne
for (const [file, spec] of Object.entries(EDGEONE_HANDLERS)) {
  const outPath = path.join(ROOT, 'edge-functions', 'api', file);
  const routePath = '/api/' + file.replace(/\.js$/, '');
  const header = `// EdgeOne Makers Edge Function —— 路由 ${routePath}\n` +
    `// 支持方法：${spec.methods}；${spec.desc}\n` +
    `// 本文件由 scripts/build-backends.js 生成（源：shared/core.js + 本脚本适配层），请勿手改\n`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, header + '\n' + core + '\n' + EDGEONE_PRELUDE + '\n' + spec.body + '\n');
  console.log('生成: edge-functions/api/' + file);
  count++;
}

console.log(`\n完成，共 ${count} 个产物。源：shared/core.js`);
