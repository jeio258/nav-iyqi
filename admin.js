// ========== 配置 ==========
const API_BASE = '/api';
const TOKEN_KEY = 'admin_token';
const LINKS_STORAGE_KEY = 'nav_links';
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

function showAdminPanel() {
    document.getElementById('loginPanel').style.display = 'none';
    document.getElementById('adminPanel').style.display = 'block';
    refreshLinks();
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

// ========== 主题切换（与 index.html 统一使用 'theme' key） ==========
function applyTheme(theme) {
    const themeIcon = document.getElementById('themeIcon');
    const themeLabel = document.getElementById('themeLabel');
    if (theme === 'dark') {
        document.body.setAttribute('data-theme', 'dark');
        if (themeIcon) themeIcon.textContent = '☀️';
        if (themeLabel) themeLabel.textContent = '浅色';
        document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#1a1512');
    } else {
        document.body.removeAttribute('data-theme');
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
    
    // 主题切换
    document.getElementById('themeToggle').addEventListener('click', () => {
        const currentTheme = document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
        applyTheme(currentTheme === 'dark' ? 'light' : 'dark');
    });
    
    // 模态框外部点击关闭
    ['linkModal', 'deleteModal'].forEach(modalId => {
        document.getElementById(modalId).addEventListener('click', (e) => {
            if (e.target === e.currentTarget) closeModal(modalId);
        });
    });
    
    // ESC 关闭
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('linkModal').classList.contains('active')) closeModal('linkModal');
            if (document.getElementById('deleteModal').classList.contains('active')) closeModal('deleteModal');
        }
    });
    
    // 系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
        if (!localStorage.getItem(THEME_KEY)) applyTheme(e.matches ? 'dark' : 'light');
    });
    
    console.log('🚀 后台管理系统已就绪');
    console.log('📦 添加/编辑/删除链接后将自动同步到 Cloudflare KV');
});