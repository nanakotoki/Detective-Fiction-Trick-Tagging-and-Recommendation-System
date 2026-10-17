#!/usr/bin/env bash
#
# 用纯命令行给已上线的站点装上 HTTPS（不需要宝塔面板）
# ====================================================
# 适用：站点已经被宝塔的 Nginx 反代着（80 → Node），但面板进不去 / 懒得点。
#
# 做三件事，每步都可重复执行（幂等）：
#   ① 在站点配置里加 ACME 豁免（不经过反代、不要求密码）—— 不先做这步，证书一定签不下来
#   ② 用 acme.sh 申请 Let's Encrypt 证书（webroot 文件验证，走 80 端口）
#   ③ 追加 443 的 server 块（带证书），nginx -t 通过才重载，失败自动回滚
#
# 用法：
#   sudo bash https-acme.sh                          # 默认 tokei-detective.top
#   sudo EMAIL=you@example.com bash https-acme.sh    # 指定邮箱（Let's Encrypt 的到期通知）
#
# 前置：轻量应用服务器防火墙要放行 TCP 443（不然装好了外网也连不上）
#
# 国内网络的两个坑（本脚本已内置应对）：
#   · raw.githubusercontent.com 经常整段不通 → get.acme.sh 装不上 → 改从 github/codeload 的
#     tar 包安装，并准备了 gitee 镜像做兜底；
#   · acme-v02.api.letsencrypt.org 会间歇性 000（连不上）→ 申请证书做三次重试。

set -euo pipefail

DOMAIN="${DOMAIN:-tokei-detective.top}"
WEBROOT="${WEBROOT:-/www/wwwroot/$DOMAIN}"
NGINX="${NGINX:-/www/server/nginx/sbin/nginx}"
CONF="/www/server/panel/vhost/nginx/$DOMAIN.conf"
REWRITE="/www/server/panel/vhost/rewrite/$DOMAIN.conf"
SSLDIR="/etc/tokei-ssl"
EMAIL="${EMAIL:-admin@$DOMAIN}"
ACME="/root/.acme.sh/acme.sh"
BAK="/root/tokei-https-backup-$(date +%Y%m%d-%H%M%S)"

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

# 国内网络下"哪一个下载源能通"完全是碰运气，所以挨个试
install_acme() {
  local tmp=/tmp/acme-install
  rm -rf "$tmp"; mkdir -p "$tmp"
  local sources=(
    "https://github.com/acmesh-official/acme.sh/archive/refs/heads/master.tar.gz"
    "https://codeload.github.com/acmesh-official/acme.sh/tar.gz/refs/heads/master"
    "https://gitee.com/neilpang/acme.sh/repository/archive/master.tar.gz"
  )
  local src
  for src in "${sources[@]}"; do
    echo "  ↓ 尝试：$src"
    if ! curl -fsSL --retry 2 --retry-delay 2 -m 90 -o "$tmp/acme.tar.gz" "$src"; then
      echo "    下载失败，换下一个源"
      continue
    fi
    rm -rf "$tmp/x"; mkdir -p "$tmp/x"
    if ! tar -xzf "$tmp/acme.tar.gz" -C "$tmp/x" 2>/dev/null; then
      echo "    解压失败，换下一个源"
      continue
    fi
    local found
    found=$(find "$tmp/x" -maxdepth 2 -name acme.sh -type f | head -1)
    if [ -z "$found" ]; then
      echo "    包里没找到 acme.sh，换下一个源"
      continue
    fi
    chmod +x "$found"
    ( cd "$(dirname "$found")" && ./acme.sh --install -m "$EMAIL" >/dev/null 2>&1 ) || true
    if [ -x "$ACME" ]; then
      echo "    ✓ 安装成功：$ACME"
      return 0
    fi
    echo "    安装脚本没跑起来，换下一个源"
  done
  return 1
}

say "0. 前置检查"
[ -x "$NGINX" ] || die "找不到 nginx：$NGINX（改 NGINX= 后再跑）"
[ -d "$WEBROOT" ] || die "找不到站点根目录：$WEBROOT"
[ -f "$CONF" ] || die "找不到站点配置：$CONF"
command -v curl >/dev/null || die "缺少 curl"
mkdir -p "$WEBROOT/.well-known/acme-challenge"
echo "ok-$(date +%s)" > "$WEBROOT/.well-known/acme-challenge/_probe"
# acme.sh 以 root 运行，但 nginx worker 是 www —— 权限不通会让验证文件读不到
chown -R www:www "$WEBROOT/.well-known" 2>/dev/null || true
chmod -R 755 "$WEBROOT/.well-known"
echo "ok"

say "1. 备份现有配置"
mkdir -p "$BAK"
cp -a "$CONF" "$BAK/site.conf"
[ -f "$REWRITE" ] && cp -a "$REWRITE" "$BAK/rewrite.conf" || true
echo "备份到 $BAK"

say "2. ACME 豁免（写进宝塔的伪静态文件，幂等）"
if grep -q 'acme-challenge' "$REWRITE" 2>/dev/null; then
  echo "已经加过了，跳过"
else
  cat >> "$REWRITE" <<EOF

# ACME 校验文件：不经过反向代理、不要求密码（否则会被整站密码挡成 401）
location ^~ /.well-known/acme-challenge/ {
    root $WEBROOT;
    auth_basic off;
    allow all;
}
EOF
  echo "已写入 $REWRITE"
fi
"$NGINX" -t || die "nginx 配置检查失败（未重载，站点仍是旧配置）"
"$NGINX" -s reload
# reload 是异步的：主进程起来新 worker、旧 worker 逐步退出，这中间可能还有旧配置在应答。
# 实测踩过：reload 后立刻 curl 会拿到旧配置的 401，等 2 秒再测就正常了。
sleep 2
echo "已重载"

say "3. 验证豁免是否生效"
code=""
for i in 1 2 3; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "http://$DOMAIN/.well-known/acme-challenge/_probe" || true)
  echo "  第 $i 次探测：HTTP $code（期望 200）"
  [ "$code" = "200" ] && break
  sleep 2
done
if [ "$code" != "200" ]; then
  echo "  401 = auth_basic 没关掉；404 = root 指错了；000 = 80 端口不通"
  die "豁免没生效，先别签证书"
fi
rm -f "$WEBROOT/.well-known/acme-challenge/_probe"

say "4. 安装 acme.sh（多源降级）"
if [ -x "$ACME" ]; then
  echo "已安装：$ACME"
else
  install_acme || die "acme.sh 装不上：三个下载源都失败。把上面的输出贴给我，我换别的路子"
fi

say "5. 申请证书（Let's Encrypt，失败自动重试）"
"$ACME" --set-default-ca --server letsencrypt >/dev/null 2>&1 || true

# acme.sh 在"证书尚未到期"时会打印 Skipping 并以**非零退出码**退出——那不是失败。
# 所以这里一律不看退出码，只看证书文件到底有没有生成。
cert_ready() {
  [ -f "/root/.acme.sh/${DOMAIN}_ecc/fullchain.cer" ] || [ -f "/root/.acme.sh/${DOMAIN}/fullchain.cer" ]
}

if cert_ready; then
  echo "本地已有证书（acme.sh 会按自己的续期计划处理），跳过申请"
else
  issued=0
  for attempt in 1 2 3; do
    echo "  第 $attempt 次申请 …"
    "$ACME" --issue -d "$DOMAIN" -d "www.$DOMAIN" -w "$WEBROOT" || true
    if cert_ready; then issued=1; break; fi
    echo "  没拿到证书，等 8 秒重试"
    sleep 8
  done
  [ "$issued" = "1" ] || die "证书申请失败（看上面的 acme.sh 日志）"
fi

mkdir -p "$SSLDIR"
"$ACME" --install-cert -d "$DOMAIN" \
  --key-file "$SSLDIR/tokei.key" \
  --fullchain-file "$SSLDIR/tokei.pem" \
  --reloadcmd "$NGINX -s reload"
echo "证书已安装到 $SSLDIR/tokei.pem"

say "6. 追加 443 的 server 块（幂等）"
if grep -q 'listen 443 ssl' "$CONF"; then
  echo "443 配置已存在，跳过"
else
  cat >> "$CONF" <<EOF

# ===== HTTPS（第 196 轮，命令行添加；要删掉时整段删）=====
server {
    listen 443 ssl;
    server_name $DOMAIN www.$DOMAIN;

    ssl_certificate     $SSLDIR/tokei.pem;
    ssl_certificate_key $SSLDIR/tokei.key;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_session_cache   shared:SSL:10m;
    ssl_session_timeout 10m;

    # 整站密码（要对外开放时删这两行）
    auth_basic "tokei";
    auth_basic_user_file /etc/tokei-archive.pass;

    root $WEBROOT;
    index index.html;

    # 和 80 的站点保持同一套包含项（否则 HTTPS 下可能没有反向代理，全变 404）
    include /www/server/panel/vhost/nginx/extension/$DOMAIN/*.conf;

    # 注意：ACME 豁免由下面 include 的伪静态文件提供，**这里不能再写一遍**
    # （同一个 server 里出现两个相同的 location → nginx 报 duplicate location）
    include /www/server/panel/vhost/nginx/proxy/$DOMAIN/*.conf;
    include /www/server/panel/vhost/rewrite/$DOMAIN.conf;

    access_log  /www/wwwlogs/$DOMAIN.log;
    error_log   /www/wwwlogs/$DOMAIN.error.log;
}
EOF
  echo "已追加 443 配置"
fi

say "7. 检查并重载"
if ! "$NGINX" -t; then
  cp -a "$BAK/site.conf" "$CONF"
  echo "配置检查失败 —— 已把站点配置回滚到备份：$BAK/site.conf"
  die "HTTPS 未启用，站点仍是原来的 80 端口（正常运行）"
fi
"$NGINX" -s reload
sleep 2
echo "已重载"

sleep 2
echo "已重载"

# 注：反代透传头与 HTTP→HTTPS 跳转**不在这里改**。
# 那个文件里 `location ^~ /` 与 `{` 是分两行的，用 sed 的 a\ 插很容易插进两者之间，
# 变成 `location ^~ / if (...)` → nginx 报 invalid number of arguments（踩过）。
# 改用 deploy/patch-nginx.mjs（Node，按行定位、改前备份、nginx -t 失败自动回滚）。

say "8. 本机自测"
echo -n "  HTTPS 无密码（期望 401）："
curl -sk -o /dev/null -w '%{http_code}\n' -H "Host: $DOMAIN" https://127.0.0.1/ || true
echo -n "  HTTPS 带密码（期望 200）："
curl -sk -o /dev/null -w '%{http_code}\n' -u tokei:"${PASS:-Tokei2026Read}" -H "Host: $DOMAIN" https://127.0.0.1/ || true
echo -n "  证书："
echo | openssl s_client -connect 127.0.0.1:443 -servername "$DOMAIN" 2>/dev/null | openssl x509 -noout -subject -enddate 2>/dev/null || echo "（读取失败）"

cat <<EOF

────────────────────────────────────────────
✅ 完成。请从外网验证：
   https://$DOMAIN/          （应弹密码框）
   https://www.$DOMAIN/

如果外网连不上 443：轻量应用服务器控制台 → 安全 → 防火墙 → 放行 TCP 443。
配置备份：$BAK
证书续期：acme.sh 已自动装上 cron，到期前会自动续并 reload nginx。
────────────────────────────────────────────
EOF
