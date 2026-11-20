// EdgeOne Makers Edge Function —— 路由：/api/auth/verify
// 官方要求 export default function onRequest(context)；本文件自包含，不依赖 import。
// ===== 共享逻辑（各函数文件内联复制，避免 import 兼容风险）=====
// KV 绑定：控制台绑定命名空间时填的「变量名」= 运行时全局变量名。
// 用 NAV_LINKS；同时兜底 context.env.NAV_LINKS，两种取值方式都能工作。
function getKV(context) {
  try { if (typeof NAV_LINKS !== 'undefined' && NAV_LINKS) return NAV_LINKS; } catch (e) {}
  return (context && context.env && context.env.NAV_LINKS) || null;
}

function json(data, status, extraHeaders) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({
      'Content-Type': 'application/json; charset=UTF-8',
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    }, extraHeaders || {})
  });
}

function isValidUrl(str) {
  try {
    var u = new URL(str);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch (e) { return false; }
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

// JWT（HS256）：base64url 纯 JS 实现，不依赖 btoa/atob
var B64CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function bytesToB64url(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 3) {
    var b0 = bytes[i];
    var b1 = i + 1 < bytes.length ? bytes[i + 1] : 0;
    var b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += B64CHARS[b0 >> 2];
    out += B64CHARS[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64CHARS[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64CHARS[b2 & 63] : '=';
  }
  return out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function strToB64url(s) { return bytesToB64url(new TextEncoder().encode(s)); }
function b64urlToBytes(s) {
  var b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  var chars = b64.replace(/=+$/, '');
  var out = [], buffer = 0, bits = 0;
  for (var i = 0; i < chars.length; i++) {
    var v = B64CHARS.indexOf(chars[i]);
    if (v === -1) continue;
    buffer = (buffer << 6) | v; bits += 6;
    if (bits >= 8) { out.push((buffer >> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Uint8Array.from(out);
}
function b64urlToStr(s) { return new TextDecoder().decode(b64urlToBytes(s)); }

async function hmacKey(secret, usage) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, [usage]);
}

async function jwtSign(payload, secret) {
  var head = strToB64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  var body = strToB64url(JSON.stringify(payload));
  var data = head + '.' + body;
  var key = await hmacKey(secret, 'sign');
  var sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return data + '.' + bytesToB64url(new Uint8Array(sig));
}

async function jwtVerify(token, secret) {
  var parts = String(token).split('.');
  if (parts.length !== 3) throw new Error('Invalid token');
  var data = parts[0] + '.' + parts[1];
  var key = await hmacKey(secret, 'verify');
  var ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(parts[2]), new TextEncoder().encode(data));
  if (!ok) throw new Error('Invalid signature');
  var payload = JSON.parse(b64urlToStr(parts[1]));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
  return payload;
}

// 环境变量：控制台「项目设置 → 环境变量」配置 ADMIN_USERNAME / ADMIN_PASSWORD / JWT_SECRET
function getConfig(context) {
  var env = (context && context.env) || {};
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD || !env.JWT_SECRET) {
    return null;
  }
  return { username: env.ADMIN_USERNAME, password: env.ADMIN_PASSWORD, jwtSecret: env.JWT_SECRET };
}

async function requireAuth(request, context) {
  var cfg = getConfig(context);
  if (!cfg) throw new Error('服务器未配置环境变量');
  var header = request.headers.get('Authorization') || '';
  if (header.indexOf('Bearer ') !== 0) throw new Error('未提供认证令牌');
  return jwtVerify(header.slice(7), cfg.jwtSecret);
}

var DEFAULT_LINKS = [
  { id: '1', name: '临渊羡鱼博客', url: 'https://blog.fnosi.top', fallback: '临', status: 'active' },
  { id: '2', name: '临渊羡鱼图床', url: 'https://imge.fnosi.top', fallback: '图', status: 'active' },
  { id: '3', name: '文件快递柜', url: 'https://file.fnosi.top', fallback: '📁', status: 'active' },
  { id: '4', name: '飞牛NAS', url: 'https://fnos.fnosi.top', fallback: '🐮', status: 'active' },
  { id: '5', name: '临渊羡鱼资源站', url: 'https://list.fnosi.top', fallback: '📦', status: 'active' },
  { id: '6', name: '临渊羡鱼标签页', url: 'https://tab.fnosi.top', fallback: '🏷️', status: 'active' }
];
var DEFAULT_SETTINGS = { title: '🌾 友邻聚落', subtitle: '临渊羡鱼 · 且行且歌', startDate: '2025-12-01 00:00:00' };

export default async function onRequest(context) {
  if (context.request.method === 'OPTIONS') return new Response(null, { headers: { 'Access-Control-Allow-Origin': '*' } });
  try {
    var user = await requireAuth(context.request, context);
    return json({ valid: true, user: user });
  } catch (e) {
    return json({ error: e.message }, e.message.indexOf('未配置') >= 0 ? 500 : 401);
  }
}
