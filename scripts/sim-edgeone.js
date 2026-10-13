// EdgeOne Makers 本地模拟服务器（不用官方 CLI）
// 模拟：edge-functions/api/** 目录路由（文件路径→URL）+ 全局 KV 注入 + 静态资源服务
// 用法：node scripts/sim-edgeone.js [port]
const http = require('http');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const ROOT = path.resolve(__dirname, '..');
const FUNC_DIR = path.join(ROOT, 'edge-functions', 'api');
const PORT = parseInt(process.argv[2] || '8099', 10);

// ---------- 内存 KV（模拟 EdgeOne 全局 KV 绑定） ----------
const kvStore = new Map();
global.NAV_LINKS = {
  async get(key) { return kvStore.has(key) ? kvStore.get(key) : null; },
  async put(key, value) { kvStore.set(key, value); },
  async delete(key) { kvStore.delete(key); },
  async list() { return { keys: Array.from(kvStore.keys()).map(k => ({ name: k })) }; }
};

// ---------- 函数路由注册（动态 import ESM） ----------
const routes = []; // { method, pathPattern, handler }
const FUNC_METHODS = {
  onRequest: '*', onRequestGet: 'GET', onRequestPost: 'POST',
  onRequestPut: 'PUT', onRequestDelete: 'DELETE', onRequestPatch: 'PATCH', onRequestHead: 'HEAD', onRequestOptions: 'OPTIONS'
};

function registerDir(dir, basePath) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    const rel = path.relative(FUNC_DIR, full).split(path.sep).join('/');
    if (entry.isDirectory()) { registerDir(full, basePath); continue; }
    if (!entry.name.endsWith('.js')) continue;
    const urlPath = '/api/' + rel.replace(/\.js$/, '');
    const modUrl = pathToFileURL(full).href;
    import(modUrl).then(mod => {
      for (const [fnName, method] of Object.entries(FUNC_METHODS)) {
        if (typeof mod[fnName] === 'function') {
          routes.push({ method, path: urlPath, handler: mod[fnName] });
          console.log(`  [route] ${method || 'ANY'} ${urlPath} -> ${fnName} (${rel})`);
        }
      }
    }).catch(e => console.error('加载失败', rel, e.message));
  }
}

// ---------- 路径匹配（EdgeOne 风格 /api/users/[id]） ----------
function matchRoute(routes, method, pathname) {
  return routes.find(r => {
    if (r.method !== '*' && r.method !== method) return false;
    const rp = r.path.split('/'), qp = pathname.split('/');
    if (rp.length !== qp.length) return false;
    for (let i = 0; i < rp.length; i++) {
      const seg = rp[i];
      if (seg.startsWith('[') && seg.endsWith(']')) continue; // 动态段 [id]
      if (seg.startsWith('[[')) continue;
      if (seg !== qp[i]) return false;
    }
    return true;
  });
}

// ---------- 静态资源服务 ----------
const STATIC_ALLOW = ['index.html', 'admin.html', 'admin.js', 'fonts'];
function serveStatic(reqUrl, res) {
  let pathname = decodeURIComponent(new URL(reqUrl, 'http://x').pathname);
  if (pathname === '/' || pathname === '') pathname = '/index.html';
  // 只允许白名单文件
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  const first = parts[0];
  const allowed = first === 'fonts' || (parts.length === 1 && STATIC_ALLOW.includes(first));
  if (!allowed) return false;
  const filePath = path.join(ROOT, ...parts);
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath);
  const types = { '.html': 'text/html; charset=UTF-8', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2' };
  res.writeHead(200, { 'Content-Type': types[ext] || 'application/octet-stream' });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

// ---------- HTTP 服务器 ----------
function getClientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

registerDir(FUNC_DIR, '');
setTimeout(() => {
  http.createServer(async (req, res) => {
    const reqUrl = new URL(req.url, 'http://localhost');
    const route = matchRoute(routes, req.method, reqUrl.pathname);

    if (route) {
      // 读取请求体（GET/HEAD 无 body）
      let rawBody = null;
      if (!['GET', 'HEAD'].includes(req.method)) {
        rawBody = await new Promise((resolve) => {
          const chunks = [];
          req.on('data', c => chunks.push(c));
          req.on('end', () => resolve(Buffer.concat(chunks)));
          req.on('error', () => resolve(Buffer.alloc(0)));
        });
      }
      // 构造 EdgeOne context：request / env / params / clientIp
      const context = {
        request: new Request('http://localhost' + req.url, {
          method: req.method,
          headers: req.headers,
          body: rawBody
        }),
        env: { ADMIN_USERNAME: process.env.ADMIN_USERNAME || 'admin', ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || 'TestPassw0rd!', JWT_SECRET: process.env.JWT_SECRET || 'local-dev-secret-0123456789abcdef' },
        params: {},
        clientIp: getClientIp(req),
        waitUntil: () => {}
      };
      try {
        const resp = await route.handler(context);
        // 传递响应
        const buf = Buffer.from(await resp.arrayBuffer());
        res.writeHead(resp.status, Object.fromEntries(resp.headers));
        res.end(buf);
      } catch (e) {
        console.error('[sim] handler error:', e);
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal Server Error', detail: e.message }));
      }
      return;
    }
    if (!serveStatic(req.url, res)) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
    }
  }).listen(PORT, () => {
    console.log(`✅ EdgeOne 模拟服务器已启动: http://localhost:${PORT}`);
    console.log('   函数路由:');
  });
}, 500);
