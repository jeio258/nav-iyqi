// ===== 浏览器端公共层（唯一来源）=====
// 本文件不直接部署；由 scripts/build.js 注入到 index.html / admin.html 的
// <script> 中（注入区标记 @inject:frontend-common）。admin.js 作为外部脚本
// 复用同一页面内的这些全局函数。
// 修改后必须运行：node scripts/build.js
//
// 为什么内联而不做成外部 common.js：applyTheme 必须在首屏渲染前执行，
// 外链脚本会延迟执行导致主题闪白；内联且被两页共享源码可兼顾一致性与速度。

var NAV = {
  // 存储键：前端各页面与后台必须一致，集中定义避免「改一处漏一处」
  storage: {
    token: 'admin_token',
    links: 'nav_links',
    linksUpdatedAt: 'nav_links_updated_at',
    settings: 'nav_settings',
    linksCache: 'nav_links_cache',
    iconCache: 'nav_icon_cache_v1',
    theme: 'theme'
  },
  // 后端接口路径（与 shared/core.js 的路由表对应）
  api: {
    login: '/api/auth/login',
    verify: '/api/auth/verify',
    links: '/api/links',
    settings: '/api/settings',
    health: '/api/health'
  },
  // 浏览器地址栏主题色
  themeColor: { light: '#f5ebe0', dark: '#1a1512' },
  // 图标代理（浏览器直连；CF 边缘访问 faviconsnap 会超时，勿改为服务端代理）
  iconApi: 'https://faviconsnap.com/api/favicon?url='
};

function readJSON(key, fallback) {
  try {
    var raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch (e) { return fallback; }
}

function writeJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 配额满/隐私模式 */ }
}

// 应用主题：同步 DOM 属性、按钮文案、地址栏颜色并持久化
function applyTheme(theme) {
  var dark = theme === 'dark';
  if (dark) document.documentElement.setAttribute('data-theme', 'dark');
  else document.documentElement.removeAttribute('data-theme');

  var icon = document.getElementById('themeIcon');
  var label = document.getElementById('themeLabel');
  if (icon) icon.textContent = dark ? '☀️' : '🌙';
  if (label) label.textContent = dark ? '浅色' : '深色';

  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? NAV.themeColor.dark : NAV.themeColor.light);

  try { localStorage.setItem(NAV.storage.theme, theme); } catch (e) {}
}

function currentTheme() {
  return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
}

// 初始化主题：优先用户选择，其次跟随系统
function initTheme() {
  var saved = localStorage.getItem(NAV.storage.theme);
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  applyTheme(saved || (prefersDark ? 'dark' : 'light'));
}
