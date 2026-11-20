// Cloudflare Worker - 纯 JavaScript 实现

// ========== 响应工具 ==========
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization'
};

const json = (data, status = 200, extraHeaders) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=UTF-8',
      // 动态数据禁止浏览器缓存：否则后台改数据后仍读到旧响应，表现为需要刷新两遍
      'Cache-Control': 'no-store',
      ...CORS,
      ...extraHeaders
    }
  });

// 认证类错误携带状态码，避免调用方靠错误文案猜类型
class AuthError extends Error {
  constructor(message, status = 401) {
    super(message);
    this.status = status;
  }
}

// ========== 校验与清理 ==========
function isValidUrl(str) {
  try {
    const u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch { return false; }
}

// 存储时只做截断校验，不做 HTML 转义（转义由渲染端 textContent 负责，避免双重转义）
function sanitizeLink(link) {
  return {
    id: String(link.id || '').substring(0, 100),
    name: String(link.name || '').substring(0, 200),
    url: String(link.url || '').substring(0, 2048),
    fallback: String(link.fallback || '').substring(0, 10),
    status: link.status === 'inactive' ? 'inactive' : 'active'
  };
}

// ========== 速率限制（内存，按 isolate 生效；跨 isolate 需 KV/Durable Object） ==========
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

// ========== JWT（HMAC-SHA256） ==========
const b64urlEncode = (bin) => btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const b64urlDecode = (str) => {
  let s = str.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return atob(s);
};

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]
  );
}

const JWT = {
  async sign(payload, secret) {
    const head = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const body = b64urlEncode(JSON.stringify(payload));
    const data = `${head}.${body}`;
    const key = await hmacKey(secret, 'sign');
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
    return `${data}.${b64urlEncode(String.fromCharCode(...new Uint8Array(sig)))}`;
  },
  async verify(token, secret) {
    const parts = String(token).split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const [head, body, sigEncoded] = parts;
    const data = `${head}.${body}`;
    const key = await hmacKey(secret, 'verify');
    const sig = Uint8Array.from(b64urlDecode(sigEncoded), (c) => c.charCodeAt(0));
    const ok = await crypto.subtle.verify('HMAC', key, sig, new TextEncoder().encode(data));
    if (!ok) throw new Error('Invalid signature');
    const payload = JSON.parse(b64urlDecode(body));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
  }
};

// ========== 配置（必须通过环境变量设置，无默认值） ==========
function getConfig(env) {
  const { ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET } = env;
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD || !JWT_SECRET) {
    throw new AuthError('服务器未正确配置，请联系管理员', 500);
  }
  return { username: ADMIN_USERNAME, password: ADMIN_PASSWORD, jwtSecret: JWT_SECRET };
}

// 校验 Authorization 头，返回 payload；失败抛 AuthError
async function requireAuth(request, env) {
  const config = getConfig(env);
  const header = request.headers.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw new AuthError('未提供认证令牌');
  try {
    return await JWT.verify(header.slice(7), config.jwtSecret);
  } catch {
    throw new AuthError('令牌无效或已过期');
  }
}

// ========== 默认数据（仅 KV 不可用时使用） ==========
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

// ========== 各端点处理 ==========
async function handleLogin(request, env) {
  let config;
  try { config = getConfig(env); }
  catch (e) { return json({ error: e.message }, e.status); }

  // 仅用 CF-Connecting-IP（Cloudflare 注入，客户端无法伪造），
  // 勿改用 X-Forwarded-For：该头可被客户端伪造绕过限流。
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  if (!allowRequest(ip, 8, 60000)) {
    console.warn('[Worker] 登录限流触发:', ip);
    return json({ error: '请求过于频繁，请稍后再试' }, 429, { 'Retry-After': '60' });
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ error: '无效的请求体' }, 400); }

  const { username, password } = body || {};
  if (!username || !password) return json({ error: '请提供用户名和密码' }, 400);
  if (username !== config.username || password !== config.password) {
    return json({ error: '用户名或密码错误' }, 401);
  }

  const now = Math.floor(Date.now() / 1000);
  const token = await JWT.sign({ username, role: 'admin', exp: now + 3600, iat: now }, config.jwtSecret);
  return json({ token, user: { username, role: 'admin' }, expiresIn: 3600 });
}

async function handleGetLinks(env) {
  try {
    if (env.NAV_LINKS) {
      const raw = await env.NAV_LINKS.get('links');
      if (raw) return json({ links: JSON.parse(raw), source: 'kv' });
    }
    return json({ links: DEFAULT_LINKS, source: 'default' });
  } catch (error) {
    console.error('[Worker] 读取链接失败:', error.message);
    return json({ links: DEFAULT_LINKS, source: 'fallback' });
  }
}

async function handlePutLinks(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: '无效的请求体' }, 400); }

  const { links } = body || {};
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

  if (!env.NAV_LINKS) return json({ error: 'KV 存储未配置' }, 500);
  try {
    await env.NAV_LINKS.put('links', JSON.stringify(cleaned));
    return json({ success: true, message: '链接已保存', count: cleaned.length });
  } catch (error) {
    console.error('[Worker] 保存链接失败:', error.message);
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
  } catch (error) {
    console.error('[Worker] 读取设置失败:', error.message);
    return json({ settings: DEFAULT_SETTINGS, source: 'fallback' });
  }
}

async function handlePutSettings(request, env) {
  let body;
  try { body = await request.json(); }
  catch { return json({ error: '无效的请求体' }, 400); }

  const { settings } = body || {};
  if (!settings || typeof settings !== 'object') return json({ error: '无效的数据格式' }, 400);

  const cleaned = {
    title: String(settings.title || '').substring(0, 100),
    subtitle: String(settings.subtitle || '').substring(0, 200),
    startDate: String(settings.startDate || '').substring(0, 50)
  };

  if (!env.NAV_LINKS) return json({ error: 'KV 存储未配置' }, 500);
  try {
    await env.NAV_LINKS.put('settings', JSON.stringify(cleaned));
    return json({ success: true, message: '设置已保存' });
  } catch (error) {
    console.error('[Worker] 保存设置失败:', error.message);
    return json({ error: '保存失败' }, 500);
  }
}

// 受保护端点：先认证再执行，失败按 AuthError.status 返回
function guarded(handler) {
  return async (request, env) => {
    try { await requireAuth(request, env); }
    catch (e) { return json({ error: e.message }, e.status || 401); }
    return handler(request, env);
  };
}

// ========== 路由分发 ==========
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

// 静态资源边缘缓存：Pages 高级模式下所有请求经 Worker 出，Cloudflare 不会自动缓存
// Worker 响应（实测 HTML 恒为 cf-cache-status: DYNAMIC，每次访问都回源，TTFB 0.8~1.9s）。
// 必须显式使用 Cache API 写入边缘缓存；部署新版本时 Pages 会清项目缓存。
function assetsTtl(pathname) {
  if (pathname === '/' || pathname === '/index.html') return 60; // 含注入的链接数据，需短缓存
  return 300; // 其他 HTML / JS
}

// 首屏数据注入：把 KV 里的链接与设置写进 HTML，首访无需等 /api/links
// （原逻辑 HTML 到达后必须等 API 才渲染，实测白屏/骨架空窗 600~1300ms）
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
  // 转义 < 防止数据里出现 </script> 提前闭合（JSON 内 < 一律转 \u003c 仍为合法 JSON）
  const boot = JSON.stringify({ links, settings }).replace(/</g, '\\u003c');
  // CSP 阻止 Cloudflare 自动注入的 Web Analytics beacon：它是 type=module（defer 语义），
  // 实测其加载完成时刻（~2300ms）正是 DCL 触发点，白占 1.2~1.3s 首访时间。
  // 仅限定 script-src（不影响 img/font/connect），放行同源与内联脚本。
  const csp = '<meta http-equiv="Content-Security-Policy" content="script-src \'self\' \'unsafe-inline\'">';
  return html
    .replace('</head>', `<script>window.__BOOT__=${boot}</script></head>`)
    .replace('<head>', '<head>' + csp);
}

async function serveAsset(request, env, pathname, method) {
  if (!env.ASSETS) return new Response('Not Found', { status: 404 });
  // 只缓存幂等 GET；API 与其他方法直达源
  if (method !== 'GET') return env.ASSETS.fetch(request);

  const ttl = assetsTtl(pathname);
  const cache = caches.default;
  const cacheKey = new Request(new URL(pathname, request.url).toString(), { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const response = await env.ASSETS.fetch(request);
  // 仅缓存 200/3xx；ASSETS 响应头不可变，必须 new Response 包一层
  if (response.status !== 200 && !(response.status >= 300 && response.status < 400)) return response;

  const isHtml = pathname === '/' || pathname === '/index.html';
  let body = response.body;
  if (isHtml && response.status === 200) {
    body = await injectBoot(await response.text(), env);
  }

  const cached = new Response(body, response);
  cached.headers.set('Cache-Control', 'public, max-age=' + ttl);
  // 注入后 HTML 体积与源不同，移除可能失效的 Content-Length
  if (isHtml) cached.headers.delete('Content-Length');
  try { await cache.put(cacheKey, cached.clone()); } catch (e) { /* 缓存失败不影响响应 */ }
  return cached;
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { headers: CORS });

    // 非 /api/ 路径交给静态资源（Pages 高级模式），走边缘缓存
    if (!pathname.startsWith('/api/')) {
      return serveAsset(request, env, pathname, method);
    }

    const handler = ROUTES[`${method} ${pathname}`];
    if (!handler) return json({ error: 'Not Found' }, 404);

    try {
      return await handler(request, env);
    } catch (error) {
      console.error(`[Worker] ${method} ${pathname} 异常:`, error.message);
      return json({ error: 'Internal Server Error' }, 500);
    }
  }
};
