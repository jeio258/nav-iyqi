// Cloudflare Worker - 纯 JavaScript 实现

// ========== 简单的内存速率限制器 ==========
// 生产环境推荐使用 Cloudflare WAF 速率限制规则
const rateLimiter = new Map();

function checkRateLimit(ip, limit = 5, windowMs = 60000) {
  const now = Date.now();
  // 定期清理过期条目，防止 Map 无限增长（内存泄漏）
  if (rateLimiter.size > 1000) {
    for (const [key, rec] of rateLimiter) {
      if (now - rec.start > windowMs) rateLimiter.delete(key);
    }
  }
  const record = rateLimiter.get(ip);
  if (!record || now - record.start > windowMs) {
    rateLimiter.set(ip, { start: now, count: 1 });
    return true;
  }
  if (record.count >= limit) return false;
  record.count++;
  return true;
}

// ========== XSS 防护 ==========
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// 存储时只做截断/校验，不做 HTML 转义（转义应在渲染端进行，否则会双重转义）
function sanitizeLink(link) {
  return {
    id: String(link.id || '').substring(0, 100),
    name: String(link.name || '').substring(0, 200),
    url: String(link.url || '').substring(0, 2048),
    fallback: String(link.fallback || '').substring(0, 10),
    status: link.status === 'inactive' ? 'inactive' : 'active'
  };
}

function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
}

// ========== JWT ==========
const JWT = {
  base64UrlEncode(str) {
    return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  },
  base64UrlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return atob(str);
  },
  async sign(payload, secret) {
    const encoder = new TextEncoder();
    const header = { alg: 'HS256', typ: 'JWT' };
    const headerEncoded = this.base64UrlEncode(JSON.stringify(header));
    const payloadEncoded = this.base64UrlEncode(JSON.stringify(payload));
    const data = `${headerEncoded}.${payloadEncoded}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
    const signatureEncoded = this.base64UrlEncode(String.fromCharCode(...new Uint8Array(signature)));
    return `${headerEncoded}.${payloadEncoded}.${signatureEncoded}`;
  },
  async verify(token, secret) {
    const encoder = new TextEncoder();
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const [headerEncoded, payloadEncoded, signatureEncoded] = parts;
    const data = `${headerEncoded}.${payloadEncoded}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const signatureBytes = this.base64UrlDecode(signatureEncoded);
    const signature = Uint8Array.from(signatureBytes, c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
    if (!isValid) throw new Error('Invalid signature');
    const payload = JSON.parse(this.base64UrlDecode(payloadEncoded));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
  }
};

// ========== Router ==========
class Router {
  constructor() {
    this.routes = [];
  }
  add(method, path, handler, middlewares = []) {
    this.routes.push({ method, path, handler, middlewares });
  }
  get(path, ...args) { const handler = args.pop(); this.add('GET', path, handler, args); }
  post(path, ...args) { const handler = args.pop(); this.add('POST', path, handler, args); }
  put(path, ...args) { const handler = args.pop(); this.add('PUT', path, handler, args); }

  async handle(request, env) {
    const url = new URL(request.url);
    const method = request.method;
    const path = url.pathname;

    if (method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization',
          'Access-Control-Max-Age': '86400',
        }
      });
    }

    for (const route of this.routes) {
      if (route.method === method && this.matchPath(route.path, path)) {
        const params = this.extractParams(route.path, path);
        const ctx = {
          req: {
            json: async () => request.json(),
            header: (name) => request.headers.get(name),
            raw: request,
            param: (name) => params[name],
          },
          env: env,
          set: (key, value) => { ctx._data = ctx._data || {}; ctx._data[key] = value; },
          get: (key) => ctx._data ? ctx._data[key] : undefined,
        };
        try {
          for (const middleware of route.middlewares) {
            let nextCalled = false;
            const result = await middleware(ctx, () => { nextCalled = true; });
            if (!nextCalled && result) return this.addCors(result);
          }
          const result = await route.handler(ctx);
          return this.addCors(result);
        } catch (error) {
          console.error(`[Worker] Route error ${method} ${path}:`, error.message);
          return this.addCors(new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }
    }
    try {
      const resp = await env.ASSETS.fetch(request);
      // 静态资源设置缓存头：HTML 短缓存（设置/链接由前端异步拉取，HTML 本身静态），字体/图片长缓存
      const url = new URL(request.url);
      const path = url.pathname;
      const cacheMax = /\/fonts\/|favicon/.test(path) ? 31536000 : 300;
      const headers = new Headers(resp.headers);
      headers.set('Cache-Control', 'public, max-age=' + cacheMax);
      return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers });
    } catch (e) { return new Response('Not Found', { status: 404 }); }
  }

  matchPath(routePath, requestPath) {
    const rp = routePath.split('/'), rq = requestPath.split('/');
    if (rp.length !== rq.length) return false;
    for (let i = 0; i < rp.length; i++) { if (rp[i].startsWith(':')) continue; if (rp[i] !== rq[i]) return false; }
    return true;
  }

  extractParams(routePath, requestPath) {
    const params = {}, rp = routePath.split('/'), rq = requestPath.split('/');
    for (let i = 0; i < rp.length; i++) { if (rp[i].startsWith(':')) params[rp[i].slice(1)] = rq[i]; }
    return params;
  }

  addCors(response) {
    const headers = new Headers(response.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
  }
}

const router = new Router();

// ========== 配置（必须通过环境变量设置，无默认值） ==========
function getConfig(env) {
  const username = env.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD;
  const jwtSecret = env.JWT_SECRET;

  if (!username || !password || !jwtSecret) {
    throw new Error('缺少必需的环境变量：ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET。本地开发：复制 .dev.vars.example 为 .dev.vars 并填入值。部署：使用 wrangler pages secret put 设置。');
  }
  return { username, password, jwtSecret };
}

function getConfigSafe(env) {
  try { return getConfig(env); } catch { return null; }
}

// ========== 数据默认值（仅 KV 不可用时使用） ==========
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

// ========== 认证中间件 ==========
async function authMiddleware(ctx, next) {
  const config = getConfigSafe(ctx.env);
  if (!config) {
    return new Response(JSON.stringify({ error: '服务器未正确配置认证信息' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
  const authHeader = ctx.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: '未提供认证令牌' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const token = authHeader.split(' ')[1];
    const payload = await JWT.verify(token, config.jwtSecret);
    ctx.set('user', payload);
    await next();
  } catch (error) {
    console.warn('[Worker] 认证失败:', error.message);
    return new Response(JSON.stringify({ error: '令牌无效或已过期' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
}

// ========== API 路由 ==========

// 登录（含速率限制）
router.post('/api/auth/login', async (ctx) => {
  const config = getConfigSafe(ctx.env);
  if (!config) {
    return new Response(JSON.stringify({ error: '服务器未正确配置，请联系管理员' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }

  const ip = ctx.req.header('CF-Connecting-IP') || 'unknown';
  // 注意：仅用 CF-Connecting-IP（Cloudflare 设置，客户端无法伪造），
  // 不用 X-Forwarded-For（可被客户端伪造绕过限制）。
  // 内存限制器按 isolate 生效，跨 isolate 需改用 KV/Durable Object。
  if (!checkRateLimit(ip, 8, 60000)) {
    console.warn('[Worker] 登录速率限制触发:', ip);
    return new Response(JSON.stringify({ error: '请求过于频繁，请稍后再试' }), { status: 429, headers: { 'Content-Type': 'application/json', 'Retry-After': '60' } });
  }

  try {
    const body = await ctx.req.json();
    const { username, password } = body;
    if (!username || !password) {
      return new Response(JSON.stringify({ error: '请提供用户名和密码' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (username !== config.username || password !== config.password) {
      return new Response(JSON.stringify({ error: '用户名或密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }
    const payload = { username, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
    const token = await JWT.sign(payload, config.jwtSecret);
    return new Response(JSON.stringify({ token, user: { username, role: 'admin' }, expiresIn: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[Worker] 登录错误:', error.message);
    return new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

// 验证令牌
router.get('/api/auth/verify', authMiddleware, async (ctx) => {
  return new Response(JSON.stringify({ valid: true, user: ctx.get('user') }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

// 获取链接
router.get('/api/links', async (ctx) => {
  try {
    if (ctx.env.NAV_LINKS) {
      const linksData = await ctx.env.NAV_LINKS.get('links');
      if (linksData) return new Response(JSON.stringify({ links: JSON.parse(linksData), source: 'kv' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ links: DEFAULT_LINKS, source: 'default' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[Worker] 读取链接失败:', error.message);
    return new Response(JSON.stringify({ links: DEFAULT_LINKS, source: 'fallback' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
});

// 更新链接（含输入清理）
router.put('/api/links', authMiddleware, async (ctx) => {
  try {
    const body = await ctx.req.json();
    const { links } = body;
    if (!links || !Array.isArray(links)) {
      return new Response(JSON.stringify({ error: '无效的数据格式' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (links.length > 200) {
      return new Response(JSON.stringify({ error: '链接数量不能超过 200 个' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }

    const cleaned = [];
    for (const link of links) {
      if (!link.id || !link.name || !link.url) {
        return new Response(JSON.stringify({ error: '链接数据不完整：需要 id、name、url' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      if (!isValidUrl(link.url)) {
        return new Response(JSON.stringify({ error: `无效的 URL: ${escapeHtml(link.url)}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
      }
      cleaned.push(sanitizeLink(link));
    }

    if (ctx.env.NAV_LINKS) {
      await ctx.env.NAV_LINKS.put('links', JSON.stringify(cleaned));
      return new Response(JSON.stringify({ success: true, message: '链接已保存', count: cleaned.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'KV 存储未配置' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[Worker] 保存链接失败:', error.message);
    return new Response(JSON.stringify({ error: '保存失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

// ========== 站点图标代理（避免前端直接依赖慢的外部图标源） ==========
// 阶段1：目标站自身 /favicon.ico（最准确，6s）；阶段2：并发 icon.horse → DuckDuckGo → Google（各 3s 兜底）；
// 任一成功即存入 KV（7 天 TTL），后续由边缘直接返回
const FAVICON_FALLBACKS = [
  (d) => 'https://icon.horse/icon/' + d,
  (d) => 'https://icons.duckduckgo.com/ip3/' + d + '.ico',
  (d) => 'https://www.google.com/s2/favicons?domain=' + d + '&sz=64'
];

function detectImageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf.length > 4 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  return 'application/octet-stream';
}

async function tryFetchFavicon(makeUrl, domain, timeoutMs) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const resp = await fetch(makeUrl(domain), { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow', signal: ctrl.signal });
    if (!resp.ok || resp.status >= 400) throw new Error('status ' + resp.status);
    const ct = (resp.headers.get('content-type') || '').toLowerCase();
    if (ct && !ct.includes('image')) throw new Error('not image: ' + ct);
    const buf = new Uint8Array(await resp.arrayBuffer());
    if (buf.length < 16) throw new Error('empty body');
    return buf;
  } finally { clearTimeout(tid); }
}

async function fetchFavicon(domain) {
  // 阶段1：目标站自身 favicon（最准确），6s 超时
  try {
    return await tryFetchFavicon((d) => 'https://' + d + '/favicon.ico', domain, 6000);
  } catch (e) {
    console.warn('[Worker] 目标站自身图标失败:', domain, e.message);
  }
  // 阶段2：并发第三方兜底，各 3s
  const results = await Promise.allSettled(FAVICON_FALLBACKS.map(src => tryFetchFavicon(src, domain, 3000)));
  for (const r of results) if (r.status === 'fulfilled') return r.value;
  throw new Error('all sources failed');
}

router.get('/api/favicon', async (ctx) => {
  const target = ctx.req.raw ? new URL(ctx.req.raw.url).searchParams.get('url') : '';
  const u = target ? new URL(target) : null;
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
    return new Response('Bad Request', { status: 400 });
  }
  const domain = u.hostname;
  const key = 'favicon:' + domain;

  try {
    // 1. KV 命中直接返回
    if (ctx.env.NAV_LINKS) {
      const cached = await ctx.env.NAV_LINKS.get(key);
      if (cached) {
        const buf = Uint8Array.from(atob(cached), c => c.charCodeAt(0));
        return new Response(buf, { headers: { 'Content-Type': detectImageType(buf), 'Cache-Control': 'public, max-age=604800', 'X-Favicon-Source': 'kv' } });
      }
    }
    // 2. 未命中：抓取并写回 KV 缓存（base64 编码，7 天）
    const buf = await fetchFavicon(domain);
    if (ctx.env.NAV_LINKS && buf.length < 1024 * 1024) {
      let bin = '';
      for (const b of buf) bin += String.fromCharCode(b);
      await ctx.env.NAV_LINKS.put(key, btoa(bin), { expirationTtl: 604800 });
    }
    return new Response(buf, { headers: { 'Content-Type': detectImageType(buf), 'Cache-Control': 'public, max-age=604800', 'X-Favicon-Source': 'fetch' } });
  } catch (error) {
    console.warn('[Worker] 图标获取失败:', domain, error.message);
    return new Response('Not Found', { status: 404 });
  }
});

// ========== 站点设置 API ==========
router.get('/api/settings', async (ctx) => {
  try {
    if (ctx.env.NAV_LINKS) {
      const data = await ctx.env.NAV_LINKS.get('settings');
      if (data) return new Response(JSON.stringify({ settings: JSON.parse(data), source: 'kv' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ settings: DEFAULT_SETTINGS, source: 'default' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[Worker] 读取设置失败:', error.message);
    return new Response(JSON.stringify({ settings: DEFAULT_SETTINGS, source: 'fallback' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
});

router.put('/api/settings', authMiddleware, async (ctx) => {
  try {
    const body = await ctx.req.json();
    const { settings } = body;
    if (!settings || typeof settings !== 'object') {
      return new Response(JSON.stringify({ error: '无效的数据格式' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    // 清理设置值（截断校验；HTML 转义在渲染端进行）
    const cleaned = {
      title: String(settings.title || '').substring(0, 100),
      subtitle: String(settings.subtitle || '').substring(0, 200),
      startDate: String(settings.startDate || '').substring(0, 50)
    };
    if (ctx.env.NAV_LINKS) {
      await ctx.env.NAV_LINKS.put('settings', JSON.stringify(cleaned));
      return new Response(JSON.stringify({ success: true, message: '设置已保存' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'KV 存储未配置' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error('[Worker] 保存设置失败:', error.message);
    return new Response(JSON.stringify({ error: '保存失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

router.get('/api/health', async (ctx) => {
  return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), kv: !!ctx.env.NAV_LINKS }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

export default {
  async fetch(request, env) {
    return router.handle(request, env);
  }
};
