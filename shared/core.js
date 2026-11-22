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
