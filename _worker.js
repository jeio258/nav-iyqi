// Cloudflare Pages 高级模式 Worker
// 本文件由 scripts/build-backends.js 生成（源：shared/core.js + 本脚本适配层），请勿手改

// ===== 平台无关核心逻辑（唯一来源）=====
// Cloudflare（_worker.js）与 EdgeOne（edge-functions/*）共用本文件。
// 本文件不直接部署；由 scripts/build-backends.js 内联到两个平台的产物中。
// 修改后必须运行：node scripts/build-backends.js

// 存储只做截断校验，不做 HTML 转义（转义由渲染端 textContent 负责，避免双重转义）
function sanitizeLink(link) {
  return {
    id: String(link.id || '').substring(0, 100),
    name: String(link.name || '').substring(0, 200),
    url: String(link.url || '').substring(0, 2048),
    fallback: String(link.fallback || '').substring(0, 10),
    status: link.status === 'inactive' ? 'inactive' : 'active'
  };
}

function sanitizeSettings(settings) {
  return {
    title: String(settings.title || '').substring(0, 100),
    subtitle: String(settings.subtitle || '').substring(0, 200),
    startDate: String(settings.startDate || '').substring(0, 50)
  };
}

function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
}

const MAX_LINKS = 200;

// 逐个校验链接，返回 { links } 或 { error }
function validateLinks(input) {
  if (!Array.isArray(input)) return { error: '无效的数据格式' };
  if (input.length > MAX_LINKS) return { error: `链接数量不能超过 ${MAX_LINKS} 个` };
  const cleaned = [];
  for (const link of input) {
    if (!link || !link.id || !link.name || !link.url) {
      return { error: '链接数据不完整：需要 id、name、url' };
    }
    if (!isValidUrl(link.url)) return { error: '无效的 URL（仅允许 http/https）' };
    cleaned.push(sanitizeLink(link));
  }
  return { links: cleaned };
}

// ===== JWT（HS256）：base64url 用纯 JS 实现，不依赖 btoa/atob（EdgeOne 未保证提供）=====
const B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function bytesToB64url(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i];
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64CHARS[b0 >> 2];
    out += B64CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64CHARS[b2 & 63] : '=';
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function strToB64url(s) {
  return bytesToB64url(new TextEncoder().encode(s));
}

function b64urlToBytes(s) {
  const chars = s.replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  const out = [];
  let buffer = 0;
  let bits = 0;
  for (let i = 0; i < chars.length; i++) {
    const v = B64CHARS.indexOf(chars[i]);
    if (v === -1) continue;
    buffer = (buffer << 6) | v;
    bits += 6;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

function b64urlToStr(s) {
  return new TextDecoder().decode(b64urlToBytes(s));
}

function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]
  );
}

const TOKEN_TTL_SECONDS = 3600;

async function jwtSign(payload, secret) {
  const head = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = strToB64url(JSON.stringify(payload));
  const data = head + '.' + body;
  const key = await hmacKey(secret, 'sign');
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return data + '.' + bytesToB64url(new Uint8Array(sig));
}

async function jwtVerify(token, secret) {
  const parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  const data = parts[0] + '.' + parts[1];
  const key = await hmacKey(secret, 'verify');
  const ok = await crypto.subtle.verify(
    'HMAC', key, b64urlToBytes(parts[2]), new TextEncoder().encode(data)
  );
  if (!ok) throw new Error('Invalid signature');
  const payload = JSON.parse(b64urlToStr(parts[1]));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// 签发管理员令牌
async function issueAdminToken(username, secret) {
  const now = Math.floor(Date.now() / 1000);
  return jwtSign(
    { username, role: 'admin', exp: now + TOKEN_TTL_SECONDS, iat: now },
    secret
  );
}

// ===== 默认数据（KV 不可用时的回退；与前端 CONFIG 中的展示默认值无关联）=====
const DEFAULT_LINKS = [
  { id: '1', name: '临渊羡鱼博客', url: 'https://blog.fnosi.top', fallback: '临', status: 'active' },
  { id: '2', name: '临渊羡鱼图床', url: 'https://imge.fnosi.top', fallback: '图', status: 'active' },
  { id: '3', name: '文件快递柜', url: 'https://file.fnosi.top', fallback: '📁', status: 'active' },
  { id: '4', name: '飞牛NAS', url: 'https://fnos.fnosi.top', fallback: '🐮', status: 'active' },
  { id: '5', name: '临渊羡鱼资源站', url: 'https://list.fnosi.top', fallback: '📦', status: 'active' },
  { id: '6', name: '临渊羡鱼标签页', url: 'https://tab.fnosi.top', fallback: '🏷️', status: 'active' }
];

const DEFAULT_SETTINGS = {
  title: '🌾 友邻聚落',
  subtitle: '临渊羡鱼 · 且行且歌',
  startDate: '2025-12-01 00:00:00'
};


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
  // 转义 < 防止数据里出现 </script> 提前闭合（JSON 内 < 转 \u003c 仍合法）
  const boot = JSON.stringify({ links, settings }).replace(/</g, '\\u003c');
  // CSP 阻止 Cloudflare 自动注入的 Web Analytics beacon：它是 type=module（defer 语义），
  // 实测其加载完成时刻正是 DCL 触发点，白占首访 1.2~1.3s。
  // 仅限定 script-src（不影响 img/font/connect），放行同源与内联脚本。
  const csp = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\'">';
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
