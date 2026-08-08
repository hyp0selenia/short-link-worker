# Cloudflare Worker 短链生成器

基于 Cloudflare Workers + KV 的轻量短链接服务。支持有效期、访问次数限制，带密码保护的管理后台。

## ✨ 功能特性

- **前台创建**：可设置有效期（最长 7 天）、访问次数（最多 100 次）
- **管理后台**：密码鉴权，可无视前台限制创建 / 修改 / 删除短链
- **数量上限**：最多同时存在 100 条短链
- **自动失效**：过期或次数用尽后，访问时自动删除
- **全球加速**：部署在 Cloudflare 边缘网络
- **免费可用**：适合个人使用，完全在 Cloudflare 免费套餐内

## 🚀 部署方式（Cloudflare 连接 GitHub）

### 1. 准备 GitHub 仓库

1. 新建一个 GitHub 仓库（或 Fork 本仓库）
2. 把本项目所有文件上传到仓库根目录

### 2. 创建 KV 命名空间

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 进入 **Workers & Pages** → **KV**
3. 点击 **Create a namespace**，名称随意（例如 `SHORT_LINKS`）
4. 创建后复制 **Namespace ID**

### 3. 在 Cloudflare 连接 GitHub 仓库

1. 进入 **Workers & Pages** → **Create** → **Connect to Git**
2. 授权并选择你的 GitHub 仓库
3. 配置如下：

   | 配置项 | 值 |
   |--------|-----|
   | Project name | `short-link`（可自定义） |
   | Production branch | `main` 或 `master` |
   | Build command | 留空 |
   | Deploy command | `npx wrangler deploy` |
   | Root directory | `/`（默认） |

4. 点击 **Save and Deploy**

### 4. 绑定 KV

部署完成后：

1. 进入该 Worker → **Settings** → **Bindings**
2. 点击 **Add binding** → **KV Namespace**
3. 变量名填写：`LINKS`
4. 选择刚才创建的 KV 命名空间
5. 保存

或者直接修改仓库中的 `wrangler.toml`，把 `id` 改成你的 KV Namespace ID，然后重新推送代码触发部署。

### 5. 设置管理密码

1. 进入 Worker → **Settings** → **Variables and Secrets**
2. 点击 **Add** → **Secret**
3. 名称：`ADMIN_PASSWORD`
4. 值：你的管理密码（建议强密码）
5. 保存

### 6. 访问

- 前台：`https://short-link.<你的子域>.workers.dev`
- 后台：`https://short-link.<你的子域>.workers.dev/admin`

之后每次向 GitHub 推送代码，Cloudflare 会自动重新部署。

---

## ⚙️ 配置说明

### `wrangler.toml`

```toml
name = "short-link"
main = "src/worker.js"
compatibility_date = "2024-09-23"

[[kv_namespaces]]
binding = "LINKS"
id = "YOUR_KV_NAMESPACE_ID_HERE"   # 替换为你的 KV ID，或在 Dashboard 手动绑定
```

### 环境变量 / Secrets

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ADMIN_PASSWORD` | Secret | 是 | 管理后台登录密码 |
| `LINKS` | KV Binding | 是 | 短链数据存储 |

## 📖 使用说明

### 前台（公开）

访问 `/`：

1. 输入完整链接（必须以 `http://` 或 `https://` 开头）
2. 选择有效时间（1 / 3 / 7 天）
3. 选择访问次数限制（1 / 5 / 10 / 50 / 100 次）
4. 点击生成

**前台限制：** 有效期最长 7 天，访问次数最多 100 次，全局最多 100 条短链。

### 管理后台

访问 `/admin`，使用 `ADMIN_PASSWORD` 登录后可：

- 查看所有短链
- 新建短链（可设永久、无次数限制、自定义短码）
- 编辑 / 删除短链

后台无前台时间与次数限制，但仍受「最多 100 条」全局限制。

### 短链跳转逻辑

1. 检查是否存在
2. 过期 → 删除并返回 410
3. 次数用尽 → 删除并返回 410
4. 访问次数 +1
5. 跳转到原始链接

> 过期或次数用尽的短链只有在被访问时才会删除。达到 100 条上限后，新创建会被拒绝。

## 📁 项目结构

```
.
├── src/
│   └── worker.js          # Worker 主代码
├── wrangler.toml          # Wrangler 配置
├── package.json
└── README.md
```

## 🛡️ 安全建议

1. 务必设置强密码，不要使用默认值
2. `ADMIN_PASSWORD` 必须使用 Secret，不要写进代码
3. 建议绑定自定义域名，并用 Cloudflare Access 保护 `/admin`
4. 定期清理无用短链

## ❓ 常见问题

**Q: 部署后报错？**  
A: 检查 KV 是否绑定（变量名必须是 `LINKS`），以及 `ADMIN_PASSWORD` 是否已添加为 Secret。

**Q: 达到 100 条后还能创建吗？**  
A: 不能，需要先在后台删除，或等过期/次数用尽的短链被访问后自动释放。

**Q: 如何绑定自定义域名？**  
A: Worker → **Triggers** → **Custom Domains** 中添加。

**Q: 免费套餐够用吗？**  
A: 个人使用完全够用。

## 📄 License

MIT
