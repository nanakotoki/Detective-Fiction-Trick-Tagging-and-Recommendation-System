#!/usr/bin/env node
/**
 * 等豆瓣放开，然后自动收尾（第 184 轮·D 线）
 * ==========================================
 * 为什么要有这一条：豆瓣按 IP 挡 HTML 页时，缺的那 51 部封面只能等；而「等」这件事
 * 不该由人盯着。原先这个等待循环只写在我自己的 `_dd/` 里（gitignore），**关机重启就没了**，
 * 仓库里等于没交付。这一版落进仓库，**开机后随时能再起**：
 *
 *   npm run covers:wait                    # 每 5 分钟探一次，最多 60 次（约 5 小时）
 *   npm run covers:wait -- --hours 3       # 只守 3 小时（比如睡前挂着，关机就算了）
 *   npm run covers:wait -- --interval 8 --tries 120   # 更省事的探法（约 16 小时）
 *   npm run covers:wait -- --quick         # 通了以后跳过最慢的重复图体检
 *
 * 探测判据：条目页能拿到正文（>20KB 且含 `id="mainpic"`）——与抓取脚本同一条判据，
 * 不接受「HTTP 200 但其实是拦截页」。通了才动手，绝不硬碰（额度是累计的，§175）。
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const argv = process.argv.slice(2);
const num = (flag, dflt) => {
  const i = argv.indexOf(flag);
  const v = i >= 0 ? Number(argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : dflt;
};
const HOURS = num('--hours', 0);
const INTERVAL_MIN = HOURS ? 5 : num('--interval', 5);
const TRIES = HOURS ? Math.max(1, Math.round((HOURS * 60) / INTERVAL_MIN)) : num('--tries', 60);
const PASS_THROUGH = ['--quick', '--dry'].filter((f) => argv.includes(f));

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const LOG = path.join(ROOT, '_dd', 'covers-wait.log');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stamp = () => new Date().toLocaleString('zh-CN', { hour12: false });
function log(message) {
  const line = `[${stamp()}] ${message}`;
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.appendFileSync(LOG, `${line}\n`);
  } catch {
    /* 日志写不了不影响主流程 */
  }
}

/** 豆瓣的条目页现在能开吗？（HTTP 200 也可能是拦截页，所以要看正文） */
async function doubanOpen() {
  try {
    const res = await fetch('https://book.douban.com/subject/1080402/', {
      headers: { 'user-agent': UA, referer: 'https://book.douban.com/', accept: 'text/html,application/xhtml+xml' },
      signal: AbortSignal.timeout(15_000),
    });
    const html = await res.text();
    return res.ok && html.length > 20_000 && html.includes('id="mainpic"');
  } catch {
    return false;
  }
}

console.log('');
console.log(`  等豆瓣放开：每 ${INTERVAL_MIN} 分钟探一次、最多 ${TRIES} 次（约 ${((TRIES * INTERVAL_MIN) / 60).toFixed(1)} 小时）`);
console.log('  通了才动手；日志同时写进 _dd/covers-wait.log');
console.log('');

let open = false;
for (let i = 1; i <= TRIES; i += 1) {
  if (await doubanOpen()) {
    log(`✓ 豆瓣已恢复（第 ${i}/${TRIES} 次探测）`);
    open = true;
    break;
  }
  if (i === 1 || i % 5 === 0) log(`  第 ${i}/${TRIES} 次探测：仍在限流`);
  if (i < TRIES) await sleep(INTERVAL_MIN * 60 * 1000);
}

if (!open) {
  log('⚠ 守候时间用完，豆瓣仍未放开。开机后再跑同一条命令即可：npm run covers:wait');
  // 带着在途连接 process.exit() 在 Windows 上会触发 libuv 断言（退出码看着像崩溃），先让连接收干净
  await sleep(500);
  process.exit(1);
}

log('▶ 开始收尾链：node scripts/finish-covers.mjs ' + PASS_THROUGH.join(' '));
const res = spawnSync(process.execPath, ['scripts/finish-covers.mjs', ...PASS_THROUGH], { stdio: 'inherit', cwd: ROOT });
log(`${res.status === 0 ? '✓' : '✗'} 收尾链结束（退出码 ${res.status}）`);
await sleep(500);
process.exit(res.status === 0 ? 0 : 1);
