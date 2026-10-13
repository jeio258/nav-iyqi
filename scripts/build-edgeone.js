#!/usr/bin/env node
// ========== EdgeOne Makers 自包含函数生成器 ==========
// 读取 edge-functions/_shared.js（共享逻辑权威源），拼接各路由的 handler，
// 生成自包含的 edge-functions/api/*.js（规避 EdgeOne import 兼容风险）。
// 用法：node scripts/build-edgeone.js
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SHARED = fs.readFileSync(path.join(ROOT, 'edge-functions', '_shared.js'), 'utf8');
const OUT_DIR = path.join(ROOT, 'edge-functions', 'api');

// 每个路由：file = 生成文件名；code = handler 源码（引用共享逻辑中的函数/常量）
const ROUTES = [
  {
    file: 'health.js',
    code: `
export function onRequest() {
  const body = JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), kv: typeof NAV_LINKS !== 'undefined' });
  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
  });
}`
  },
  {
    file: 'auth/login.js',
    code: `
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
});

export async function onRequest(context) {
  const { request, env } = context;
  const ip = request.headers.get('EO-Client-IP') || request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  let config;
  try { config = getConfig(env); }
  catch (e) { return json({ error: '服务器未正确配置认证信息' }, 500); }

  if (!checkRateLimit(ip, 8, 60000)) {
    return json({ error: '请求过于频繁，请稍后再试' }, 429);
  }
  try {
    const body = await request.json();
    const { username, password } = body;
    if (!username || !password) return json({ error: '请提供用户名和密码' }, 400);
    if (username !== config.username || password !== config.password) {
      return json({ error: '用户名或密码错误' }, 401);
    }
    const now = Math.floor(Date.now() / 1000);
    const token = await JWT.sign({ username, role: 'admin', exp: now + 3600, iat: now }, config.jwtSecret);
    return json({ token, user: { username, role: 'admin' }, expiresIn: 3600 });
  } catch (e) {
    console.error('[login] error:', e.message);
    return json({ error: '服务器内部错误' }, 500);
  }
}`
  },
  {
    file: 'auth/verify.js',
    code: `
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
});

export async function onRequest(context) {
  const { request, env } = context;
  let config;
  try { config = getConfig(env); } catch (e) { return json({ error: '服务器未正确配置认证信息' }, 500); }
  try {
    const user = await requireAuth(context, env);
    return json({ valid: true, user });
  } catch (e) {
    return json({ error: '令牌无效或已过期' }, 401);
  }
}`
  },
  {
    file: 'links.js',
    code: `
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
});

function getKV() { return typeof NAV_LINKS !== 'undefined' ? NAV_LINKS : null; }

export async function onRequestGet(context) {
  try {
    const kv = getKV();
    if (kv) {
      const data = await kv.get('links');
      if (data) return json({ links: JSON.parse(data), source: 'kv' });
    }
    return json({ links: DEFAULT_LINKS, source: 'default' });
  } catch (e) {
    console.error('[links] read error:', e.message);
    return json({ links: DEFAULT_LINKS, source: 'fallback' });
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    await requireAuth(context, env);
  } catch (e) {
    return json({ error: '令牌无效或已过期' }, 401);
  }
  try {
    const body = await request.json();
    const { links } = body;
    if (!links || !Array.isArray(links)) return json({ error: '无效的数据格式' }, 400);
    if (links.length > 200) return json({ error: '链接数量不能超过 200 个' }, 400);

    const cleaned = [];
    for (const link of links) {
      if (!link.id || !link.name || !link.url) return json({ error: '链接数据不完整：需要 id、name、url' }, 400);
      if (!isValidUrl(link.url)) return json({ error: '无效的 URL' }, 400);
      cleaned.push(sanitizeLink(link));
    }
    const kv = getKV();
    if (!kv) return json({ error: 'KV 存储未配置' }, 500);
    await kv.put('links', JSON.stringify(cleaned));
    return json({ success: true, message: '链接已保存', count: cleaned.length });
  } catch (e) {
    console.error('[links] save error:', e.message);
    return json({ error: '保存失败' }, 500);
  }
}`
  },
  {
    file: 'settings.js',
    code: `
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
});

function getKV() { return typeof NAV_LINKS !== 'undefined' ? NAV_LINKS : null; }

export async function onRequestGet() {
  try {
    const kv = getKV();
    if (kv) {
      const data = await kv.get('settings');
      if (data) return json({ settings: JSON.parse(data), source: 'kv' });
    }
    return json({ settings: DEFAULT_SETTINGS, source: 'default' });
  } catch (e) {
    return json({ settings: DEFAULT_SETTINGS, source: 'fallback' });
  }
}

export async function onRequestPut(context) {
  const { request, env } = context;
  try {
    await requireAuth(context, env);
  } catch (e) {
    return json({ error: '令牌无效或已过期' }, 401);
  }
  try {
    const body = await request.json();
    const { settings } = body;
    if (!settings || typeof settings !== 'object') return json({ error: '无效的数据格式' }, 400);
    const cleaned = {
      title: String(settings.title || '').substring(0, 100),
      subtitle: String(settings.subtitle || '').substring(0, 200),
      startDate: String(settings.startDate || '').substring(0, 50)
    };
    const kv = getKV();
    if (!kv) return json({ error: 'KV 存储未配置' }, 500);
    await kv.put('settings', JSON.stringify(cleaned));
    return json({ success: true, message: '设置已保存' });
  } catch (e) {
    return json({ error: '保存失败' }, 500);
  }
}`
  },
  {
    file: 'favicon.js',
    code: `
function getKV() { return typeof NAV_LINKS !== 'undefined' ? NAV_LINKS : null; }
const FAVICON_TTL = 7 * 24 * 3600 * 1000; // 7 天（ms），KV 无 TTL 故自管理

export async function onRequest(context) {
  const url = new URL(context.request.url);
  const target = url.searchParams.get('url') || '';
  let u;
  try { u = new URL(target); } catch { u = null; }
  if (!u || (u.protocol !== 'http:' && u.protocol !== 'https:')) {
    return new Response('Bad Request', { status: 400 });
  }
  const domain = u.hostname;
  const key = 'favicon:' + domain;

  try {
    const kv = getKV();
    if (kv) {
      const cached = await kv.get(key);
      if (cached) {
        const rec = JSON.parse(cached);
        if (rec && rec.ts && Date.now() - rec.ts < FAVICON_TTL && rec.b64) {
          const buf = b64urlDecodeToBytes(rec.b64);
          return new Response(buf, {
            headers: { 'Content-Type': detectImageType(buf), 'Cache-Control': 'public, max-age=604800' }
          });
        }
      }
    }
    const buf = await fetchFavicon(domain);
    if (kv && buf.length < 1024 * 1024) {
      await kv.put(key, JSON.stringify({ ts: Date.now(), b64: bytesToB64url(buf) }));
    }
    return new Response(buf, {
      headers: { 'Content-Type': detectImageType(buf), 'Cache-Control': 'public, max-age=604800' }
    });
  } catch (e) {
    console.warn('[favicon] fetch failed:', domain, e.message);
    return new Response('Not Found', { status: 404 });
  }
}`
  }
];

let created = 0;
for (const route of ROUTES) {
  const outPath = path.join(OUT_DIR, route.file);
  const content = `// ========== EdgeOne Edge Function: /${route.file.replace('.js', '')} ==========\n// 本文件由 scripts/build-edgeone.js 生成（自包含，勿手改；修改请改 _shared.js 与生成器）\n${SHARED}\n${route.code}\n`;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, content);
  created++;
  console.log('生成:', route.file);
}
console.log('完成，共生成', created, '个函数文件 →', OUT_DIR);
