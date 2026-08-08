# Cloudflare Worker 短链生成器

基于 Cloudflare Workers + KV 的轻量短链接服务。支持有效期、访问次数限制，带密码保护的管理后台。

## ✨ 功能特性

- **前台创建**：可设置有效期（最长 7 天）、访问次数（最多 100 次）
- **管理后台**：密码鉴权，可无视前台限制创建 / 修改 / 删除短链
- **数量上限**：最多同时存在 100 条短链
- **自动失效**：过期或次数用尽后，访问时自动删除
- **全球加速**：部署在 Cloudflare 边缘网络，访问速度快
- **免费可用**：适合个人使用，完全在 Cloudflare 免费套餐内

## 📋 前置要求

- Cloudflare 账号
- GitHub 账号
- 已安装 [Node.js](https://nodejs.org/)（本地测试可选）

## 🚀 一键部署（推荐）

### 方式一：GitHub Actions 自动部署

1. **Fork 本仓库**到你的 GitHub 账号

2. **创建 Cloudflare KV 命名空间**
   - 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
   - 进入 **Workers & Pages** → **KV**
   - 点击 **Create a namespace**，名称随意（例如 `SHORT_LINKS`）
   - 创建后复制 **Namespace ID**

3. **创建 Cloudflare API Token**
   - 访问 [API Tokens](https://dash.cloudflare.com/profile/api-tokens)
   - 点击 **Create Token** → **Custom token**
   - 权限设置：
     - `Account` → `Workers Scripts` → `Edit`
     - `Account` → `Workers KV Storage` → `Edit`
   - 创建后复制 Token（只显示一次）

4. **配置 GitHub Secrets**

   进入你的仓库 → **Settings** → **Secrets and variables** → **Actions**，添加以下 Secrets：

   | Secret 名称 | 说明 | 示例 |
   |-------------|------|------|
   | `CF_API_TOKEN` | Cloudflare API Token | `xxxxxx` |
   | `CF_ACCOUNT_ID` | Cloudflare 账户 ID | Dashboard 右侧或 Workers 页面可见 |
   | `CF_KV_NAMESPACE_ID` | 刚才创建的 KV Namespace ID | `xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx` |
   | `ADMIN_PASSWORD` | 管理后台登录密码（首次部署后手动设置） | 建议使用强密码 |

5. **启用 GitHub Actions**
   - 进入仓库 **Actions** 页面
   - 允许 Actions 运行
   - 手动触发一次 **Deploy to Cloudflare Workers** 工作流，或直接 push 代码

6. **设置管理密码（重要）**

   首次部署成功后，需要单独设置一次管理密码：

   ```bash
   npx wrangler secret put ADMIN_PASSWORD
   # 按提示输入你的密码
   ```

   或者在 Cloudflare Dashboard → Workers → 你的 Worker → Settings → Variables → Secrets 中添加 `ADMIN_PASSWORD`。

7. **访问你的服务**

   部署成功后，地址为：

   ```
   https://short-link.<your-subdomain>.workers.dev
   ```

   管理后台：`https://你的地址/admin`

---

### 方式二：使用 Wrangler 手动部署

```bash
# 1. 克隆仓库
git clone https://github.com/你的用户名/你的仓库名.git
cd 你的仓库名

# 2. 安装依赖
npm install

# 3. 登录 Cloudflare
npx wrangler login

# 4. 创建 KV（如果还没有）
npx wrangler kv namespace create SHORT_LINKS
# 把输出的 id 填入 wrangler.toml

# 5. 设置管理密码（Secret）
npx wrangler secret put ADMIN_PASSWORD
# 按提示输入密码

# 6. 部署
npx wrangler deploy
```

## ⚙️ 配置说明

### `wrangler.toml` 示例

```toml
name = "short-link"
main = "src/worker.js"
compatibility_date = "2024-09-23"

[[kv_namespaces]]
binding = "LINKS"
id = "你的_KV_NAMESPACE_ID"
```

### 环境变量 / Secrets

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ADMIN_PASSWORD` | Secret | 是 | 管理后台登录密码 |
| `LINKS` | KV Binding | 是 | 短链数据存储 |

## 📖 使用说明

### 前台（公开）

访问根路径 `/`：

1. 输入要缩短的完整链接（必须以 `http://` 或 `https://` 开头）
2. 选择有效时间（1 / 3 / 7 天）
3. 选择访问次数限制（1 / 5 / 10 / 50 / 100 次）
4. 点击生成，获得短链

**前台限制：**
- 有效期最长 7 天
- 访问次数最多 100 次
- 全局最多 100 条短链

### 管理后台

访问 `/admin`：

1. 输入你设置的 `ADMIN_PASSWORD`
2. 登录后可以：
   - 查看所有短链
   - 新建短链（可设永久有效、无次数限制、自定义短码）
   - 编辑已有短链
   - 删除短链

**后台无前台限制**，但仍然受「最多 100 条」的全局限制。

### 短链跳转逻辑

当用户访问短链时：

1. 检查是否存在
2. 检查是否过期 → 过期则删除并返回 410
3. 检查访问次数是否用尽 → 用尽则删除并返回 410
4. 访问次数 +1
5. 跳转到原始链接

> 注意：过期或次数用尽的短链**不会主动清理**，只有在有人访问时才会被删除并释放名额。达到 100 条上限后，新创建会被直接拒绝。

## 📁 项目结构

```
.
├── src/
│   └── worker.js          # Worker 主代码
├── .github/
│   └── workflows/
│       └── deploy.yml     # GitHub Actions 自动部署
├── wrangler.toml          # Wrangler 配置
├── package.json
└── README.md
```

## 🛡️ 安全建议

1. **务必修改默认密码**：不要使用 `admin` 等弱密码
2. 使用 Cloudflare 的 **Secret** 存储 `ADMIN_PASSWORD`，不要写在代码或 `wrangler.toml` 中
3. 建议为管理后台绑定自定义域名，并开启 Cloudflare Access（Zero Trust）进一步保护
4. 定期检查后台，清理无用短链

## ❓ 常见问题

**Q: 部署后访问显示 Error？**  
A: 检查 KV 是否正确绑定（变量名必须是 `LINKS`），以及 `ADMIN_PASSWORD` 是否已设置。

**Q: 达到 100 条后还能创建吗？**  
A: 不能。需要先在后台删除一些短链，或等待过期/次数用尽的短链被访问后自动释放。

**Q: 如何绑定自定义域名？**  
A: 在 Cloudflare Dashboard → Workers → 你的 Worker → **Triggers** → **Custom Domains** 中添加。

**Q: 免费套餐够用吗？**  
A: 个人使用完全够。Workers 每天 10 万次请求，KV 每天 10 万次读取、1000 次写入。

## 📄 License

MIT
