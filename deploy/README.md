# 部署包：tokei-detective.top（CentOS 8 + Caddy + systemd）

> **第一次部署请直接看 [`步骤手把手.md`](步骤手把手.md)** —— 那份是「一段一段照抄」的版本，
> 每段都标了在哪个窗口跑（🖥️ 电脑 / 🐧 服务器）、预期看到什么、报错了怎么办。
> 本文件是同一件事的**参考手册**（原理、取舍、故障排查表）。
>
> 配套文件：`deploy/Caddyfile`、`deploy/caddy.service`、`deploy/trick-archive.service`、
> `deploy/check-deploy.mjs`（自查脚本用 Node 写：部署目标上一定有 Node，Windows 上没有 bash，
> 这样两边都能跑）。

## 每一步在哪台机器上跑（先看这张表）

| 步骤 | 在哪跑 | 需要什么 |
|------|--------|----------|
| 0. 改私有 + push | **你自己的 Windows 电脑**（浏览器 + CMD/PowerShell） | Git（你已经在用）、GitHub 账号、约 82MB 上传带宽 |
| 1. 装 Node 与 Caddy | **服务器**（SSH 会话） | `sudo` 权限、能访问外网（nodejs.org / caddyserver.com） |
| 2. 拉代码 | **服务器** | `git`（CentOS 8 上可能没装，见 §2 的兜底）、GitHub Deploy Key |
| 3. 建用户 | **服务器** | `sudo` |
| 4. 起服务 | **服务器** | 无（零 npm 依赖，不用 `npm install`） |
| 5. Caddy | **服务器** | 80/443 端口可用、DNS 已解析到本机 |
| 6. 防火墙 + DNS + 安全组 | **服务器** + **云控制台** + **域名服务商** | 三处都要动，缺一处就是"打不开" |

**前置环境总共只要三样**：① 服务器能 SSH 且你有 sudo；② 服务器能出网；③ 你在域名服务商与云控制台都有登录权限。
不需要 Docker、不需要数据库、不需要 `npm install`（这个项目**零运行时依赖**）。

## 0. 先做两件事（在本地电脑上）

### 0.1 把 GitHub 仓库改成私有

**必须先改**：仓库现在是 public，而你要推的 139 个提交里带着 `data/books/*.json` 的
**3420 条谜底保险库**（凶手／核心诡计／结局）。一旦推上去，它就进了公开仓库的工作区与历史。

GitHub → 仓库页 → **Settings → General → Danger Zone → Change repository visibility → Private**

### 0.2 推送

```bash
git push -u origin main        # 约 82MB（web/covers 63.8MB + data 18.3MB），慢网要几分钟
```

## 1. CentOS 8 的现实：包管理器基本停摆，用官方二进制装 Node 与 Caddy

CentOS Linux 8 已经 **EOL（2021-12-31 停止维护）**，默认的 `mirrorlist` 早就失效，
`dnf install` 大概率报 404。**别在这个上面挣扎**，装 Node 与 Caddy 完全可以绕开包管理器：

```bash
# ① Node 22（官方二进制）
V=$(curl -fsSL https://nodejs.org/dist/index.json | grep -o '"version":"v22[^"]*"' | head -1 | cut -d'"' -f4)
cd /usr/local
curl -fsSLO "https://nodejs.org/dist/$V/node-$V-linux-x64.tar.xz"
tar -xf "node-$V-linux-x64.tar.xz"
ln -sfn "/usr/local/node-$V-linux-x64" /usr/local/node
ln -sf /usr/local/node/bin/node /usr/local/bin/node
ln -sf /usr/local/node/bin/npm  /usr/local/bin/npm
node -v && npm -v

# ② Caddy（官方单文件二进制，自带自动 HTTPS）
curl -fsSL -o /usr/local/bin/caddy "https://caddyserver.com/api/download?os=linux&arch=amd64"
chmod +x /usr/local/bin/caddy
caddy version
```

> 如果哪天愿意重装系统，建议换 **AlmaLinux 8/9** 或 **Rocky Linux**（CentOS 8 的直系替代，
> 仓库还活着）——不过按上面这样用官方二进制，现在这套就够了，不必折腾。

## 2. 拉代码（私有仓库用 Deploy Key）

服务器上先确认 `git` 在不在：

```bash
git --version
```

**CentOS 8 已 EOL，`dnf install git` 可能报 404。**两种兜底，任选一种：

```bash
# 兜底 A：把仓库地址指到 vault.centos.org（CentOS 8 归档站），再装 git
sudo sed -i 's/^mirrorlist=/#mirrorlist=/; s|^#baseurl=http://mirror.centos.org|baseurl=http://vault.centos.org|' \
  /etc/yum.repos.d/CentOS-*.repo
sudo dnf install -y git --nogpgcheck

# 兜底 B：完全不用 git，改用 GitHub 的 tarball（私有仓库要带 token）
TOKEN=你的PAT                         # GitHub → Settings → Developer settings → Fine-grained token（只读 Contents）
mkdir -p /srv/trick-archive && cd /srv/trick-archive
curl -fsSL -H "Authorization: Bearer $TOKEN" -o repo.tar.gz \
  https://github.com/nanakotoki/Detective-Fiction-Trick-Tagging-and-Recommendation-System/archive/refs/heads/main.tar.gz
tar -xzf repo.tar.gz --strip-components=1 && rm repo.tar.gz
```

有 git 时（推荐，以后 `git pull` 就能更新）：

```bash
# 生成只读部署密钥
ssh-keygen -t ed25519 -f ~/.ssh/trick_deploy -N ''
cat ~/.ssh/trick_deploy.pub
# → 粘到 GitHub：仓库 Settings → Deploy keys → Add deploy key（不要勾 Allow write access）

# 让 git 对 github.com 用这把钥匙（写进 ~/.ssh/config，之后 git pull 不必再带参数）
cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/trick_deploy
  IdentitiesOnly yes
EOF
chmod 600 ~/.ssh/config

mkdir -p /srv
git clone git@github.com:nanakotoki/Detective-Fiction-Trick-Tagging-and-Recommendation-System.git /srv/trick-archive
cd /srv/trick-archive
ls web/index.html data/books | head      # 确认 web/ 与 data/ 同级
```

> **属主这样安排**（避免"服务能跑但拉不动代码"或反过来）：
> 用你的登录用户（如 `admin`）克隆，然后把目录交给运行用户 `trick`（下一步）；
> 以后更新用 `sudo git pull` 拉、拉完再把属主交回 `trick`（见第 8 节）。

## 3. 建运行用户并交给它

CentOS 上没有 `www-data` 这个用户（那是 Debian 系），所以**自己建一个专用用户**：

```bash
useradd -r -m -d /srv/trick-archive -s /sbin/nologin trick
chown -R trick:trick /srv/trick-archive
# 用户数据的目录必须可写（新增的书写在这里）
install -d -o trick -g trick /srv/trick-archive/server/data
```

## 4. 起服务（systemd）

```bash
sudo cp deploy/trick-archive.service /etc/systemd/system/trick-archive.service
sudo systemctl daemon-reload
sudo systemctl enable --now trick-archive
systemctl status trick-archive --no-pager
curl -s localhost:8787/api/health | head -c 200       # {"ok":true,…,"unreadableFiles":[]}
```

## 5. Caddy：HTTPS + 鉴权 + 整站反代

```bash
sudo install -d -o root -g root /etc/caddy /var/log/caddy
# 生成密码哈希（把输出粘进 Caddyfile 的 basic_auth）
caddy hash-password --plaintext '你想设的密码'
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo vi /etc/caddy/Caddyfile        # 把 <PASTE_HASH_HERE> 换成上一步的输出
```

系统里给 Caddy 建个 systemd 单元（官方推荐写法）：

```ini
# /etc/systemd/system/caddy.service
[Unit]
Description=Caddy
After=network.target
Wants=network-online.target

[Service]
Type=notify
User=root
ExecStart=/usr/local/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/local/bin/caddy reload --config /etc/caddy/Caddyfile --force
Restart=on-failure
LimitNOFILE=1048576

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload && sudo systemctl enable --now caddy
journalctl -u caddy -n 40 --no-pager     # 看证书申请结果
```

> ⚠️ **必须整站反代给 Node**（`reverse_proxy 127.0.0.1:8787`），
> **不要**让 Caddy/Nginx 自己去发 `web/` 与 `data/` 目录：① 我加的安全响应头
> （CSP／CORS 收紧／CSRF 拦截）全在 Node 里，静态直发就绕过了；② `data/books/*.json`
> 由静态服务器直发时，**谜底会裸奔**——Node 那层会把 `vault` 剥掉再发（台账 §194）。

## 6. DNS 与防火墙

```bash
# 服务器防火墙（CentOS 用 firewalld，不是 ufw）
sudo firewall-cmd --permanent --add-service=http --add-service=https
sudo firewall-cmd --reload
sudo firewall-cmd --list-all
```

- **域名解析**：在域名服务商处加 `A` 记录 → 这台机器的公网 IP（`www` 可选，Caddyfile 里已留了跳转）；
- **云平台安全组**：阿里云/腾讯云还要在控制台的**安全组**里放行入方向 `80`、`443`
  （这是最常见的「域名打不开」原因——机器内部防火墙放行了，云平台那层没放）；
- **8787 不要对外**：Node 只听 `127.0.0.1`，安全组里也别放行它。

> 🚩 **如果你这台 ECS 在中国大陆地域**：绑定域名对外提供 80/443 服务通常需要 **ICP 备案**，
> 没备案时用域名访问可能被拦。先确认一下：浏览器直接访问 `http://<公网IP>` 是否通、
> 云控制台是否有备案提示。真要长期对外，备案或换到非大陆地域（如香港）是常规做法。
> 这条只影响「用域名公开访问」，不影响你先在服务器上把服务跑起来。

## 7. 发布后自查

```bash
node deploy/check-deploy.mjs tokei-detective.top
```

它会逐条检查：接口可用、**谜底没有出网**、跨源写请求被拒（403）、CSP 等安全头在位、
HTTP 跳 HTTPS、证书有效期、版本一览与封面目录可用。
（本机也能先跑：`node deploy/check-deploy.mjs http://127.0.0.1:8787`。）

再在浏览器里走一遍：

- [ ] 打开 `https://tokei-detective.top`，知识库条数是 **3420**
- [ ] **敏感模式**一键隐藏全部标签
- [ ] 「诡计分析」选一本书 → 出报告、**报告顶部有封面**
- [ ] 「添加小说」提交后能在知识库搜到（换台设备/换浏览器也要能搜到 → 说明走的是服务器而不是本地存储）
- [ ] 「作者国别」「作者」两页能打开

## 8. 更新与备份

```bash
# 更新（代码有变时；git 拉取用 root、拉完把属主交回运行用户）
cd /srv/trick-archive
sudo git pull
sudo chown -R trick:trick /srv/trick-archive
sudo systemctl restart trick-archive      # ★ 必须重启：批次文件在启动时读进内存
curl -s localhost:8787/api/health | head -c 120

# 备份（只需这一个文件：用户新增/修改的书）
install -d /srv/backup
cp server/data/books.json "/srv/backup/books-$(date +%F).json"
```

`data/` 与 `web/covers/` 由 git 管，不必单独备份；`server/data/books.json` 已被 `.gitignore`
忽略，**永远不会被提交**，所以只能靠这一步备份。
