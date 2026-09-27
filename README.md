# Cloudflare Worker 短链生成器

基于 Cloudflare Workers + KV 的轻量短链接服务。支持有效期、访问次数限制，带密码保护的管理后台。

## 功能

- 前台创建：有效期最长 7 天，访问次数最多 100 次
- 管理后台：密码登录，可无视前台限制创建/编辑/删除
- 最多同时 100 条短链
- 过期或次数用尽后自动删除
- 短码为 3 位英文大小写 + 数字
- 可通过 `SHORT_HOST` 配置短链域名

## 部署

### 1. 准备仓库

新建 GitHub 仓库，上传本项目文件。

### 2. 创建 KV

Cloudflare Dashboard → Workers & Pages → KV → Create a namespace，记下 Namespace ID。

### 3. 连接 GitHub 部署

Workers & Pages → Create → Connect to Git，选择仓库：

| 配置项 | 值 |
|--------|-----|
| Project name | `short-link` |
| Production branch | `main` |
| Build command | 留空 |
| Deploy command | `npx wrangler deploy` |

### 4. 绑定 KV

Worker → Settings → Bindings → Add → KV Namespace  
变量名：`LINKS`，选择刚创建的命名空间。

或在 `wrangler.toml` 中填写你的 KV ID 后重新推送。

### 5. 环境变量

Worker → Settings → Variables and Secrets：

| 名称 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `ADMIN_PASSWORD` | Secret | 是 | 后台登录密码 |
| `SHORT_HOST` | Variable | 否 | 短链主机名，如 `https://s.example.com` |

保存后重新部署。

### 6. 访问

- 前台：`https://你的worker.workers.dev`
- 后台：`https://你的worker.workers.dev/admin`

## 配置

`wrangler.toml`：

```toml
name = "short-link"
main = "src/worker.js"
compatibility_date = "2024-09-23"

[[kv_namespaces]]
binding = "LINKS"
id = "YOUR_KV_NAMESPACE_ID_HERE"
```

## 使用

**前台** `/`：输入链接，选有效期和次数，生成短链。

**后台** `/admin`：登录后可查看完整短链接、复制、新建（可永久/无次数限制/自定义短码）、编辑、删除。

## 项目结构

```
.
├── src/worker.js
├── wrangler.toml
├── package.json
└── README.md
```

## 安全建议

1. 使用强密码，`ADMIN_PASSWORD` 设为 Secret
2. 建议绑定自定义域名，并用 Cloudflare Access 保护 `/admin`
3. 设置 `SHORT_HOST` 为正式域名

