// ========== EdgeOne Edge Function: /health ==========
// 本文件由 scripts/build-edgeone.js 生成（自包含，勿手改；修改请改 _shared.js 与生成器）
// ========== EdgeOne Makers 共享逻辑（权威源） ==========
// 各 edge-functions/api/*.js 内联复制本文件内容（自包含，规避 import 兼容风险）。
// 修改此处后需同步复制到各路由文件，勿只改一处。

// ---------- JWT（HMAC-SHA256，Web Crypto；base64url 纯 JS 实现，不依赖 btoa/atob） ----------
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
function b64urlEncode(str) {
  const enc = new TextEncoder();
  return bytesToB64url(enc.encode(str));
}
function b64urlDecodeToBytes(str) {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4 ? '='.repeat(4 - (s.length % 4)) : '';
  const b64 = s + pad;
  const chars = b64.replace(/=+$/, '');
  const out = [];
  let buffer = 0, bits = 0;
  for (let i = 0; i < chars.length; i++) {
    const val = B64CHARS.indexOf(chars[i]);
    if (val === -1) continue;
    buffer = (buffer << 6) | val;
    bits += 6;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}
function b64urlDecode(str) {
  const enc = new TextDecoder();
  return enc.decode(b64urlDecodeToBytes(str));
}

const JWT = {
  async sign(payload, secret) {
    const encoder = new TextEncoder();
    const headerEncoded = b64urlEncode(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
    const payloadEncoded = b64urlEncode(JSON.stringify(payload));
    const data = `${headerEncoded}.${payloadEncoded}`;
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(data)));
    return `${headerEncoded}.${payloadEncoded}.${bytesToB64url(sig)}`;
  },
  async verify(token, secret) {
    const parts = token.split('.');
    if (parts.length !== 3) throw new Error('Invalid token');
    const [headerEncoded, payloadEncoded, sigEncoded] = parts;
    const data = `${headerEncoded}.${payloadEncoded}`;
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const sig = b64urlDecodeToBytes(sigEncoded);
    const valid = await crypto.subtle.verify('HMAC', key, sig, encoder.encode(data));
    if (!valid) throw new Error('Invalid signature');
    const payload = JSON.parse(b64urlDecode(payloadEncoded));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
  }
};

// ---------- 配置 ----------
function getConfig(env) {
  const username = env.ADMIN_USERNAME;
  const password = env.ADMIN_PASSWORD;
  const jwtSecret = env.JWT_SECRET;
  if (!username || !password || !jwtSecret) {
    throw new Error('缺少必需的环境变量：ADMIN_USERNAME, ADMIN_PASSWORD, JWT_SECRET');
  }
  return { username, password, jwtSecret };
}

// ---------- 工具 ----------
function isValidUrl(str) {
  try {
    const url = new URL(str);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch { return false; }
}

function sanitizeLink(link) {
  return {
    id: String(link.id || '').substring(0, 100),
    name: String(link.name || '').substring(0, 200),
    url: String(link.url || '').substring(0, 2048),
    fallback: String(link.fallback || '').substring(0, 10),
    status: link.status === 'inactive' ? 'inactive' : 'active'
  };
}

// ---------- 速率限制（内存，按 isolate） ----------
const rateLimiter = new Map();
function checkRateLimit(ip, limit = 8, windowMs = 60000) {
  const now = Date.now();
  if (rateLimiter.size > 1000) {
    for (const [key, rec] of rateLimiter) {
      if (now - rec.start > windowMs) rateLimiter.delete(key);
    }
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

// ---------- 认证中间件 ----------
async function requireAuth(context, env) {
  const config = getConfig(env);
  const authHeader = context.request.headers.get('Authorization') || '';
  if (!authHeader.startsWith('Bearer ')) throw new Error('未提供认证令牌');
  const token = authHeader.split(' ')[1];
  return JWT.verify(token, config.jwtSecret);
}

// ---------- 默认值 ----------
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

// ---------- favicon 多源（自包含；KV 无 TTL，用 {ts, b64} 自管理过期） ----------
function detectImageType(buf) {
  if (buf.length > 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return 'image/png';
  if (buf.length > 4 && buf[0] === 0x00 && buf[1] === 0x00 && buf[2] === 0x01 && buf[3] === 0x00) return 'image/x-icon';
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 4 && buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) return 'image/gif';
  if (buf.length > 4 && buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46) return 'image/webp';
  return 'application/octet-stream';
}

const FAVICON_FALLBACKS = [
  (d) => 'https://icon.horse/icon/' + d,
  (d) => 'https://icons.duckduckgo.com/ip3/' + d + '.ico',
  (d) => 'https://www.google.com/s2/favicons?domain=' + d + '&sz=64'
];

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
  try {
    return await tryFetchFavicon((d) => 'https://' + d + '/favicon.ico', domain, 6000);
  } catch (e) {
    console.warn('[favicon] 目标站自身图标失败:', domain, e.message);
  }
  const results = await Promise.allSettled(FAVICON_FALLBACKS.map(src => tryFetchFavicon(src, domain, 3000)));
  for (const r of results) if (r.status === 'fulfilled') return r.value;
  throw new Error('all sources failed');
}


export function onRequest() {
  const body = JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), kv: typeof NAV_LINKS !== 'undefined' });
  return new Response(body, {
    headers: { 'Content-Type': 'application/json; charset=UTF-8', 'Access-Control-Allow-Origin': '*' }
  });
}
