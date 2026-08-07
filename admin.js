// ========== 配置 ==========
var API_BASE = '/api';
var TOKEN_KEY = 'admin_token';
var LINKS_STORAGE_KEY = 'nav_links';
var SETTINGS_STORAGE_KEY = 'nav_settings';
var THEME_KEY = 'theme';

// 默认链接数据
var DEFAULT_LINKS = [
    { id: '1', name: '临渊羡鱼博客', url: 'https://blog.fnosi.top', fallback: '临', status: 'active', order: 0 },
    { id: '2', name: '临渊羡鱼图床', url: 'https://imge.fnosi.top', fallback: '图', status: 'active', order: 1 },
    { id: '3', name: '文件快递柜', url: 'https://file.fnosi.top', fallback: '📁', status: 'active', order: 2 },
    { id: '4', name: '飞牛NAS', url: 'https://fnos.fnosi.top', fallback: '🐮', status: 'active', order: 3 },
    { id: '5', name: '临渊羡鱼资源站', url: 'https://list.fnosi.top', fallback: '📦', status: 'active', order: 4 },
    { id: '6', name: '临渊羡鱼标签页', url: 'https://tab.fnosi.top', fallback: '🏷️', status: 'active', order: 5 }
];

var DEFAULT_SETTINGS = {
    title: '🌾 友邻聚落',
    subtitle: '临渊羡鱼 · 且行且歌',
    startDate: '2025-12-01 00:00:00'
};

// ========== XSS 防护 ==========
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ========== 工具函数 ==========
function getLinks() {
    var stored = localStorage.getItem(LINKS_STORAGE_KEY);
    if (stored) {
        try { return JSON.parse(stored); } catch (e) { return DEFAULT_LINKS.slice(); }
    }
    return DEFAULT_LINKS.slice();
}

function saveLinks(links) {
    localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(links));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function getSettings() {
    var stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
        try { return Object.assign({}, DEFAULT_SETTINGS, JSON.parse(stored)); } catch (e) { return Object.assign({}, DEFAULT_SETTINGS); }
    }
    return Object.assign({}, DEFAULT_SETTINGS);
}

function saveSettingsLocal(settings) {
    localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
}

function getToken() {
    return localStorage.getItem(TOKEN_KEY);
}

function setToken(token) {
    localStorage.setItem(TOKEN_KEY, token);
}

function clearToken() {
    localStorage.removeItem(TOKEN_KEY);
}

function isAuthenticated() {
    var token = getToken();
    if (!token) return false;
    try {
        var payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp > Math.floor(Date.now() / 1000);
    } catch (e) {
        return false;
    }
}

// 静默状态提示（替代弹窗 alert，符合 design.md "静默成功" 原则）
function showStatus(elementId, message, type) {
    var el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = 'alert alert-' + (type || 'success');
    el.style.display = 'block';
    // 成功消息 2 秒后自动消失，错误消息 4 秒
    var delay = type === 'error' ? 4000 : 2000;
    setTimeout(function() { el.style.display = 'none'; }, delay);
}

// ========== 登录功能 ==========
async function login(username, password) {
    try {
        var response = await fetch(API_BASE + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: username, password: password })
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || '登录失败');
        setToken(data.token);
        return true;
    } catch (error) {
        console.error('登录错误:', error);
        return false;
    }
}

// 服务端验证令牌
async function verifyTokenOnServer() {
    var token = getToken();
    if (!token) return false;
    try {
        var response = await fetch(API_BASE + '/auth/verify', {
            headers: { 'Authorization': 'Bearer ' + token }
        });
        return response.ok;
    } catch (e) {
        return false;
    }
}

// ========== 从服务器加载链接 ==========
async function loadLinksFromServer() {
    try {
        var response = await fetch(API_BASE + '/links');
        if (!response.ok) throw new Error('加载失败');
        var data = await response.json();
        if (data.links && data.links.length > 0) {
            saveLinks(data.links);
            return data.links;
        }
    } catch (error) {
        console.warn('从服务器加载链接失败:', error.message);
    }
    return getLinks();
}

// ========== 自动保存到 KV ==========
async function autoSaveToServer(links) {
    var token = getToken();
    if (!token) { console.warn('未登录，无法自动保存'); return false; }
    try {
        var response = await fetch(API_BASE + '/links', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ links: links })
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || '自动保存失败');
        console.log('✅ 已自动保存到 KV:', data.count, '个链接');
        // 静默成功：视觉状态已更新，仅控制台记录
        var alertEl = document.getElementById('saveAlert');
        if (alertEl) {
            alertEl.textContent = '✅ 已同步到云端';
            alertEl.className = 'alert alert-success';
            alertEl.style.display = 'block';
            setTimeout(function() { alertEl.style.display = 'none'; }, 1500);
        }
        return true;
    } catch (error) {
        console.error('自动保存失败:', error.message);
        showStatus('saveAlert', '⚠️ 同步失败，请检查网络', 'error');
        return false;
    }
}

// ========== 手动保存 ==========
async function saveLinksToServer() {
    var token = getToken();
    if (!token) { showStatus('saveAlert', '登录已过期，请重新登录', 'error'); clearToken(); showLoginPanel(); return; }
    var links = getLinks();
    try {
        var response = await fetch(API_BASE + '/links', {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': 'Bearer ' + token
            },
            body: JSON.stringify({ links: links })
        });
        var data = await response.json();
        if (!response.ok) throw new Error(data.error || '保存失败');
        showStatus('saveAlert', '✅ 已同步 ' + (data.count || links.length) + ' 个链接到云端', 'success');
    } catch (error) {
        console.error('保存失败:', error);
        showStatus('saveAlert', '❌ 保存失败: ' + error.message, 'error');
    }
}

// ========== UI 更新（已含 XSS 防护） ==========
function renderLinks(links) {
    var linkList = document.getElementById('linkList');
    if (!links || links.length === 0) {
        linkList.innerHTML = '<li style="text-align: center; padding: 3rem; color: var(--color-ink-2);"><p>📭 暂无链接，点击"添加"按钮创建</p></li>';
        return;
    }
    var html = '';
    for (var i = 0; i < links.length; i++) {
        var link = links[i];
        var name = escapeHtml(link.name);
        var url = escapeHtml(link.url);
        var fallback = escapeHtml(link.fallback || '🔗');
        var statusBadge = link.status === 'inactive'
            ? '<span class="badge badge-inactive">已禁用</span>'
            : '<span class="badge badge-active">启用中</span>';
        html += '<li class="link-item" data-id="' + escapeHtml(link.id) + '">' +
            '<div class="link-info">' +
                '<div class="link-avatar">' + fallback + '</div>' +
                '<div class="link-details">' +
                    '<h4>' + name + ' ' + statusBadge + '</h4>' +
                    '<span>' + url + '</span>' +
                '</div>' +
            '</div>' +
            '<div class="link-actions">' +
                '<button class="btn btn-secondary btn-sm edit-btn" data-id="' + escapeHtml(link.id) + '">✏️ 编辑</button>' +
                '<button class="btn btn-danger btn-sm delete-btn" data-id="' + escapeHtml(link.id) + '">🗑️ 删除</button>' +
            '</div>' +
        '</li>';
    }
    linkList.innerHTML = html;

    var editBtns = document.querySelectorAll('.edit-btn');
    for (var j = 0; j < editBtns.length; j++) {
        editBtns[j].addEventListener('click', function() { openEditModal(this.dataset.id); });
    }
    var deleteBtns = document.querySelectorAll('.delete-btn');
    for (var k = 0; k < deleteBtns.length; k++) {
        deleteBtns[k].addEventListener('click', function() { openDeleteModal(this.dataset.id); });
    }
}

// ========== 站点设置 ==========
function loadSettingsToForm() {
    var settings = getSettings();
    document.getElementById('siteTitle').value = settings.title || '';
    document.getElementById('siteSubtitle').value = settings.subtitle || '';
    document.getElementById('siteStartDate').value = settings.startDate || '';
}

function saveSettingsToStore() {
    var settings = {
        title: document.getElementById('siteTitle').value.trim(),
        subtitle: document.getElementById('siteSubtitle').value.trim(),
        startDate: document.getElementById('siteStartDate').value.trim()
    };
    saveSettingsLocal(settings);
    // 静默成功
    var alertEl = document.getElementById('settingsAlert');
    if (alertEl) {
        alertEl.textContent = '✅ 已保存';
        alertEl.className = 'alert alert-success';
        alertEl.style.display = 'block';
        setTimeout(function() { alertEl.style.display = 'none'; }, 1500);
    }
}

function showAdminPanel() {
    document.getElementById('loginPanel').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    refreshLinks();
    loadSettingsToForm();
}

function showLoginPanel() {
    document.getElementById('adminPanel').style.display = 'none';
    document.getElementById('loginPanel').style.display = 'block';
    document.getElementById('username').value = '';
    document.getElementById('password').value = '';
    document.getElementById('loginAlert').style.display = 'none';
}

async function refreshLinks() {
    document.getElementById('linkList').innerHTML = '<li style="text-align: center; padding: 2rem; color: var(--color-ink-2);">加载中...</li>';
    var links = await loadLinksFromServer();
    renderLinks(links);
}

function openAddModal() {
    document.getElementById('modalTitle').textContent = '添加链接';
    document.getElementById('linkId').value = '';
    document.getElementById('linkName').value = '';
    document.getElementById('linkUrl').value = '';
    document.getElementById('linkFallback').value = '';
    document.getElementById('linkStatus').value = 'active';
    document.getElementById('modalAlert').style.display = 'none';
    document.getElementById('linkModal').classList.add('active');
    setTimeout(function() { document.getElementById('linkName').focus(); }, 100);
}

function openEditModal(id) {
    var links = getLinks();
    var link = null;
    for (var i = 0; i < links.length; i++) {
        if (links[i].id === id) { link = links[i]; break; }
    }
    if (!link) return;
    document.getElementById('modalTitle').textContent = '编辑链接';
    document.getElementById('linkId').value = link.id;
    document.getElementById('linkName').value = link.name;
    document.getElementById('linkUrl').value = link.url;
    document.getElementById('linkFallback').value = link.fallback || '';
    document.getElementById('linkStatus').value = link.status;
    document.getElementById('modalAlert').style.display = 'none';
    document.getElementById('linkModal').classList.add('active');
    setTimeout(function() { document.getElementById('linkName').focus(); }, 100);
}

function openDeleteModal(id) {
    document.getElementById('deleteId').value = id;
    document.getElementById('deleteModal').classList.add('active');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('active');
}

// ========== 保存链接（自动同步 KV） ==========
function saveLink() {
    var id = document.getElementById('linkId').value;
    var name = document.getElementById('linkName').value.trim();
    var url = document.getElementById('linkUrl').value.trim();
    var fallback = document.getElementById('linkFallback').value.trim();
    var status = document.getElementById('linkStatus').value;

    if (!name) { showStatus('modalAlert', '请输入链接名称', 'error'); return; }
    if (!url) { showStatus('modalAlert', '请输入链接地址', 'error'); return; }
    try { new URL(url); } catch (e) { showStatus('modalAlert', '请输入有效的 URL 地址（以 http:// 或 https:// 开头）', 'error'); return; }

    var links = getLinks();
    if (id) {
        for (var i = 0; i < links.length; i++) {
            if (links[i].id === id) {
                links[i] = Object.assign({}, links[i], {
                    name: name,
                    url: url,
                    fallback: fallback || name.charAt(0),
                    status: status
                });
                break;
            }
        }
    } else {
        links.push({ id: generateId(), name: name, url: url, fallback: fallback || name.charAt(0), status: status, order: links.length });
    }

    saveLinks(links);
    closeModal('linkModal');
    renderLinks(links);
    autoSaveToServer(links);
}

// ========== 删除链接（自动同步 KV） ==========
function deleteLink() {
    var id = document.getElementById('deleteId').value;
    var links = getLinks();
    var deletedLink = null;
    for (var i = 0; i < links.length; i++) {
        if (links[i].id === id) { deletedLink = links[i]; break; }
    }
    var newLinks = [];
    for (var j = 0; j < links.length; j++) {
        if (links[j].id !== id) newLinks.push(links[j]);
    }
    saveLinks(newLinks);
    closeModal('deleteModal');
    renderLinks(newLinks);
    if (deletedLink) console.log('已删除链接:', deletedLink.name);
    autoSaveToServer(newLinks);
}

// ========== 主题切换（与 index.html 统一） ==========
function applyTheme(theme) {
    var themeIcon = document.getElementById('themeIcon');
    var themeLabel = document.getElementById('themeLabel');
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (themeIcon) themeIcon.textContent = '☀️';
        if (themeLabel) themeLabel.textContent = '浅色';
        var meta1 = document.querySelector('meta[name="theme-color"]');
        if (meta1) meta1.setAttribute('content', '#1a1512');
    } else {
        document.documentElement.removeAttribute('data-theme');
        if (themeIcon) themeIcon.textContent = '🌙';
        if (themeLabel) themeLabel.textContent = '深色';
        var meta2 = document.querySelector('meta[name="theme-color"]');
        if (meta2) meta2.setAttribute('content', '#f5ebe0');
    }
    localStorage.setItem(THEME_KEY, theme);
}

// ========== 事件监听 ==========
document.addEventListener('DOMContentLoaded', async function() {
    // 认证检查（含服务端验证）
    if (isAuthenticated()) {
        var valid = await verifyTokenOnServer();
        if (valid) {
            showAdminPanel();
        } else {
            clearToken();
            showLoginPanel();
        }
    } else {
        showLoginPanel();
    }

    // 主题初始化
    var savedTheme = localStorage.getItem(THEME_KEY) ||
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(savedTheme);

    // 登录
    document.getElementById('loginBtn').addEventListener('click', async function() {
        var username = document.getElementById('username').value.trim();
        var password = document.getElementById('password').value;
        if (!username || !password) { showStatus('loginAlert', '请输入用户名和密码', 'error'); return; }
        var loginBtn = document.getElementById('loginBtn');
        loginBtn.disabled = true;
        loginBtn.textContent = '登录中...';
        var success = await login(username, password);
        loginBtn.disabled = false;
        loginBtn.textContent = '登录';
        if (success) { showAdminPanel(); } else { showStatus('loginAlert', '用户名或密码错误', 'error'); }
    });

    document.getElementById('password').addEventListener('keypress', function(e) {
        if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });

    // 退出
    document.getElementById('logoutBtn').addEventListener('click', function() {
        if (confirm('确定要退出登录吗？')) { clearToken(); showLoginPanel(); }
    });

    // 按钮事件
    document.getElementById('saveToServerBtn').addEventListener('click', saveLinksToServer);
    document.getElementById('refreshBtn').addEventListener('click', refreshLinks);
    document.getElementById('addLinkBtn').addEventListener('click', openAddModal);
    document.getElementById('saveLinkBtn').addEventListener('click', saveLink);
    document.getElementById('cancelLinkBtn').addEventListener('click', function() { closeModal('linkModal'); });
    document.getElementById('confirmDeleteBtn').addEventListener('click', deleteLink);
    document.getElementById('cancelDeleteBtn').addEventListener('click', function() { closeModal('deleteModal'); });

    // 设置保存
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsToStore);

    // 主题切换
    document.getElementById('themeToggle').addEventListener('click', function() {
        var currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });

    // 模态框外部点击关闭
    ['linkModal', 'deleteModal'].forEach(function(modalId) {
        document.getElementById(modalId).addEventListener('click', function(e) {
            if (e.target === e.currentTarget) closeModal(modalId);
        });
    });

    // ESC 关闭
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            if (document.getElementById('linkModal').classList.contains('active')) closeModal('linkModal');
            if (document.getElementById('deleteModal').classList.contains('active')) closeModal('deleteModal');
        }
    });

    // 系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function(e) {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
    });

    console.log('🚀 后台管理系统已就绪');
    console.log('📦 添加/编辑/删除链接后将自动同步到 Cloudflare KV');
});
