# 部署到自己的域名

本项目**零运行时依赖**：前端是原生 ES Module，后端只用 `node:` 内置模块。
所以部署这件事只需要决定一件事——**要不要后端**。

| | 方案 A：纯静态 | 方案 B：静态 + 后端（推荐） |
|---|---|---|
| 需要 Node | 不需要 | 需要 Node.js 18+（**不需要 `npm install`**） |
| 新增的作品 | 存在访问者浏览器的 localStorage 里 | 存在服务器 `server/data/books.json`，**所有人共享** |
| 反剧透校验 | 浏览器端（`web/js/core/safety.js`） | 浏览器端 + **服务端二次校验** |
| 适合 | 只想把知识库发出去给人查 | 想让访客一起补书 |

两种方案**可以随时切换**，前端会自动探测 `/api/health`，探测失败就降级为纯静态模式，不会白屏。

---

## 0. 先做一次发布前体检

```bash
node scripts/check-data.mjs          # 数据体检（泄底字段、字数、标签合法性）
node scripts/find-duplicates.mjs --strict   # 重复条目闸门
node scripts/build.mjs               # 生成 data/manifest.json 并做构建检查
node scripts/check-frontend.mjs      # 前端模块图与清单同步
node scripts/test-core.mjs           # 单元测试
node scripts/test-views.mjs          # 视图层回归
node scripts/test-server.mjs         # 后端 E2E
```

> Windows 上 `npm run …` 可能被 PowerShell 的执行策略挡住（`npm.ps1` 无法加载）。
> 直接 `node scripts/<脚本>.mjs` 即可，效果完全一样。

---

## 1. 要发布的目录

```
web/          前端（index.html + js/ + css/）
data/         books/*.json、manifest.json、tags 等
.nojekyll     GitHub Pages 用：阻止 Jekyll 处理，否则带下划线的路径会被吞
```

**`web/` 与 `data/` 必须保持同级**：`web/js/core/seed-files.js` 用
`../../../data/books/batch-*.json` 这样的**相对路径**静态 import 全部书目，
`web/js/core/store.js` 也按当前页面路径反推 API 前缀。
因此**放在任意子路径下都能正常工作**（`https://example.com/mystery/` 也可以），
但**不能只传 `web/` 而不传 `data/`**。

---

## 2. 方案 A：纯静态托管

### GitHub Pages

```bash
git push origin main
```

若要用 `gh-pages` 分支发布，注意**不能只推 `web/` 子树**，否则 `data/` 会缺失。
推荐的做法是把 `web/` 的内容与其同级的 `data/` 一起放到发布分支：

```bash
git subtree split --prefix web -b gh-pages-web   # 只作参考，仍需带上 data/
```

更省事的做法是让 Pages 直接从 `main` 分支的根目录发布，再用一条
反向代理规则把根路径映射到 `web/index.html`；或者干脆用下面的自建方案。

自定义域名：在仓库根放一个 `CNAME` 文件（内容为裸域名，如 `mystery.example.com`），
DNS 侧加一条 `CNAME` 记录指向 `<用户名>.github.io`，然后在仓库 Settings → Pages
勾选 Enforce HTTPS。

### Netlify / Vercel / 对象存储 + CDN

- Build command：**留空**
- Publish directory：**仓库根目录**（不是 `web/`）
- 想只发布 `web/` 与 `data/`，就先 `cp -r web/* .` 再一起上传

### Nginx 纯静态

```nginx
server {
    listen 443 ssl http2;
    server_name mystery.example.com;

    ssl_certificate     /etc/letsencrypt/live/mystery.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mystery.example.com/privkey.pem;

    root /var/www/trick-archive;
    index index.html;

    # 入口在 web/ 下
    location = / { return 301 /web/; }

    # 书目 JSON 体积不小且更新即变，交给浏览器缓存但要求复核
    location ~* ^/data/books/.*\.json$ {
        add_header Cache-Control "public, max-age=3600, must-revalidate";
    }

    # ES Module 必须是正确的 MIME
    location ~* \.mjs$  { types { } default_type text/javascript; }
    location ~* \.json$ { default_type application/json; }
}
```

> **本地预览**（不做任何服务端配置）：
> ```bash
> python -m http.server 3000     # 目录选仓库根目录
> # 然后访问 http://127.0.0.1:3000/web/
> ```
> ⚠️ 不能直接双击 `web/index.html` 用 `file://` 打开——ES Module 与 JSON import
> 在 `file://` 下会被 CORS 拦住。

---

## 3. 方案 B：静态 + 后端

### 启动

```bash
# 服务器上（Node.js 18+，无需 npm install）
PORT=8080 HOST=0.0.0.0 node server/index.mjs
```

- `HOST=127.0.0.1`（默认）只监听本机，前面的 Nginx/Caddy 做反向代理；
- `HOST=0.0.0.0` 直接对外，务必自己配好防火墙与 HTTPS。

### systemd 常驻

```ini
# /etc/systemd/system/trick-archive.service
[Unit]
Description=Trick Archive (detective fiction knowledge base)
After=network.target

[Service]
Type=simple
WorkingDirectory=/srv/trick-archive
ExecStart=/usr/bin/node server/index.mjs
Environment=PORT=8787
Environment=HOST=127.0.0.1
Restart=always
RestartSec=3
User=www-data

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now trick-archive
sudo systemctl status trick-archive
```

### Nginx 反代（静态与 API 同一个域名）

```nginx
server {
    listen 443 ssl http2;
    server_name mystery.example.com;

    ssl_certificate     /etc/letsencrypt/live/mystery.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/mystery.example.com/privkey.pem;

    root /srv/trick-archive;
    index index.html;
    location = / { return 301 /web/; }

    # 只把 /api 交给后端，其余静态文件由 Nginx 直接发
    location /api/ {
        proxy_pass http://127.0.0.1:8787;
        proxy_set_header Host              $host;
        proxy_set_header X-Real-IP         $remote_addr;
        proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

证书用 `certbot --nginx -d mystery.example.com` 一条命令签发并自动续期。
**Caddy 更省事**：`mystery.example.com { reverse_proxy /api/* 127.0.0.1:8787; file_server }`，
HTTPS 自动申请。

### 数据落盘与备份

- 用户新增的作品写在 `server/data/books.json`，**原子写入**（临时文件 + rename）+
  进程内串行队列，不会因并发写坏；
- 该文件已被 `.gitignore` 忽略，**不会误提交**；
- 备份只需要备份这一个文件：`cp server/data/books.json ~/backup/books-$(date +%F).json`。

---

## 4. 数据更新后的固定动作

**后端会在启动时把 `data/books/*.json` 读进内存做缓存**，所以加完书必须重启：

```bash
node scripts/gen-seed-manifest.mjs   # 补新批次进清单
node scripts/build.mjs               # 重建 data/manifest.json
sudo systemctl restart trick-archive # ★ 不重启就看不到新书
curl -s https://mystery.example.com/api/stats | head -c 200
```

纯静态方案没有这一步，但**浏览器缓存**可能让你看到旧清单，
发版时把 `data/manifest.json` 的缓存时间设短一点，或刷新时强制绕过缓存。

---

## 5. 浏览器要求

前端用了 ES Module 的 **JSON import attributes**（`import x from '...' with { type: 'json' }`）：

| 浏览器 | 最低版本 |
|---|---|
| Chrome / Edge | 123+ |
| Safari | 17.2+ |
| Firefox | 预览版已支持（`javascript.options.json_import_attributes`） |

低于这个版本会加载失败。**不需要打包器、不需要 `npm install`**，这是本项目的取舍：
宁可要一个较新的浏览器，也不要一条构建链。

---

## 6. 一键自查清单

- [ ] `node scripts/build.mjs` 通过，`data/manifest.json` 里的 `stats.books` 与
      `data/books/*.json` 实际条数一致
- [ ] 访问 `/web/` 能看到知识库列表，条数正确
- [ ] 打开任一条目，**敏感模式**能一键隐藏全部标签
- [ ] 「添加小说」提交后能在知识库中搜到（方案 B 换一台设备也要能搜到）
- [ ] `https://你的域名/api/health` 返回 `{"ok":true,…}`（方案 B）
- [ ] 证书有效，HTTP 会 301 到 HTTPS
