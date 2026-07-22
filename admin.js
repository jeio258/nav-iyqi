// ========== 配置 ==========
const API_BASE = '/api';
const TOKEN_KEY = 'admin_token';
const LINKS_STORAGE_KEY = 'nav_links';
const ENGINES_STORAGE_KEY = 'nav_search_engines';
const SETTINGS_STORAGE_KEY = 'nav_settings';
const THEME_KEY = 'theme'; // 与 index.html 统一

// 默认链接数据
const DEFAULT_LINKS = [
    { id: '1', name: '临渊羡鱼博客', url: 'https://blog.fnosi.top', fallback: '临', status: 'active', order: 0 },
    { id: '2', name: '临渊羡鱼图床', url: 'https://imge.fnosi.top', fallback: '图', status: 'active', order: 1 },
    { id: '3', name: '文件快递柜', url: 'https://file.fnosi.top', fallback: '📁', status: 'active', order: 2 },
    { id: '4', name: '飞牛NAS', url: 'https://fnos.fnosi.top', fallback: '🐮', status: 'active', order: 3 },
    { id: '5', name: '临渊羡鱼资源站', url: 'https://list.fnosi.top', fallback: '📦', status: 'active', order: 4 },
    { id: '6', name: '临渊羡鱼标签页', url: 'https://tab.fnosi.top', fallback: '🏷️', status: 'active', order: 5 }
];

const DEFAULT_ENGINES = [
    { id: 'baidu', label: '百度', urlFormat: 'https://www.baidu.com/s?wd=%s', icon: '🔵', enabled: true },
    { id: 'bing', label: 'Bing', urlFormat: 'https://www.bing.com/search?q=%s', icon: '🔍', enabled: true },
    { id: 'google', label: 'Google', urlFormat: 'https://www.google.com/search?q=%s', icon: '🌈', enabled: true },
    { id: 'duckduckgo', label: 'DuckDuckGo', urlFormat: 'https://duckduckgo.com/?q=%s', icon: '🦆', enabled: true }
];

const DEFAULT_SETTINGS = {
    title: '🌾 友邻聚落',
    subtitle: '临渊羡鱼 · 且行且歌',
    startDate: '2025-12-01 00:00:00'
};

// ========== 工具函数 ==========
function getLinks() {
    const stored = localStorage.getItem(LINKS_STORAGE_KEY);
    if (stored) {
        try { return JSON.parse(stored); } catch (e) { return [...DEFAULT_LINKS]; }
    }
    return [...DEFAULT_LINKS];
}

function saveLinks(links) {
    localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(links));
}

function generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function getEngines() {
    const stored = localStorage.getItem(ENGINES_STORAGE_KEY);
    if (stored) {
        try { return JSON.parse(stored); } catch (e) { return [...DEFAULT_ENGINES]; }
    }
    return [...DEFAULT_ENGINES];
}

function saveEngines(engines) {
    localStorage.setItem(ENGINES_STORAGE_KEY, JSON.stringify(engines));
}

function getSettings() {
    const stored = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (stored) {
        try { return { ...DEFAULT_SETTINGS, ...JSON.parse(stored) }; } catch (e) { return { ...DEFAULT_SETTINGS }; }
    }
    return { ...DEFAULT_SETTINGS };
}

function saveSettings(settings) {
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
    const token = getToken();
    if (!token) return false;
    try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        return payload.exp > Math.floor(Date.now() / 1000);
    } catch (e) {
        return false;
    }
}

function showAlert(elementId, message, type = 'error') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.textContent = message;
    el.className = `alert alert-${type}`;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 3000);
}

// ========== 登录功能 ==========
async function login(username, password) {
    try {
        const response = await fetch(`${API_BASE}/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '登录失败');
        setToken(data.token);
        return true;
    } catch (error) {
        console.error('登录错误:', error);
        return false;
    }
}

// ========== 从服务器加载链接 ==========
async function loadLinksFromServer() {
    try {
        const response = await fetch(`${API_BASE}/links`);
        if (!response.ok) throw new Error('加载失败');
        const data = await response.json();
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
    const token = getToken();
    if (!token) { console.warn('未登录，无法自动保存'); return false; }
    try {
        const response = await fetch(`${API_BASE}/links`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ links })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '自动保存失败');
        console.log('✅ 已自动保存到 KV:', data.count, '个链接');
        showAlert('saveAlert', `✅ 已自动同步 ${data.count} 个链接到云端`, 'success');
        return true;
    } catch (error) {
        console.error('自动保存失败:', error.message);
        showAlert('saveAlert', '⚠️ 自动同步失败，请检查网络或手动同步', 'error');
        return false;
    }
}

// ========== 手动保存 ==========
async function saveLinksToServer() {
    const token = getToken();
    if (!token) { showAlert('saveAlert', '登录已过期，请重新登录', 'error'); clearToken(); showLoginPanel(); return; }
    const links = getLinks();
    try {
        const response = await fetch(`${API_BASE}/links`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ links })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || '保存失败');
        showAlert('saveAlert', `✅ 成功同步 ${data.count || links.length} 个链接到云端！`, 'success');
    } catch (error) {
        console.error('保存失败:', error);
        showAlert('saveAlert', '❌ 保存失败: ' + error.message, 'error');
    }
}

// ========== UI 更新 ==========
function renderLinks(links) {
    const linkList = document.getElementById('linkList');
    if (!links || links.length === 0) {
        linkList.innerHTML = '<li style="text-align: center; padding: 3rem; color: var(--text-secondary);"><p>📭 暂无链接，点击"添加"按钮创建</p></li>';
        return;
    }
    linkList.innerHTML = links.map(link => `
        <li class="link-item" data-id="${link.id}">
            <div class="link-info">
                <div class="link-avatar">${link.fallback || '🔗'}</div>
                <div class="link-details">
                    <h4>${link.name} ${link.status === 'inactive' ? '<span class="badge badge-inactive">已禁用</span>' : '<span class="badge badge-active">启用中</span>'}</h4>
                    <span>${link.url}</span>
                </div>
            </div>
            <div class="link-actions">
                <button class="btn btn-secondary btn-sm edit-btn" data-id="${link.id}">✏️ 编辑</button>
                <button class="btn btn-danger btn-sm delete-btn" data-id="${link.id}">🗑️ 删除</button>
            </div>
        </li>
    `).join('');
    document.querySelectorAll('.edit-btn').forEach(btn => btn.addEventListener('click', () => openEditModal(btn.dataset.id)));
    document.querySelectorAll('.delete-btn').forEach(btn => btn.addEventListener('click', () => openDeleteModal(btn.dataset.id)));
}

// ========== 搜索引擎渲染 ==========
function renderEngines(engines) {
    const engineList = document.getElementById('engineList');
    if (!engines || engines.length === 0) {
        engineList.innerHTML = '<li style="text-align: center; padding: 1rem; color: var(--text-secondary);"><p>📭 暂无搜索引擎</p></li>';
        return;
    }
    engineList.innerHTML = engines.map(engine => `
        <li class="link-item" data-id="${engine.id}">
            <div class="link-info">
                <div class="link-avatar">${engine.icon || '🔍'}</div>
                <div class="link-details">
                    <h4>${engine.label} ${engine.enabled === false ? '<span class="badge badge-inactive">已禁用</span>' : '<span class="badge badge-active">启用中</span>'}</h4>
                    <span>${engine.urlFormat}</span>
                </div>
            </div>
            <div class="link-actions">
                <button class="btn btn-${engine.enabled !== false ? 'secondary' : 'primary'} btn-sm toggle-engine-btn" data-id="${engine.id}">${engine.enabled !== false ? '⏸️ 禁用' : '▶️ 启用'}</button>
                <button class="btn btn-secondary btn-sm edit-engine-btn" data-id="${engine.id}">✏️ 编辑</button>
                <button class="btn btn-danger btn-sm delete-engine-btn" data-id="${engine.id}">🗑️</button>
            </div>
        </li>
    `).join('');
    document.querySelectorAll('.edit-engine-btn').forEach(btn => btn.addEventListener('click', () => openEngineEditModal(btn.dataset.id)));
    document.querySelectorAll('.delete-engine-btn').forEach(btn => btn.addEventListener('click', () => deleteEngine(btn.dataset.id)));
    document.querySelectorAll('.toggle-engine-btn').forEach(btn => btn.addEventListener('click', () => toggleEngine(btn.dataset.id)));
}

function openEngineAddModal() {
    document.getElementById('engineModalTitle').textContent = '添加搜索引擎';
    document.getElementById('engineId').value = '';
    document.getElementById('engineLabel').value = '';
    document.getElementById('engineUrl').value = '';
    document.getElementById('engineIcon').value = '';
    document.getElementById('engineModalAlert').style.display = 'none';
    document.getElementById('engineModal').classList.add('active');
    setTimeout(() => document.getElementById('engineLabel').focus(), 100);
}

function openEngineEditModal(id) {
    const engines = getEngines();
    const engine = engines.find(e => e.id === id);
    if (!engine) return;
    document.getElementById('engineModalTitle').textContent = '编辑搜索引擎';
    document.getElementById('engineId').value = engine.id;
    document.getElementById('engineLabel').value = engine.label;
    document.getElementById('engineUrl').value = engine.urlFormat;
    document.getElementById('engineIcon').value = engine.icon || '';
    document.getElementById('engineModalAlert').style.display = 'none';
    document.getElementById('engineModal').classList.add('active');
    setTimeout(() => document.getElementById('engineLabel').focus(), 100);
}

function saveEngine() {
    const id = document.getElementById('engineId').value;
    const label = document.getElementById('engineLabel').value.trim();
    const urlFormat = document.getElementById('engineUrl').value.trim();
    const icon = document.getElementById('engineIcon').value.trim();

    if (!label) { showAlert('engineModalAlert', '请输入搜索引擎名称', 'error'); return; }
    if (!urlFormat) { showAlert('engineModalAlert', '请输入搜索 URL', 'error'); return; }
    if (!urlFormat.includes('%s')) { showAlert('engineModalAlert', 'URL 必须包含 %s 作为搜索关键词占位符', 'error'); return; }

    const engines = getEngines();
    if (id) {
        const index = engines.findIndex(e => e.id === id);
        if (index !== -1) engines[index] = { ...engines[index], label, urlFormat, icon: icon || '🔍' };
    } else {
        engines.push({ id: generateId(), label, urlFormat, icon: icon || '🔍', enabled: true });
    }
    saveEngines(engines);
    closeModal('engineModal');
    renderEngines(engines);
    showAlert('saveAlert', '✅ 搜索引擎已保存', 'success');
}

function deleteEngine(id) {
    if (!confirm('确定要删除这个搜索引擎吗？')) return;
    const engines = getEngines().filter(e => e.id !== id);
    saveEngines(engines);
    renderEngines(engines);
    showAlert('saveAlert', '✅ 搜索引擎已删除', 'success');
}

function toggleEngine(id) {
    const engines = getEngines();
    const engine = engines.find(e => e.id === id);
    if (engine) {
        engine.enabled = engine.enabled === false ? true : false;
        saveEngines(engines);
        renderEngines(engines);
    }
}

// ========== 站点设置 ==========
function loadSettingsToForm() {
    const settings = getSettings();
    document.getElementById('siteTitle').value = settings.title || '';
    document.getElementById('siteSubtitle').value = settings.subtitle || '';
    document.getElementById('siteStartDate').value = settings.startDate || '';
}

function saveSettingsToStore() {
    const settings = {
        title: document.getElementById('siteTitle').value.trim(),
        subtitle: document.getElementById('siteSubtitle').value.trim(),
        startDate: document.getElementById('siteStartDate').value.trim()
    };
    saveSettings(settings);
    showAlert('settingsAlert', '✅ 站点设置已保存（刷新首页生效）', 'success');
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
    document.getElementById('linkList').innerHTML = '<li style="text-align: center; padding: 2rem; color: var(--text-secondary);">加载中...</li>';
    const links = await loadLinksFromServer();
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
    setTimeout(() => document.getElementById('linkName').focus(), 100);
}

function openEditModal(id) {
    const links = getLinks();
    const link = links.find(l => l.id === id);
    if (!link) return;
    document.getElementById('modalTitle').textContent = '编辑链接';
    document.getElementById('linkId').value = link.id;
    document.getElementById('linkName').value = link.name;
    document.getElementById('linkUrl').value = link.url;
    document.getElementById('linkFallback').value = link.fallback || '';
    document.getElementById('linkStatus').value = link.status;
    document.getElementById('modalAlert').style.display = 'none';
    document.getElementById('linkModal').classList.add('active');
    setTimeout(() => document.getElementById('linkName').focus(), 100);
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
    const id = document.getElementById('linkId').value;
    const name = document.getElementById('linkName').value.trim();
    const url = document.getElementById('linkUrl').value.trim();
    const fallback = document.getElementById('linkFallback').value.trim();
    const status = document.getElementById('linkStatus').value;
    
    if (!name) { showAlert('modalAlert', '请输入链接名称', 'error'); return; }
    if (!url) { showAlert('modalAlert', '请输入链接地址', 'error'); return; }
    try { new URL(url); } catch (e) { showAlert('modalAlert', '请输入有效的 URL 地址（以 http:// 或 https:// 开头）', 'error'); return; }
    
    const links = getLinks();
    if (id) {
        const index = links.findIndex(l => l.id === id);
        if (index !== -1) links[index] = { ...links[index], name, url, fallback: fallback || name.charAt(0), status };
    } else {
        links.push({ id: generateId(), name, url, fallback: fallback || name.charAt(0), status, order: links.length });
    }
    
    saveLinks(links);
    closeModal('linkModal');
    renderLinks(links);
    autoSaveToServer(links); // 自动同步到 KV
}

// ========== 删除链接（自动同步 KV） ==========
function deleteLink() {
    const id = document.getElementById('deleteId').value;
    let links = getLinks();
    const deletedLink = links.find(l => l.id === id);
    links = links.filter(l => l.id !== id);
    saveLinks(links);
    closeModal('deleteModal');
    renderLinks(links);
    if (deletedLink) console.log('已删除链接:', deletedLink.name);
    autoSaveToServer(links); // 自动同步到 KV
}

// ========== 主题切换（与 index.html 统一，data-theme 设置在 html 上实现全局作用） ==========
function applyTheme(theme) {
    const themeIcon = document.getElementById('themeIcon');
    const themeLabel = document.getElementById('themeLabel');
    if (theme === 'dark') {
        document.documentElement.setAttribute('data-theme', 'dark');
        if (themeIcon) themeIcon.textContent = '☀️';
        if (themeLabel) themeLabel.textContent = '浅色';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1a1512');
    } else {
        document.documentElement.removeAttribute('data-theme');
        if (themeIcon) themeIcon.textContent = '🌙';
        if (themeLabel) themeLabel.textContent = '深色';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f5ebe0');
    }
    localStorage.setItem(THEME_KEY, theme);
}

// ========== 事件监听 ==========
document.addEventListener('DOMContentLoaded', () => {
    // 认证检查
    if (isAuthenticated()) { showAdminPanel(); } else { showLoginPanel(); }
    
    // 主题初始化（使用统一的 'theme' key）
    const savedTheme = localStorage.getItem(THEME_KEY) || 
        (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(savedTheme);
    
    // 登录
    document.getElementById('loginBtn').addEventListener('click', async () => {
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        if (!username || !password) { showAlert('loginAlert', '请输入用户名和密码', 'error'); return; }
        const loginBtn = document.getElementById('loginBtn');
        loginBtn.disabled = true;
        loginBtn.textContent = '登录中...';
        const success = await login(username, password);
        loginBtn.disabled = false;
        loginBtn.textContent = '🔐 登录';
        if (success) { showAdminPanel(); } else { showAlert('loginAlert', '用户名或密码错误', 'error'); }
    });
    
    document.getElementById('password').addEventListener('keypress', (e) => {
        if (e.key === 'Enter') document.getElementById('loginBtn').click();
    });
    
    // 退出
    document.getElementById('logoutBtn').addEventListener('click', () => {
        if (confirm('确定要退出登录吗？')) { clearToken(); showLoginPanel(); }
    });
    
    // 按钮事件
    document.getElementById('saveToServerBtn').addEventListener('click', saveLinksToServer);
    document.getElementById('refreshBtn').addEventListener('click', refreshLinks);
    document.getElementById('addLinkBtn').addEventListener('click', openAddModal);
    document.getElementById('saveLinkBtn').addEventListener('click', saveLink);
    document.getElementById('cancelLinkBtn').addEventListener('click', () => closeModal('linkModal'));
    document.getElementById('confirmDeleteBtn').addEventListener('click', deleteLink);
    document.getElementById('cancelDeleteBtn').addEventListener('click', () => closeModal('deleteModal'));

    // 搜索引擎按钮事件
    document.getElementById('addEngineBtn').addEventListener('click', openEngineAddModal);
    document.getElementById('saveEngineBtn').addEventListener('click', saveEngine);
    document.getElementById('cancelEngineBtn').addEventListener('click', () => closeModal('engineModal'));

    // 设置保存
    document.getElementById('saveSettingsBtn').addEventListener('click', saveSettingsToStore);

    // 初始化引擎列表
    renderEngines(getEngines());
    
    // 主题切换
    document.getElementById('themeToggle').addEventListener('click', () => {
        const currentTheme = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
    
    // 模态框外部点击关闭
    ['linkModal', 'deleteModal', 'engineModal'].forEach(modalId => {
        document.getElementById(modalId).addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeModal(modalId);
        });
    });
    
    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('linkModal').classList.contains('active')) closeModal('linkModal');
            if (document.getElementById('deleteModal').classList.contains('active')) closeModal('deleteModal');
            if (document.getElementById('engineModal').classList.contains('active')) closeModal('engineModal');
        }
    });
    
    // 系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
    });
    
    console.log('🚀 后台管理系统已就绪');
    console.log('📦 添加/编辑/删除链接后将自动同步到 Cloudflare KV');
});