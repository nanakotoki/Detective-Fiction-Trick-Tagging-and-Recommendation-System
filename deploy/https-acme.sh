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

set -euo pipefail

DOMAIN="${DOMAIN:-tokei-detective.top}"
WEBROOT="${WEBROOT:-/www/wwwroot/$DOMAIN}"
NGINX="${NGINX:-/www/server/nginx/sbin/nginx}"
CONF="/www/server/panel/vhost/nginx/$DOMAIN.conf"
REWRITE="/www/server/panel/vhost/rewrite/$DOMAIN.conf"
SSLDIR="/etc/tokei-ssl"
EMAIL="${EMAIL:-admin@$DOMAIN}"
BAK="/root/tokei-https-backup-$(date +%Y%m%d-%H%M%S)"

say() { printf '\n\033[1m== %s ==\033[0m\n' "$*"; }
die() { printf '\n\033[31m✗ %s\033[0m\n' "$*" >&2; exit 1; }

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

say "4. 申请证书（acme.sh + Let's Encrypt）"
if [ -f "/root/.acme.sh/acme.sh" ]; then
  echo "acme.sh 已安装"
else
  echo "安装 acme.sh …"
  curl -s https://get.acme.sh | sh -s "email=$EMAIL"
fi
ACME="/root/.acme.sh/acme.sh"
[ -x "$ACME" ] || die "acme.sh 安装失败"
"$ACME" --set-default-ca --server letsencrypt >/dev/null
"$ACME" --issue -d "$DOMAIN" -d "www.$DOMAIN" -w "$WEBROOT" || die "证书申请失败（看上面的原因）"
mkdir -p "$SSLDIR"
"$ACME" --install-cert -d "$DOMAIN" \
  --key-file "$SSLDIR/tokei.key" \
  --fullchain-file "$SSLDIR/tokei.pem" \
  --reloadcmd "$NGINX -s reload"
echo "证书已安装到 $SSLDIR/tokei.pem"

say "5. 追加 443 的 server 块（幂等）"
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

    location ^~ /.well-known/acme-challenge/ {
        root $WEBROOT;
        auth_basic off;
        allow all;
    }

    # 和 80 的站点共用同一套反向代理规则（第 196 轮：整站只转发，不直发文件）
    include /www/server/panel/vhost/nginx/proxy/$DOMAIN/*.conf;
    include /www/server/panel/vhost/rewrite/$DOMAIN.conf;

    access_log  /www/wwwlogs/$DOMAIN.log;
    error_log   /www/wwwlogs/$DOMAIN.error.log;
}
EOF
  echo "已追加 443 配置"
fi

say "6. 检查并重载"
if ! "$NGINX" -t; then
  cp -a "$BAK/site.conf" "$CONF"
  echo "配置检查失败 —— 已把站点配置回滚到备份：$BAK/site.conf"
  die "HTTPS 未启用，站点仍是原来的 80 端口（正常运行）"
fi
"$NGINX" -s reload
echo "已重载"

say "7. 本机自测"
echo -n "  HTTPS 无密码（期望 401）："
curl -sk -o /dev/null -w '%{http_code}\n' -H "Host: $DOMAIN" https://127.0.0.1/ || true
echo -n "  HTTPS 证书主题："
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
