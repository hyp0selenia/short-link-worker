/**
 * Cloudflare Worker 短链生成器
 * 前台：有效期最多7天，访问次数最多100次
 * 后台：密码鉴权，无视限制，最多同时存在100条短链
 *
 * 环境变量（CF Dashboard → Settings → Variables and Secrets）：
 * - ADMIN_PASSWORD (Secret)  管理后台密码
 * - SHORT_HOST               短链主机名，例如 https://s.example.com （不含末尾斜杠）
 *                            未设置时回退到请求的 origin
 */

const MAX_LINKS = 100;               // 最多同时存在的短链数量
const MAX_EXPIRE_DAYS = 7;           // 前台最大有效天数
const MAX_VISITS = 100;              // 前台最大访问次数
const SHORT_CODE_LENGTH = 6;         // 短码长度
const ADMIN_COOKIE = 'admin_token';  // 后台登录 Cookie 名称

// 前台 API 参数名混淆（随机风格变量名，降低直接构造请求绕过限制的便利性）
// 后台不使用这些 key，仍用明文 expireDays / maxVisits
const FRONT_EXPIRE_KEY = 'k7x_p2q9m';
const FRONT_VISITS_KEY = 'v3n_r8t1w';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    // 路由分发
    if (path === '/' || path === '') {
      return handleFrontend(request, env);
    }
    // 修复：/api/create 必须进入前台处理，否则会落到短链跳转逻辑
    if (path === '/api/create') {
      return handleFrontend(request, env);
    }
    if (path.startsWith('/admin')) {
      return handleAdmin(request, env, path);
    }
    // 短链跳转
    return handleRedirect(request, env, path.slice(1));
  }
};

/* ==================== 工具函数 ==================== */

function generateShortCode(length = SHORT_CODE_LENGTH) {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let result = '';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  for (let i = 0; i < length; i++) {
    result += chars[array[i] % chars.length];
  }
  return result;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function htmlResponse(html, status = 200) {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' }
  });
}

/** 获取用于生成短链的基础 URL（优先使用环境变量 SHORT_HOST） */
function getShortBase(env, requestUrl) {
  const host = (env.SHORT_HOST || '').trim().replace(/\/+$/, '');
  if (host) {
    // 支持只写域名或带协议
    if (/^https?:\/\//i.test(host)) return host;
    return `https://${host}`;
  }
  return requestUrl.origin;
}

async function getAllLinks(env) {
  const list = await env.LINKS.list({ prefix: 'link:' });
  const links = [];
  for (const key of list.keys) {
    const value = await env.LINKS.get(key.name, 'json');
    if (value) {
      links.push({ code: key.name.replace('link:', ''), ...value });
    }
  }
  return links;
}

async function countLinks(env) {
  const list = await env.LINKS.list({ prefix: 'link:' });
  return list.keys.length;
}

/* ==================== 前台页面 ==================== */

function getFrontendHTML(baseUrl) {
  // 表单控件 id 也做轻度混淆，与 API key 对应
  const idExpire = 'f_' + FRONT_EXPIRE_KEY;
  const idVisits = 'f_' + FRONT_VISITS_KEY;

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>短链生成器</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root { color-scheme: dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0a0a;
      color: #f2f2f2;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 20px;
    }
    .container {
      width: 100%;
      max-width: 460px;
      background: #111;
      border: 1px solid #242424;
      border-radius: 12px;
      padding: 28px;
    }
    h1 {
      color: #f5f5f5;
      margin-bottom: 24px;
      font-size: 22px;
      font-weight: 600;
    }
    .form-group { margin-bottom: 18px; }
    label {
      display: block;
      margin-bottom: 7px;
      color: #a8a8a8;
      font-size: 13px;
    }
    input, select {
      width: 100%;
      padding: 11px 12px;
      border: 1px solid #303030;
      border-radius: 7px;
      background: #0b0b0b;
      color: #f2f2f2;
      font-size: 14px;
    }
    input:focus, select:focus {
      outline: none;
      border-color: #666;
    }
    input::placeholder { color: #555; }
    .row { display: flex; gap: 12px; }
    .row .form-group { flex: 1; }
    button {
      width: 100%;
      padding: 11px;
      background: #f2f2f2;
      color: #111;
      border: 0;
      border-radius: 7px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
    }
    button:hover { background: #dcdcdc; }
    button:disabled { opacity: .5; cursor: not-allowed; }
    .result {
      margin-top: 18px;
      padding: 14px;
      background: #171717;
      border: 1px solid #292929;
      border-radius: 7px;
      display: none;
    }
    .result.show { display: block; }
    .result a { color: #ddd; word-break: break-all; }
    .error {
      color: #ff7070;
      margin-top: 10px;
      font-size: 13px;
      display: none;
    }
    .error.show { display: block; }
    .admin-link { text-align: center; margin-top: 18px; }
    .admin-link a {
      color: #777;
      font-size: 13px;
      text-decoration: none;
    }
    .admin-link a:hover { color: #ddd; }
  </style>
</head>
<body>
  <div class="container">
    <h1>短链</h1>
    
    <form id="form">
      <div class="form-group">
        <label>链接</label>
        <input type="url" id="url" placeholder="https://example.com" required>
      </div>
      
      <div class="row">
        <div class="form-group">
          <label>有效期</label>
          <select id="${idExpire}">
            <option value="1">1 天</option>
            <option value="3">3 天</option>
            <option value="7" selected>7 天</option>
          </select>
        </div>
        <div class="form-group">
          <label>次数</label>
          <select id="${idVisits}">
            <option value="1">1 次</option>
            <option value="5">5 次</option>
            <option value="10">10 次</option>
            <option value="50">50 次</option>
            <option value="100" selected>100 次</option>
          </select>
        </div>
      </div>
      
      <button type="submit" id="btn">生成</button>
    </form>
    
    <div class="error" id="error"></div>
    <div class="result" id="result">
      
      <a id="shortUrl" href="#" target="_blank"></a>
      <div style="margin-top:12px;">
        <button type="button" onclick="copyUrl()" style="padding:8px 16px;font-size:13px;width:auto;">复制</button>
      </div>
    </div>
    
    <div class="admin-link">
      <a href="/admin">管理后台</a>
    </div>
  </div>

  <script>
    const form = document.getElementById('form');
    const btn = document.getElementById('btn');
    const errorEl = document.getElementById('error');
    const resultEl = document.getElementById('result');
    const shortUrlEl = document.getElementById('shortUrl');

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      errorEl.classList.remove('show');
      resultEl.classList.remove('show');
      btn.disabled = true;
      btn.textContent = '生成中...';

      try {
        const payload = {
          url: document.getElementById('url').value.trim()
        };
        // 使用混淆后的参数名，避免简单构造请求绕过前端限制
        payload['${FRONT_EXPIRE_KEY}'] = parseInt(document.getElementById('${idExpire}').value);
        payload['${FRONT_VISITS_KEY}'] = parseInt(document.getElementById('${idVisits}').value);

        const res = await fetch('/api/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || '创建失败');

        shortUrlEl.href = data.shortUrl;
        shortUrlEl.textContent = data.shortUrl;
        resultEl.classList.add('show');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.classList.add('show');
      } finally {
        btn.disabled = false;
        btn.textContent = '生成短链';
      }
    });

    function copyUrl() {
      navigator.clipboard.writeText(shortUrlEl.textContent).then(() => {
        alert('已复制到剪贴板');
      });
    }
  </script>
</body>
</html>`;
}

async function handleFrontend(request, env) {
  const url = new URL(request.url);
  
  // API: 创建短链（前台限制）
  if (url.pathname === '/api/create' && request.method === 'POST') {
    try {
      const body = await request.json();
      // 支持混淆 key，同时兼容旧 key（防止遗漏），但最终都会被服务端 clamp
      const longUrl = body.url;
      const rawExpire = body[FRONT_EXPIRE_KEY] ?? body.expireDays ?? 7;
      const rawVisits = body[FRONT_VISITS_KEY] ?? body.maxVisits ?? 100;

      if (!longUrl || !/^https?:\/\/.+/i.test(longUrl)) {
        return jsonResponse({ error: '请输入有效的 URL（需以 http:// 或 https:// 开头）' }, 400);
      }

      // 前台强制限制（服务端 clamp，无法通过改参数绕过）
      const days = Math.min(Math.max(1, parseInt(rawExpire) || 7), MAX_EXPIRE_DAYS);
      const visits = Math.min(Math.max(1, parseInt(rawVisits) || 100), MAX_VISITS);

      // 检查总数量
      const count = await countLinks(env);
      if (count >= MAX_LINKS) {
        return jsonResponse({ error: `当前已达上限（${MAX_LINKS} 条），请联系管理员清理` }, 403);
      }

      // 生成唯一短码
      let code, exists;
      do {
        code = generateShortCode();
        exists = await env.LINKS.get(`link:${code}`);
      } while (exists);

      const now = Date.now();
      const expireAt = now + days * 24 * 60 * 60 * 1000;

      const data = {
        url: longUrl,
        createdAt: now,
        expireAt,
        maxVisits: visits,
        visits: 0,
        createdBy: 'frontend'
      };

      await env.LINKS.put(`link:${code}`, JSON.stringify(data), {
        expirationTtl: Math.ceil((expireAt - now) / 1000) + 3600 // 多留1小时缓冲
      });

      const base = getShortBase(env, url);
      const shortUrl = `${base}/${code}`;
      return jsonResponse({ shortUrl, code, expireAt, maxVisits: visits });
    } catch (e) {
      return jsonResponse({ error: e.message || '服务器错误' }, 500);
    }
  }

  // 非 POST /api/create 的其它路径（主要是 /）返回前台页面
  if (url.pathname === '/' || url.pathname === '') {
    return htmlResponse(getFrontendHTML(url.origin));
  }

  // 误访问 /api/create 用 GET 等方法
  return jsonResponse({ error: 'Method Not Allowed' }, 405);
}

/* ==================== 短链跳转 ==================== */

async function handleRedirect(request, env, code) {
  if (!code || !/^[a-zA-Z0-9]+$/.test(code)) {
    return htmlResponse('<h1>404 - 链接不存在</h1>', 404);
  }

  const key = `link:${code}`;
  const raw = await env.LINKS.get(key);
  if (!raw) {
    return htmlResponse('<h1>404 - 链接不存在或已失效</h1>', 404);
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return htmlResponse('<h1>404 - 链接数据异常</h1>', 404);
  }

  const now = Date.now();

  // 检查过期
  if (data.expireAt && now > data.expireAt) {
    await env.LINKS.delete(key);
    return htmlResponse('<h1>链接已过期</h1>', 410);
  }

  // 检查访问次数
  if (data.maxVisits > 0 && data.visits >= data.maxVisits) {
    await env.LINKS.delete(key);
    return htmlResponse('<h1>链接访问次数已用尽</h1>', 410);
  }

  // 增加访问次数
  data.visits = (data.visits || 0) + 1;
  const ttl = data.expireAt ? Math.ceil((data.expireAt - now) / 1000) + 3600 : undefined;
  await env.LINKS.put(key, JSON.stringify(data), ttl ? { expirationTtl: ttl } : undefined);

  // 达到上限后删除
  if (data.maxVisits > 0 && data.visits >= data.maxVisits) {
    await env.LINKS.delete(key);
  }

  return Response.redirect(data.url, 302);
}

/* ==================== 后台管理 ==================== */

function checkAdminAuth(request, env) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`${ADMIN_COOKIE}=([^;]+)`));
  if (!match) return false;
  // 简单 token：password 的 base64
  const expected = btoa(env.ADMIN_PASSWORD || 'admin');
  return match[1] === expected;
}

function setAdminCookie(password) {
  const token = btoa(password);
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=86400`;
}

function getAdminLoginHTML() {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>管理后台登录</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root { color-scheme: dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0a0a;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .box {
      width: 100%;
      max-width: 340px;
      background: #111;
      border: 1px solid #242424;
      padding: 24px;
      border-radius: 10px;
    }
    h2 { color: #f2f2f2; font-size: 20px; font-weight: 600; margin-bottom: 20px; }
    input {
      width: 100%;
      padding: 11px 12px;
      border: 1px solid #303030;
      border-radius: 7px;
      background: #0b0b0b;
      color: #fff;
      font-size: 14px;
      margin-bottom: 12px;
    }
    input:focus { outline: none; border-color: #666; }
    input::placeholder { color: #555; }
    button {
      width: 100%;
      padding: 11px;
      background: #f2f2f2;
      color: #111;
      border: none;
      border-radius: 7px;
      font-size: 14px;
      cursor: pointer;
      font-weight: 600;
    }
    button:hover { background: #dcdcdc; }
    .error { color: #ff7070; font-size: 13px; margin-top: 10px; display: none; }
  </style>
</head>
<body>
  <div class="box">
    <h2>管理后台</h2>
    <form id="loginForm">
      <input type="password" id="password" placeholder="密码" required autofocus>
      <button type="submit">进入</button>
    </form>
    <div class="error" id="error"></div>
  </div>
  <script>
    document.getElementById('loginForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await fetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: document.getElementById('password').value })
      });
      const data = await res.json();
      if (res.ok) {
        location.href = '/admin';
      } else {
        document.getElementById('error').textContent = data.error || '密码错误';
        document.getElementById('error').style.display = 'block';
      }
    });
  </script>
</body>
</html>`;
}

function getAdminDashboardHTML(links, baseUrl) {
  const rows = links.map(l => {
    const expireStr = l.expireAt ? new Date(l.expireAt).toLocaleString('zh-CN') : '永久';
    const remaining = l.maxVisits > 0 ? `${l.visits || 0} / ${l.maxVisits}` : `${l.visits || 0} / 无限制`;
    const status = (l.expireAt && Date.now() > l.expireAt) || (l.maxVisits > 0 && (l.visits || 0) >= l.maxVisits)
      ? '<span style="color:#ff7070">失效</span>'
      : '<span style="color:#8fd18f">有效</span>';
    return `<tr>
      <td><a href="${baseUrl}/${l.code}" target="_blank">${l.code}</a></td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${l.url}">${l.url}</td>
      <td>${remaining}</td>
      <td>${expireStr}</td>
      <td>${status}</td>
      <td>
        <button onclick="editLink('${l.code}')" style="padding:4px 8px;font-size:12px;margin-right:4px;">编辑</button>
        <button onclick="deleteLink('${l.code}')" style="padding:4px 8px;font-size:12px;background:#241414;color:#ff8a8a;">删除</button>
      </td>
    </tr>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>短链管理后台</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    :root { color-scheme: dark; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0a0a0a;
      color: #e8e8e8;
      padding: 24px;
    }
    .header {
      max-width: 1200px;
      margin: 0 auto 18px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }
    h1 { font-size: 20px; font-weight: 600; }
    .stats { color: #666; font-size: 12px; margin-top: 4px; }
    .btn {
      padding: 8px 12px;
      border: 1px solid #303030;
      border-radius: 6px;
      cursor: pointer;
      font-size: 13px;
      background: #171717;
      color: #ddd;
    }
    .btn:hover { background: #222; }
    .btn-danger { color: #ff8a8a; }
    table {
      width: 100%;
      max-width: 1200px;
      margin: 0 auto;
      border-collapse: collapse;
      background: #111;
      border: 1px solid #242424;
      border-radius: 8px;
      overflow: hidden;
    }
    th, td {
      padding: 11px 14px;
      text-align: left;
      border-bottom: 1px solid #222;
      font-size: 13px;
    }
    th { background: #151515; color: #999; font-weight: 500; }
    tr:hover { background: #171717; }
    td a { color: #ddd; }
    .modal {
      display: none;
      position: fixed;
      inset: 0;
      background: rgba(0,0,0,.72);
      align-items: center;
      justify-content: center;
      z-index: 100;
    }
    .modal.show { display: flex; }
    .modal-content {
      background: #111;
      border: 1px solid #2a2a2a;
      padding: 24px;
      border-radius: 10px;
      width: 90%;
      max-width: 460px;
    }
    .modal-content h3 { margin-bottom: 18px; font-size: 18px; }
    .form-group { margin-bottom: 14px; }
    .form-group label { display: block; margin-bottom: 6px; font-size: 12px; color: #999; }
    .form-group input, .form-group select {
      width: 100%;
      padding: 10px;
      border: 1px solid #303030;
      border-radius: 6px;
      background: #0b0b0b;
      color: #eee;
      font-size: 13px;
    }
    .modal-actions { display: flex; gap: 8px; margin-top: 18px; }
    .modal-actions button { flex: 1; padding: 10px; }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <h1>管理后台</h1>
    </div>
    <div>
      <button class="btn" onclick="showCreateModal()">新建</button>
      <button class="btn" style="background:#95a5a6;margin-left:8px;" onclick="location.href='/'">首页</button>
      <button class="btn btn-danger" style="margin-left:8px;" onclick="logout()">退出</button>
    </div>
  </div>

  <table>
    <thead>
      <tr>
        <th>短码</th>
        <th>原始链接</th>
        <th>次数</th>
        <th>过期</th>
        <th>状态</th>
        <th>操作</th>
      </tr>
    </thead>
    <tbody>
      ${rows || '<tr><td colspan="6" style="text-align:center;color:#999;">暂无数据</td></tr>'}
    </tbody>
  </table>

  <!-- 新建/编辑弹窗 -->
  <div class="modal" id="modal">
    <div class="modal-content">
      <h3 id="modalTitle">新建短链</h3>
      <form id="linkForm">
        <input type="hidden" id="editCode">
        <div class="form-group">
          <label>链接</label>
          <input type="url" id="mUrl" required placeholder="https://example.com">
        </div>
        <div class="form-group">
          <label>短码</label>
          <input type="text" id="mCode" placeholder="留空自动生成" pattern="[a-zA-Z0-9]{1,12}">
        </div>
        <div class="form-group">
          <label>有效天数</label>
          <input type="number" id="mExpire" min="0" value="7">
        </div>
        <div class="form-group">
          <label>次数上限</label>
          <input type="number" id="mVisits" min="0" value="100">
        </div>
        <div class="modal-actions">
          <button type="button" class="btn" style="background:#171717;color:#aaa;" onclick="closeModal()">取消</button>
          <button type="submit" class="btn">保存</button>
        </div>
      </form>
    </div>
  </div>

  <script>
    const MAX_LINKS = ${MAX_LINKS};

    function showCreateModal() {
      document.getElementById('modalTitle').textContent = '新建短链';
      document.getElementById('editCode').value = '';
      document.getElementById('mUrl').value = '';
      document.getElementById('mCode').value = '';
      document.getElementById('mCode').disabled = false;
      document.getElementById('mExpire').value = 7;
      document.getElementById('mVisits').value = 100;
      document.getElementById('modal').classList.add('show');
    }

    function editLink(code) {
      fetch('/admin/api/link?code=' + code)
        .then(r => r.json())
        .then(data => {
          if (data.error) return alert(data.error);
          document.getElementById('modalTitle').textContent = '编辑短链';
          document.getElementById('editCode').value = code;
          document.getElementById('mUrl').value = data.url;
          document.getElementById('mCode').value = code;
          document.getElementById('mCode').disabled = true;
          document.getElementById('mExpire').value = data.expireAt
            ? Math.max(0, Math.ceil((data.expireAt - Date.now()) / 86400000))
            : 0;
          document.getElementById('mVisits').value = data.maxVisits || 0;
          document.getElementById('modal').classList.add('show');
        });
    }

    function closeModal() {
      document.getElementById('modal').classList.remove('show');
    }

    document.getElementById('linkForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const editCode = document.getElementById('editCode').value;
      const body = {
        url: document.getElementById('mUrl').value.trim(),
        code: document.getElementById('mCode').value.trim() || undefined,
        expireDays: parseInt(document.getElementById('mExpire').value) || 0,
        maxVisits: parseInt(document.getElementById('mVisits').value) || 0
      };

      const url = editCode ? '/admin/api/update' : '/admin/api/create';
      if (editCode) body.code = editCode;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error || '操作失败');
        return;
      }
      location.reload();
    });

    async function deleteLink(code) {
      if (!confirm('确定删除短链 ' + code + ' 吗？')) return;
      const res = await fetch('/admin/api/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code })
      });
      if (res.ok) location.reload();
      else {
        const data = await res.json();
        alert(data.error || '删除失败');
      }
    }

    async function logout() {
      await fetch('/admin/logout', { method: 'POST' });
      location.href = '/admin';
    }
  </script>
</body>
</html>`;
}

async function handleAdmin(request, env, path) {
  const url = new URL(request.url);
  const isAuthed = checkAdminAuth(request, env);
  const base = getShortBase(env, url);

  // 登录
  if (path === '/admin/login' && request.method === 'POST') {
    try {
      const { password } = await request.json();
      if (password === (env.ADMIN_PASSWORD || 'admin')) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': setAdminCookie(password)
          }
        });
      }
      return jsonResponse({ error: '密码错误' }, 401);
    } catch {
      return jsonResponse({ error: '请求错误' }, 400);
    }
  }

  // 退出
  if (path === '/admin/logout' && request.method === 'POST') {
    return new Response(JSON.stringify({ ok: true }), {
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${ADMIN_COOKIE}=; Path=/; Max-Age=0`
      }
    });
  }

  // 未登录
  if (!isAuthed) {
    if (path.startsWith('/admin/api')) {
      return jsonResponse({ error: '未登录' }, 401);
    }
    return htmlResponse(getAdminLoginHTML());
  }

  // API
  if (path === '/admin/api/create' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { url: longUrl, code: customCode, expireDays = 0, maxVisits = 0 } = body;

      if (!longUrl || !/^https?:\/\/.+/i.test(longUrl)) {
        return jsonResponse({ error: '请输入有效的 URL' }, 400);
      }

      const count = await countLinks(env);
      if (count >= MAX_LINKS) {
        return jsonResponse({ error: `已达上限 ${MAX_LINKS} 条` }, 403);
      }

      let code = customCode;
      if (code) {
        if (!/^[a-zA-Z0-9]{1,12}$/.test(code)) {
          return jsonResponse({ error: '短码只能是1-12位字母数字' }, 400);
        }
        const exists = await env.LINKS.get(`link:${code}`);
        if (exists) return jsonResponse({ error: '短码已存在' }, 400);
      } else {
        do {
          code = generateShortCode();
        } while (await env.LINKS.get(`link:${code}`));
      }

      const now = Date.now();
      const expireAt = expireDays > 0 ? now + expireDays * 24 * 60 * 60 * 1000 : null;

      const data = {
        url: longUrl,
        createdAt: now,
        expireAt,
        maxVisits: maxVisits || 0,
        visits: 0,
        createdBy: 'admin'
      };

      const options = expireAt ? { expirationTtl: Math.ceil((expireAt - now) / 1000) + 3600 } : {};
      await env.LINKS.put(`link:${code}`, JSON.stringify(data), options);

      return jsonResponse({ shortUrl: `${base}/${code}`, code });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (path === '/admin/api/update' && request.method === 'POST') {
    try {
      const body = await request.json();
      const { code, url: longUrl, expireDays = 0, maxVisits = 0 } = body;

      if (!code) return jsonResponse({ error: '缺少短码' }, 400);

      const key = `link:${code}`;
      const raw = await env.LINKS.get(key);
      if (!raw) return jsonResponse({ error: '短链不存在' }, 404);

      const old = JSON.parse(raw);
      const now = Date.now();
      const expireAt = expireDays > 0 ? now + expireDays * 24 * 60 * 60 * 1000 : null;

      const data = {
        ...old,
        url: longUrl || old.url,
        expireAt,
        maxVisits: maxVisits || 0
      };

      const options = expireAt ? { expirationTtl: Math.ceil((expireAt - now) / 1000) + 3600 } : {};
      await env.LINKS.put(key, JSON.stringify(data), options);

      return jsonResponse({ ok: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (path === '/admin/api/delete' && request.method === 'POST') {
    try {
      const { code } = await request.json();
      if (!code) return jsonResponse({ error: '缺少短码' }, 400);
      await env.LINKS.delete(`link:${code}`);
      return jsonResponse({ ok: true });
    } catch (e) {
      return jsonResponse({ error: e.message }, 500);
    }
  }

  if (path === '/admin/api/link' && request.method === 'GET') {
    const code = url.searchParams.get('code');
    if (!code) return jsonResponse({ error: '缺少短码' }, 400);
    const raw = await env.LINKS.get(`link:${code}`);
    if (!raw) return jsonResponse({ error: '不存在' }, 404);
    return jsonResponse(JSON.parse(raw));
  }

  // 后台页面
  const links = await getAllLinks(env);
  // 按创建时间倒序
  links.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  return htmlResponse(getAdminDashboardHTML(links, base));
}
