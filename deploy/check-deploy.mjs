#!/usr/bin/env node
/**
 * 部署后自查（第 195 轮）
 * ====================
 * 用法：
 *   node deploy/check-deploy.mjs tokei-detective.top          # 线上（HTTPS + 证书检查）
 *   node deploy/check-deploy.mjs http://127.0.0.1:8787         # 本机先跑一遍（跳过证书/跳转检查）
 *
 * 站点上了整站密码之后（第 196 轮），**必须再带上凭据**，否则所有请求都是 401：
 *   node deploy/check-deploy.mjs tokei-detective.top 用户名:密码
 *   TRICK_AUTH=用户名:密码 node deploy/check-deploy.mjs tokei-detective.top
 *
 * 为什么用 Node 写而不是 bash：部署目标上**一定**有 Node（服务就是它跑的），
 * 而 Windows 上开发时没有 bash —— 这样同一份脚本在两边都能跑，本地就能先验证。
 *
 * 检查项对应第 192–194 轮补的那些安全口径，每一条都对应一个真实踩过的坑：
 *   ① 接口活着、书数对得上、unreadableFiles 为空（§178：半截批次文件）
 *   ② **谜底没有出网**：/data/books/*.json 取得到（前端要用）但不含 vault/culprit（§194）
 *   ③ **跨源写请求被拒**（CSRF 防线，§193）
 *   ④ **安全响应头在位**（CSP / X-Frame-Options / Referrer-Policy，§193）
 *   ⑤ HTTP 跳 HTTPS、证书有效期（仅域名模式）
 *   ⑥ 版本一览与封面目录可用
 */
const arg = process.argv[2];
if (!arg) {
  console.error('用法： node deploy/check-deploy.mjs 你的域名 [用户名:密码]   （或 http://127.0.0.1:8787 本机自查）');
  process.exit(2);
}
const LOCAL = /^http:\/\//i.test(arg);
const BASE = LOCAL ? arg.replace(/\/+$/, '') : `https://${arg}`;
const DOMAIN = LOCAL ? new URL(BASE).hostname : arg;

/* 整站密码（第 196 轮起）：第三个参数或 TRICK_AUTH，形如 tokei:密码 */
const AUTH = process.argv[3] ?? process.env.TRICK_AUTH ?? '';
const AUTH_HEADERS = AUTH ? { authorization: 'Basic ' + Buffer.from(AUTH).toString('base64') } : {};

let pass = 0;
let fail = 0;
const ok = (m) => {
  console.log(`  \u001b[32m✓\u001b[0m ${m}`);
  pass += 1;
};
const bad = (m) => {
  console.log(`  \u001b[31m✗\u001b[0m ${m}`);
  fail += 1;
};
const note = (m) => console.log(`    ${m}`);

const get = async (path, init = {}) => {
  try {
    return await fetch(BASE + path, {
      signal: AbortSignal.timeout(20_000),
      ...init,
      headers: { ...AUTH_HEADERS, ...(init.headers ?? {}) },
    });
  } catch (error) {
    return { ok: false, status: 0, error, text: async () => '', headers: new Headers() };
  }
};

console.log(`\n  自查目标：${BASE}${LOCAL ? '（本机模式：跳过证书与跳转检查）' : ''}${AUTH ? '（已带整站密码）' : ''}\n  ────────────────────────────────────────`);

/* ⓿ 整站密码：没带凭据时给出人能看懂的提示，而不是让后面 10 项全部莫名其妙地红 */
{
  const probe = await get('/');
  if (probe.status === 401 && !AUTH) {
    console.error('  ✗ 站点启用了整站密码（HTTP 401，见 WWW-Authenticate 响应头）。');
    console.error('    请带上凭据重跑： node deploy/check-deploy.mjs <域名> 用户名:密码');
    console.error('    或用环境变量：   TRICK_AUTH=用户名:密码 node deploy/check-deploy.mjs <域名>\n');
    process.exit(2);
  }
}

/* ① 接口 */
{
  const res = await get('/api/health');
  const body = res.ok ? await res.text() : '';
  if (body.includes('"ok":true')) {
    const books = Number(body.match(/"bookCount":(\d+)/)?.[1] ?? 0);
    ok(`接口可用（bookCount=${books}）`);
    if (books < 3000) bad(`书数偏少（${books}）：检查 data/books/*.json 是否完整`);
    if (/"unreadableFiles":\[\]/.test(body)) ok('unreadableFiles 为空（没有读不出来的批次文件）');
    else {
      bad('unreadableFiles 不是空数组——有批次文件只写了一半，页面总数会偏低');
      note(body.slice(0, 200));
    }
  } else {
    bad(`接口没通：${BASE}/api/health`);
    note('先看：systemctl status trick-archive ／ journalctl -u trick-archive -n 50');
  }
}

/* ② 谜底不出网 */
{
  const res = await get('/data/books/batch-01-honkaku.json');
  const text = res.ok ? await res.text() : '';
  if (!text) {
    bad('前端要用的 /data/books/*.json 取不到 —— 页面会卡在「加载中…」（§194）');
  } else if (/"vault"|culprit|coreTrick/.test(text)) {
    bad('取到的种子数据里**含谜底**（vault/culprit）——确认整站都反代给了 Node，而不是静态直发');
  } else {
    let count = 0;
    try {
      count = JSON.parse(text).length;
    } catch {
      count = -1;
    }
    ok(`种子文件可取且已剥掉谜底（${count} 条）`);
  }
  const ledger = await get('/data/covers.json');
  if (ledger.status === 200) bad('/data/covers.json 出网了——封面台账只归维护者，应当 404');
  else ok('/data/covers.json 不出网（只归维护者）');
}

/* ③ CSRF */
{
  const res = await get('/api/books', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://evil.example' },
    body: JSON.stringify({ title: '跨源探针', safeSummary: '不该被写入。' }),
  });
  if (res.status === 403) ok('跨源写请求被拒绝（403）');
  else bad(`跨源写请求返回 ${res.status}（期望 403）——CSRF 防线没生效？`);
}

/* ④ 安全响应头 */
{
  const res = await get('/');
  const need = ['content-security-policy', 'x-frame-options', 'referrer-policy'];
  for (const h of need) {
    if (res.headers.get(h)) ok(`响应头 ${h} 在位`);
    else bad(`缺响应头 ${h}`);
  }
  if (res.headers.get('strict-transport-security')) ok('HSTS 在位（说明反代传了 X-Forwarded-Proto: https）');
  else note('（未见 HSTS：走 HTTPS 反代时会由 Node 自动补，纯本机 http 下本就不该有）');
}

/* ⑤ 跳转与证书（仅域名模式） */
if (!LOCAL) {
  try {
    const httpRes = await fetch(`http://${DOMAIN}/`, {
      redirect: 'manual',
      signal: AbortSignal.timeout(15_000),
      headers: AUTH_HEADERS,
    });
    if ([301, 302, 308].includes(httpRes.status)) ok(`HTTP ${httpRes.status} 跳转到 HTTPS`);
    else bad(`http://${DOMAIN}/ 返回 ${httpRes.status}（期望 301/302/308）`);
  } catch (error) {
    bad(`http://${DOMAIN}/ 不通：${error.message}（检查 80 端口与云安全组）`);
  }
  try {
    const tls = await import('node:tls');
    const validTo = await new Promise((resolve, reject) => {
      const socket = tls.connect({ host: DOMAIN, port: 443, servername: DOMAIN, timeout: 15_000 }, () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        resolve(cert?.valid_to ?? '');
      });
      socket.on('error', reject);
      socket.on('timeout', () => reject(new Error('连接超时')));
    });
    if (validTo) ok(`证书有效期至：${validTo}`);
    else bad('取不到证书信息');
  } catch (error) {
    bad(`443 上取证书失败：${error.message}`);
  }
}

/* ⑥ 按需加载的路径 */
{
  const editions = await get('/data/covers-editions.json');
  if (editions.ok) ok('版本一览数据可取（档案页要用）');
  else bad('/data/covers-editions.json 取不到——档案页会少一块「版本一览」');
  const placeholder = await get('/covers/_placeholder.svg');
  if (placeholder.ok) ok('封面目录可访问（占位图 200）');
  else bad(`封面目录异常（占位图 HTTP ${placeholder.status}）`);
}

console.log('  ────────────────────────────────────────');
console.log(`  通过 ${pass} 项，失败 ${fail} 项\n`);
process.exit(fail ? 1 : 0);
