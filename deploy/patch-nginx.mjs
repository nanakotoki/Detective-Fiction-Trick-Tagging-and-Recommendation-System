#!/usr/bin/env node
/**
 * 给宝塔反向代理配置打两个补丁（第 196 轮收尾）
 * ==============================================
 * 为什么需要：
 *   1. 宝塔生成的反代配置只传了 Host / X-Real-IP / X-Forwarded-For，
 *      **漏了 X-Forwarded-Proto** —— Node 因此判断不出「外面是 HTTPS」，
 *      不会补 HSTS；CSRF 的同源判断也会失准。
 *   2. 站点要"HTTP 一律跳 HTTPS"，否则密码会走明文那一路。
 *
 * 为什么用 Node 而不是 sed：那个文件里 `location ^~ /` 与 `{` 是**分两行**的，
 * 用 sed 的 `a\` 插容易插到两者之间，变成 `location ^~ / if (...)`，
 * nginx 直接报 "invalid number of arguments in location directive"（踩过）。
 * Node 里按"行"定位、在 `{` 之**后**插入，清楚可靠，而且能先在本地跑一遍验证。
 *
 * 安全措施：改前备份 → 写入 → `nginx -t` → 失败自动回滚、不重载。
 * 幂等：已经打过补丁的文件不会被改第二次。
 *
 * 用法： sudo node patch-nginx.mjs [域名] [nginx 路径]
 */
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const DOMAIN = process.argv[2] ?? 'tokei-detective.top';
const NGINX = process.argv[3] ?? '/www/server/nginx/sbin/nginx';
const PROXY_DIR = `/www/server/panel/vhost/nginx/proxy/${DOMAIN}`;
const BAK = `/root/tokei-proxy-backup-${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15)}`;

const PROTO_LINE = '    proxy_set_header X-Forwarded-Proto $scheme;';
const REDIRECT_LINES = [
  '    # force-https：HTTP 一律跳 HTTPS（第 196 轮）',
  '    # 放在 location ^~ / 里，ACME 那条 ^~ /.well-known/... 更精确，续期不受影响',
  '    if ($scheme = http) { return 301 https://$host$request_uri; }',
];

/** 在「以 pattern 开头的那段 {...}」的左花括号之后插入若干行 */
export function insertInsideBlock(lines, openerRegex, insertLines) {
  const start = lines.findIndex((l) => openerRegex.test(l));
  if (start === -1) throw new Error(`没找到块开头：${openerRegex}`);
  const brace = lines.findIndex((l, i) => i > start && l.trim() === '{');
  if (brace === -1) throw new Error('块的左花括号不在单独一行上，拒绝盲改');
  return [...lines.slice(0, brace + 1), ...insertLines, ...lines.slice(brace + 1)];
}

/** 补 X-Forwarded-Proto（幂等） */
export function patchForwardedProto(text) {
  if (text.includes('X-Forwarded-Proto')) return { text, changed: false };
  const lines = text.split('\n');
  const idx = lines.findIndex((l) => /proxy_set_header\s+X-Forwarded-For/.test(l));
  if (idx === -1) throw new Error('没找到 proxy_set_header X-Forwarded-For 这一行');
  lines.splice(idx + 1, 0, PROTO_LINE);
  return { text: lines.join('\n'), changed: true };
}

/** 加 HTTP→HTTPS 跳转（幂等） */
export function patchRedirect(text) {
  if (text.includes('force-https')) return { text, changed: false };
  const lines = text.split('\n');
  const out = insertInsideBlock(lines, /^\s*location\s+\^~\s+\/\s*$/, REDIRECT_LINES);
  return { text: out.join('\n'), changed: true };
}

/* ------------------------------------------------------------------ */
/* 只有直接运行时才动文件（被 import 时只导出函数，方便测试）            */
/* ------------------------------------------------------------------ */

const isMain = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
if (!isMain) {
  // 被测试脚本 import：什么都不做
} else {
  if (!fs.existsSync(PROXY_DIR)) {
    console.error(`✗ 找不到反向代理目录：${PROXY_DIR}`);
    console.error('  这说明这个站没有配置反向代理，或者目录名不是域名。');
    process.exit(2);
  }

  const files = fs.readdirSync(PROXY_DIR).filter((f) => f.endsWith('.conf'));
  if (!files.length) {
    console.error(`✗ ${PROXY_DIR} 下没有 .conf 文件`);
    process.exit(2);
  }

  fs.mkdirSync(BAK, { recursive: true });
  const originals = new Map();
  let changed = 0;

  for (const name of files) {
    const file = path.join(PROXY_DIR, name);
    const original = fs.readFileSync(file, 'utf8');
    originals.set(file, original);
    console.log(`\n▸ ${name}`);

    let { text } = { text: original };
    const proto = patchForwardedProto(text);
    text = proto.text;
    console.log(proto.changed ? `  ✓ 补上 X-Forwarded-Proto $scheme` : `  · X-Forwarded-Proto 已存在`);

    const redirect = patchRedirect(text);
    text = redirect.text;
    console.log(redirect.changed ? `  ✓ 加上 HTTP→HTTPS 跳转` : `  · 跳转已存在`);

    if (proto.changed || redirect.changed) {
      fs.copyFileSync(file, path.join(BAK, name));
      fs.writeFileSync(file, text, 'utf8');
      changed += 1;
    }
  }

  if (!changed) {
    console.log('\n本来就已经是最新的，什么都没改。');
    process.exit(0);
  }

  const run = (args) =>
    execFileSync(NGINX, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

  console.log('\n▸ nginx -t …');
  try {
    process.stdout.write(run(['-t']));
    console.log('▸ 重载 nginx …');
    run(['-s', 'reload']);
    console.log('✓ 完成');
    console.log(`  备份在：${BAK}`);
  } catch (error) {
    const detail = `${error.stdout ?? ''}${error.stderr ?? ''}`.trim();
    console.error('✗ nginx 配置检查失败，正在回滚：');
    console.error(detail.split('\n').map((l) => `    ${l}`).join('\n'));
    for (const [file, text] of originals) fs.writeFileSync(file, text, 'utf8');
    console.error('  已回滚到原配置，站点没受影响（HTTPS 仍可用，只是没有 HSTS 与跳转）。');
    process.exit(1);
  }
}
