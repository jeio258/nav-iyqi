// ========== 配置 ==========
var API = '/api';
var KEYS = {
    token: 'admin_token',
    links: 'nav_links',
    linksUpdatedAt: 'nav_links_updated_at',
    settings: 'nav_settings',
    theme: 'theme'
};

// KV 不可达时的兜底列表：若后台加载失败且用户直接编辑，getLinks() 为空数组会导致
// 保存时用「仅含新增项」的列表覆盖云端全部数据。此处返回默认值可避免该数据丢失路径
var DEFAULT_LINKS = [
    { id: '1', name: '临渊羡鱼博客', url: 'https://blog.fnosi.top', fallback: '临', status: 'active' },
    { id: '2', name: '临渊羡鱼图床', url: 'https://imge.fnosi.top', fallback: '图', status: 'active' },
    { id: '3', name: '文件快递柜', url: 'https://file.fnosi.top', fallback: '📁', status: 'active' },
    { id: '4', name: '飞牛NAS', url: 'https://fnos.fnosi.top', fallback: '🐮', status: 'active' },
    { id: '5', name: '临渊羡鱼资源站', url: 'https://list.fnosi.top', fallback: '📦', status: 'active' },
    { id: '6', name: '临渊羡鱼标签页', url: 'https://tab.fnosi.top', fallback: '🏷️', status: 'active' }
];

var DEFAULT_SETTINGS = {
    title: '🌾 友邻聚落',
    subtitle: '临渊羡鱼 · 且行且歌',
    startDate: '2025-12-01 00:00:00'
};

// ========== DOM 与工具 ==========
function $(id) { return document.getElementById(id); }

function readJSON(key, fallback) {
    try {
        var raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
}

function writeJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
}

// 静默状态提示：成功 2s、错误 4s 自动消失
function showStatus(id, message, isError) {
    var node = $(id);
    if (!node) return;
    node.textContent = message;
    node.className = 'alert alert-' + (isError ? 'error' : 'success');
    node.style.display = 'block';
    setTimeout(function () { node.style.display = 'none'; }, isError ? 4000 : 2000);
}

function isValidUrl(str) {
    try {
        var u = new URL(str);
        return u.protocol === 'http:' || u.protocol === 'https:';
    } catch (e) { return false; }
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

// ========== 本地数据 ==========
function getLinks() {
    var links = readJSON(KEYS.links, null);
    return Array.isArray(links) ? links : DEFAULT_LINKS.slice();
}

function saveLinksLocal(links) {
    writeJSON(KEYS.links, links);
    // 写入更新戳（同源 localStorage 共享），首页据此使旧缓存立即失效，
    // 否则后台新增链接后首页仍先用缓存渲染旧数据，表现为需要刷新两遍
    try { localStorage.setItem(KEYS.linksUpdatedAt, String(Date.now())); } catch (e) {}
}

function getSettings() {
    return Object.assign({}, DEFAULT_SETTINGS, readJSON(KEYS.settings, null) || {});
}

function saveSettingsLocal(settings) { writeJSON(KEYS.settings, settings); }

// ========== 认证 ==========
function getToken() { return localStorage.getItem(KEYS.token); }
function setToken(token) { localStorage.setItem(KEYS.token, token); }
function clearToken() { localStorage.removeItem(KEYS.token); }

// 本地快速判断：仅解 payload 看 exp，真实有效性以服务端 verify 为准
function tokenLooksValid() {
    var token = getToken();
    if (!token) return false;
    try {
        var part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
        while (part.length % 4) part += '=';
        var payload = JSON.parse(atob(part));
        return !!payload.exp && payload.exp > Math.floor(Date.now() / 1000);
    } catch (e) { return false; }
}

function authHeaders() {
    return { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + getToken() };
}

async function apiFetch(path, options) {
    var response = await fetch(API + path, options);
    var data = null;
    try { data = await response.json(); } catch (e) {}
    return { ok: response.ok, status: response.status, data: data };
}

async function login(username, password) {
    try {
        var res = await apiFetch('/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });
        if (!res.ok || !res.data || !res.data.token) return { ok: false, error: (res.data && res.data.error) || '登录失败' };
        setToken(res.data.token);
        return { ok: true };
    } catch (e) {
        return { ok: false, error: '网络异常，请稍后重试' };
    }
}

async function verifyTokenOnServer() {
    if (!getToken()) return false;
    try {
        var res = await apiFetch('/auth/verify', { headers: authHeaders() });
        return res.ok;
    } catch (e) { return false; }
}

// ========== 链接同步（唯一 PUT 路径，自动保存与手动同步共用） ==========
async function putLinks(links) {
    if (!getToken()) return { ok: false, error: '登录已过期' };
    try {
        var res = await apiFetch('/links', {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ links: links })
        });
        if (!res.ok) return { ok: false, error: (res.data && res.data.error) || '同步失败' };
        return { ok: true, count: (res.data && res.data.count) || links.length };
    } catch (e) {
        return { ok: false, error: '网络异常，请检查连接' };
    }
}

async function autoSave(links) {
    var res = await putLinks(links);
    if (res.ok) showStatus('saveAlert', '✅ 已同步到云端');
    else showStatus('saveAlert', '⚠️ ' + res.error, true);
    return res.ok;
}

async function manualSync() {
    var links = getLinks();
    var res = await putLinks(links);
    if (!res.ok) {
        if (res.error === '登录已过期') { clearToken(); showLoginPanel(); }
        showStatus('saveAlert', '❌ ' + res.error, true);
        return;
    }
    showStatus('saveAlert', '✅ 已同步 ' + res.count + ' 个链接到云端');
}

async function loadLinksFromServer() {
    try {
        var res = await apiFetch('/links');
        if (res.ok && res.data && Array.isArray(res.data.links) && res.data.links.length) {
            saveLinksLocal(res.data.links);
            return res.data.links;
        }
    } catch (e) {
        console.warn('从服务器加载链接失败:', e.message);
    }
    return getLinks();
}

// ========== 链接列表渲染 ==========
function renderLinks(links) {
    var list = $('linkList');
    list.textContent = '';

    if (!links || links.length === 0) {
        var empty = document.createElement('li');
        empty.style.cssText = 'text-align:center;padding:3rem;color:var(--color-ink-2)';
        empty.textContent = '📭 暂无链接，点击「添加」按钮创建';
        list.appendChild(empty);
        return;
    }

    var fragment = document.createDocumentFragment();

    links.forEach(function (link) {
        var item = document.createElement('li');
        item.className = 'link-item';
        item.setAttribute('data-id', link.id);

        var info = document.createElement('div');
        info.className = 'link-info';

        var avatar = document.createElement('div');
        avatar.className = 'link-avatar';
        avatar.textContent = String(link.fallback || '🔗');

        var details = document.createElement('div');
        details.className = 'link-details';

        var title = document.createElement('h4');
        title.textContent = String(link.name || '');

        var badge = document.createElement('span');
        var inactive = link.status === 'inactive';
        badge.className = 'badge ' + (inactive ? 'badge-inactive' : 'badge-active');
        badge.textContent = inactive ? '已禁用' : '启用中';
        title.appendChild(badge);

        var urlLine = document.createElement('span');
        urlLine.textContent = String(link.url || '');

        details.appendChild(title);
        details.appendChild(urlLine);
        info.appendChild(avatar);
        info.appendChild(details);

        var actions = document.createElement('div');
        actions.className = 'link-actions';

        var editBtn = document.createElement('button');
        editBtn.className = 'btn btn-secondary btn-sm edit-btn';
        editBtn.textContent = '✏️ 编辑';
        editBtn.addEventListener('click', function () { openLinkModal(link.id); });

        var delBtn = document.createElement('button');
        delBtn.className = 'btn btn-danger btn-sm delete-btn';
        delBtn.textContent = '🗑️ 删除';
        delBtn.addEventListener('click', function () { openDeleteModal(link.id); });

        actions.appendChild(editBtn);
        actions.appendChild(delBtn);

        item.appendChild(info);
        item.appendChild(actions);
        fragment.appendChild(item);
    });

    list.appendChild(fragment);
}

async function refreshLinks() {
    var list = $('linkList');
    list.textContent = '';
    var loading = document.createElement('li');
    loading.style.cssText = 'text-align:center;padding:2rem;color:var(--color-ink-2)';
    loading.textContent = '加载中...';
    list.appendChild(loading);

    renderLinks(await loadLinksFromServer());
}

// ========== 链接编辑模态框（新增/编辑共用一套填充逻辑） ==========
function fillLinkForm(link) {
    $('modalTitle').textContent = link ? '编辑链接' : '添加链接';
    $('linkId').value = link ? link.id : '';
    $('linkName').value = link ? link.name : '';
    $('linkUrl').value = link ? link.url : '';
    $('linkFallback').value = link ? (link.fallback || '') : '';
    $('linkStatus').value = link ? (link.status || 'active') : 'active';
    $('modalAlert').style.display = 'none';
    $('linkModal').classList.add('active');
    setTimeout(function () { $('linkName').focus(); }, 100);
}

function openLinkModal(id) {
    var link = null;
    if (id) {
        var links = getLinks();
        for (var i = 0; i < links.length; i++) {
            if (links[i].id === id) { link = links[i]; break; }
        }
        if (!link) return;
    }
    fillLinkForm(link);
}

function openDeleteModal(id) {
    $('deleteId').value = id;
    $('deleteModal').classList.add('active');
}

function closeModal(modalId) {
    $(modalId).classList.remove('active');
}

function saveLink() {
    var id = $('linkId').value;
    var name = $('linkName').value.trim();
    var url = $('linkUrl').value.trim();
    var fallback = $('linkFallback').value.trim();
    var status = $('linkStatus').value;

    if (!name) return showStatus('modalAlert', '请输入链接名称', true);
    if (!url) return showStatus('modalAlert', '请输入链接地址', true);
    if (!isValidUrl(url)) return showStatus('modalAlert', '请输入有效的 URL（http:// 或 https:// 开头）', true);

    var links = getLinks();
    var record = {
        id: id || generateId(),
        name: name,
        url: url,
        fallback: fallback || name.charAt(0),
        status: status
    };

    var found = false;
    for (var i = 0; i < links.length; i++) {
        if (links[i].id === id) { links[i] = record; found = true; break; }
    }
    if (!found) links.push(record);

    saveLinksLocal(links);
    closeModal('linkModal');
    renderLinks(links);
    autoSave(links);
}

function deleteLink() {
    var id = $('deleteId').value;
    var links = getLinks().filter(function (l) { return l.id !== id; });
    saveLinksLocal(links);
    closeModal('deleteModal');
    renderLinks(links);
    autoSave(links);
}

// ========== 站点设置 ==========
function fillSettingsForm(settings) {
    var s = settings || getSettings();
    $('siteTitle').value = s.title || '';
    $('siteSubtitle').value = s.subtitle || '';
    $('siteStartDate').value = s.startDate || '';
}

async function loadSettingsFromServer() {
    try {
        var res = await apiFetch('/settings');
        if (res.ok && res.data && res.data.settings) {
            saveSettingsLocal(res.data.settings);
            return res.data.settings;
        }
    } catch (e) {}
    return null;
}

async function saveSettings() {
    var settings = {
        title: $('siteTitle').value.trim(),
        subtitle: $('siteSubtitle').value.trim(),
        startDate: $('siteStartDate').value.trim()
    };
    saveSettingsLocal(settings);

    if (!getToken()) {
        showStatus('settingsAlert', '✅ 已保存（本地）');
        return;
    }

    try {
        var res = await apiFetch('/settings', {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify({ settings: settings })
        });
        if (res.ok) showStatus('settingsAlert', '✅ 已保存并同步到云端');
        else showStatus('settingsAlert', '⚠️ 已存本地，云端同步失败', true);
    } catch (e) {
        showStatus('settingsAlert', '⚠️ 已存本地，云端同步失败', true);
    }
}

// ========== 面板切换 ==========
function showAdminPanel() {
    $('loginPanel').style.display = 'none';
    $('adminPanel').style.display = 'block';
    refreshLinks();
    loadSettingsFromServer().then(fillSettingsForm);
}

function showLoginPanel() {
    $('adminPanel').style.display = 'none';
    $('loginPanel').style.display = 'block';
    $('username').value = '';
    $('password').value = '';
    $('loginAlert').style.display = 'none';
}

// ========== 主题（与 index.html 共用同一 key） ==========
function applyTheme(theme) {
    var dark = theme === 'dark';
    if (dark) document.documentElement.setAttribute('data-theme', 'dark');
    else document.documentElement.removeAttribute('data-theme');

    var icon = $('themeIcon');
    var label = $('themeLabel');
    if (icon) icon.textContent = dark ? '☀️' : '🌙';
    if (label) label.textContent = dark ? '浅色' : '深色';

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', dark ? '#1a1512' : '#f5ebe0');

    localStorage.setItem(KEYS.theme, theme);
}

// ========== 事件绑定 ==========
document.addEventListener('DOMContentLoaded', async function () {
    if (tokenLooksValid() && await verifyTokenOnServer()) showAdminPanel();
    else { clearToken(); showLoginPanel(); }

    applyTheme(localStorage.getItem(KEYS.theme) ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));

    // 登录
    $('loginBtn').addEventListener('click', async function () {
        var username = $('username').value.trim();
        var password = $('password').value;
        if (!username || !password) return showStatus('loginAlert', '请输入用户名和密码', true);

        var btn = $('loginBtn');
        btn.disabled = true;
        btn.textContent = '登录中...';
        var result = await login(username, password);
        btn.disabled = false;
        btn.textContent = '登录';

        if (result.ok) showAdminPanel();
        else showStatus('loginAlert', result.error, true);
    });

    $('password').addEventListener('keypress', function (e) {
        if (e.key === 'Enter') $('loginBtn').click();
    });

    $('logoutBtn').addEventListener('click', function () {
        if (confirm('确定要退出登录吗？')) { clearToken(); showLoginPanel(); }
    });

    $('saveToServerBtn').addEventListener('click', manualSync);
    $('refreshBtn').addEventListener('click', refreshLinks);
    $('addLinkBtn').addEventListener('click', function () { openLinkModal(null); });
    $('saveLinkBtn').addEventListener('click', saveLink);
    $('cancelLinkBtn').addEventListener('click', function () { closeModal('linkModal'); });
    $('confirmDeleteBtn').addEventListener('click', deleteLink);
    $('cancelDeleteBtn').addEventListener('click', function () { closeModal('deleteModal'); });
    $('saveSettingsBtn').addEventListener('click', saveSettings);

    $('themeToggle').addEventListener('click', function () {
        applyTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');
    });

    // 点击遮罩关闭 / ESC 关闭
    ['linkModal', 'deleteModal'].forEach(function (modalId) {
        $(modalId).addEventListener('click', function (e) {
            if (e.target === e.currentTarget) closeModal(modalId);
        });
    });

    document.addEventListener('keydown', function (e) {
        if (e.key !== 'Escape') return;
        if ($('linkModal').classList.contains('active')) closeModal('linkModal');
        if ($('deleteModal').classList.contains('active')) closeModal('deleteModal');
    });

    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
        if (!localStorage.getItem(KEYS.theme)) applyTheme(e.matches ? 'dark' : 'light');
    });
});
