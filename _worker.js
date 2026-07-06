// Cloudflare Worker - 纯 JavaScript 实现

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
    const signature = Uint8Array.from(atob(signatureEncoded.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
    const isValid = await crypto.subtle.verify('HMAC', key, signature, encoder.encode(data));
    if (!isValid) throw new Error('Invalid signature');
    const payload = JSON.parse(this.base64UrlDecode(payloadEncoded));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('Token expired');
    return payload;
  }
};

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
        const c = {
          req: {
            json: async () => request.json(),
            header: (name) => request.headers.get(name),
            raw: request,
            param: (name) => params[name],
          },
          env: env,
          set: (key, value) => { c._data = c._data || {}; c._data[key] = value; },
          get: (key) => c._data ? c._data[key] : undefined,
        };
        try {
          for (const middleware of route.middlewares) {
            let nextCalled = false;
            const result = await middleware(c, () => { nextCalled = true; });
            if (!nextCalled && result) return this.addCors(result);
          }
          const result = await route.handler(c);
          return this.addCors(result);
        } catch (error) {
          return this.addCors(new Response(JSON.stringify({ error: 'Internal Server Error' }), { status: 500, headers: { 'Content-Type': 'application/json' } }));
        }
      }
    }
    try { return env.ASSETS.fetch(request); } catch (e) { return new Response('Not Found', { status: 404 }); }
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

function getConfig(env) {
  return {
    username: env.ADMIN_USERNAME || 'admin',
    password: env.ADMIN_PASSWORD || 'fnosi2024',
    jwtSecret: env.JWT_SECRET || 'default-secret-change-in-production',
  };
}

const DEFAULT_LINKS = [
  { id: '1', name: '临渊羡鱼博客', url: 'https://blog.fnosi.top', fallback: '临', status: 'active', order: 0 },
  { id: '2', name: '临渊羡鱼图床', url: 'https://imge.fnosi.top', fallback: '图', status: 'active', order: 1 },
  { id: '3', name: '文件快递柜', url: 'https://file.fnosi.top', fallback: '📁', status: 'active', order: 2 },
  { id: '4', name: '飞牛NAS', url: 'https://fnos.fnosi.top', fallback: '🐮', status: 'active', order: 3 },
  { id: '5', name: '临渊羡鱼资源站', url: 'https://list.fnosi.top', fallback: '📦', status: 'active', order: 4 },
  { id: '6', name: '临渊羡鱼标签页', url: 'https://tab.fnosi.top', fallback: '🏷️', status: 'active', order: 5 }
];

async function authMiddleware(c, next) {
  const config = getConfig(c.env);
  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: '未提供认证令牌' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  try {
    const token = authHeader.split(' ')[1];
    const payload = await JWT.verify(token, config.jwtSecret);
    c.set('user', payload);
    await next();
  } catch (error) {
    return new Response(JSON.stringify({ error: '令牌无效或已过期' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
}

router.post('/api/auth/login', async (c) => {
  try {
    const body = await c.req.json();
    const { username, password } = body;
    const config = getConfig(c.env);
    if (!username || !password) return new Response(JSON.stringify({ error: '请提供用户名和密码' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    if (username !== config.username || password !== config.password) return new Response(JSON.stringify({ error: '用户名或密码错误' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    const payload = { username, role: 'admin', exp: Math.floor(Date.now() / 1000) + 3600, iat: Math.floor(Date.now() / 1000) };
    const token = await JWT.sign(payload, config.jwtSecret);
    return new Response(JSON.stringify({ token, user: { username, role: 'admin' }, expiresIn: 3600 }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: '服务器内部错误' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

router.get('/api/auth/verify', authMiddleware, async (c) => {
  return new Response(JSON.stringify({ valid: true, user: c.get('user') }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

router.get('/api/links', async (c) => {
  try {
    if (c.env.NAV_LINKS) {
      const linksData = await c.env.NAV_LINKS.get('links');
      if (linksData) return new Response(JSON.stringify({ links: JSON.parse(linksData), source: 'kv' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ links: DEFAULT_LINKS, source: 'default' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ links: DEFAULT_LINKS, source: 'fallback' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }
});

router.put('/api/links', authMiddleware, async (c) => {
  try {
    const body = await c.req.json();
    const { links } = body;
    if (!links || !Array.isArray(links)) return new Response(JSON.stringify({ error: '无效的数据格式' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    for (const link of links) {
      if (!link.id || !link.name || !link.url) return new Response(JSON.stringify({ error: '链接数据不完整' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
    if (c.env.NAV_LINKS) {
      await c.env.NAV_LINKS.put('links', JSON.stringify(links));
      return new Response(JSON.stringify({ success: true, message: '链接已保存', count: links.length }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ error: 'KV 存储未配置' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return new Response(JSON.stringify({ error: '保存失败' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});

router.get('/api/health', async (c) => {
  return new Response(JSON.stringify({ status: 'ok', timestamp: new Date().toISOString(), kv: !!c.env.NAV_LINKS }), { status: 200, headers: { 'Content-Type': 'application/json' } });
});

export default {
  async fetch(request, env) {
    return router.handle(request, env);
  }
};