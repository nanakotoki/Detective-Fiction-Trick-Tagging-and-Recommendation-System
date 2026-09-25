#!/usr/bin/env node
/**
 * 后端 API 端到端测试
 * ==================
 * 用 Node 原生 fetch 直连服务端，覆盖：
 *   - 健康检查 / 列表 / 标签 / 统计 / 推荐 / 导出
 *   - 静态资源与路径穿越防护
 *   - 动态增删改查
 *   - 反剧透门禁（剧透文案、超长简介、非法标签都必须被 422 拦截）
 *   - 保险库永不出网
 *
 * 前置：先启动服务端（脚本会自动拉起一个临时实例）。
 * 运行：node scripts/test-server.mjs
 */

import { spawn } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.TEST_PORT ?? 8899);
const BASE = `http://127.0.0.1:${PORT}`;

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ${color('✓', C.green)} ${name}${detail ? color(`  ${detail}`, C.dim) : ''}`);
  } else {
    failed += 1;
    console.log(`  ${color('✗', C.red)} ${name}${detail ? `  ${detail}` : ''}`);
  }
}

async function req(method, urlPath, body) {
  const res = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const TEST_ID = 'e2e-test-book';

function cleanup() {
  const file = path.join(ROOT, 'server', 'data', 'books.json');
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.books = (data.books ?? []).filter((b) => b.id !== TEST_ID && !b.id.startsWith('e2e-'));
    fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  } catch {
    /* 文件不存在则无需清理 */
  }
}

async function waitForServer(timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

/**
 * 拉起一个临时服务端实例。
 *
 * 注意：stdio 用 'ignore' 而非 'pipe'。部分受限沙箱环境禁止管道形式的进程派生
 * （spawn EPERM），而本脚本并不需要读取服务端日志（服务端本身有 --quiet）。
 */
function startServer() {
  return spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs'), '--port', String(PORT), '--quiet'], {
    cwd: ROOT,
    stdio: 'ignore',
    detached: false,
  });
}

async function main() {
  cleanup(); // 先清掉上次残留

  console.log('');
  console.log(color('  后端 API 端到端测试', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));

  // 若端口上已有服务端在跑（例如手动起的），直接复用，避免端口冲突
  let server = null;
  const alreadyUp = await waitForServer(600);
  if (alreadyUp) {
    console.log(color(`  复用已在运行的服务端：${BASE}`, C.dim));
  } else {
    server = startServer();
  }

  try {
    const up = await waitForServer(15000);
    if (!up) {
      console.log(color('  ✗ 服务端未能在 15 秒内启动', C.red));
      console.log(color(`    请手动运行： node server/index.mjs --port ${PORT}`, C.dim));
      process.exit(1);
    }
    console.log(`  服务端已就绪：${BASE}\n`);

    /* ---------- 只读接口 ---------- */
    console.log(color('  [只读接口]', C.dim));
    const health = await req('GET', '/api/health');
    check('GET /api/health 返回 ok', health.status === 200 && health.json?.ok === true, `books=${health.json?.bookCount}`);

    const books = await req('GET', '/api/books');
    const list = books.json?.books ?? [];
    check('GET /api/books 返回书籍列表', books.status === 200 && list.length > 0, `${list.length} 部`);
    check('列表非空且含安全简介', list.every((b) => typeof b.safeSummary === 'string'));

    const tags = await req('GET', '/api/tags');
    check('GET /api/tags 返回标签字典', tags.status === 200 && tags.json.tags.length > 40, `${tags.json?.tags?.length} 个标签`);

    const stats = await req('GET', '/api/stats');
    check('GET /api/stats 返回统计', stats.status === 200 && stats.json.total > 0, `total=${stats.json?.total}`);

    const exportRes = await req('GET', '/api/export');
    check('GET /api/export 导出知识库', exportRes.status === 200 && Array.isArray(exportRes.json.books));

    /* ---------- 保险库隔离 ---------- */
    console.log('');
    console.log(color('  [反剧透：保险库隔离]', C.dim));
    const vaultLeak = list.filter((b) => b.vault !== undefined).length;
    check('API 响应中不含任何 vault 字段', vaultLeak === 0, `检出 ${vaultLeak} 条`);
    check('API 响应文本中不出现"谜底保险库"内容', !books.text.includes('"culprit"'));

    /* ---------- 推荐接口 ---------- */
    console.log('');
    console.log(color('  [推荐接口]', C.dim));
    const target = list.find((b) => b.title === '无人生还') ?? list[0];
    const rec = await req('POST', '/api/recommend', { id: target.id, limit: 3 });
    check('POST /api/recommend 返回推荐', rec.status === 200 && rec.json.recommendations.length === 3, `共 ${rec.json?.recommendations?.length} 本`);
    check('推荐理由只含标签类型比较', rec.json.recommendations.every((r) => !/凶手是|真凶是|真相是/.test(r.reason)));
    check('每条推荐都标注了共享标签', rec.json.recommendations.every((r) => r.matchedTags.length > 0));

    /* ---------- 反剧透门禁 ---------- */
    console.log('');
    console.log(color('  [反剧透门禁：必须全部拦截]', C.dim));

    const spoilerCases = [
      ['凶手身份', '这本书的凶手是管家，真相是他一直在说谎。'],
      ['手法答案', '凶手利用暗道完成了密室，破解的关键是死亡时间被伪造。'],
      ['结局泄底', '最终真相是所有人都在撒谎，真凶浮出水面。'],
      ['跨作品泄底', '这本书的凶手是双胞胎，和另一本一样。'],
    ];
    for (const [label, summary] of spoilerCases) {
      const res = await req('POST', '/api/books', {
        id: `${TEST_ID}-${label}`,
        title: `E2E ${label}`,
        author: '测试',
        genre: '本格推理',
        safeSummary: summary,
        tags: ['locked-room'],
        ratings: {},
      });
      check(`拦截「${label}」类剧透`, res.status === 422, `HTTP ${res.status}`);
    }

    const tooLong = await req('POST', '/api/books', {
      id: `${TEST_ID}-long`,
      title: 'E2E 超长',
      author: '测试',
      safeSummary: '测'.repeat(130),
      tags: ['locked-room'],
      ratings: {},
    });
    check('拦截超过 100 字的简介', tooLong.status === 422, `HTTP ${tooLong.status}`);

    const badTag = await req('POST', '/api/books', {
      id: `${TEST_ID}-tag`,
      title: 'E2E 非法标签',
      author: '测试',
      safeSummary: '一部关于密室的作品。',
      tags: ['not-a-real-tag'],
      ratings: {},
    });
    check('拦截未收录的标签 id', badTag.status === 422, `HTTP ${badTag.status}`);

    const badSchool = await req('POST', '/api/books', {
      id: `${TEST_ID}-school`,
      title: 'E2E 非法流派',
      author: '测试',
      safeSummary: '一部关于密室的作品。',
      tags: ['locked-room'],
      school: ['not-a-real-school'],
      ratings: {},
    });
    check('拦截未收录的流派 id', badSchool.status === 422, `HTTP ${badSchool.status}`);

    const schoolInTags = await req('POST', '/api/books', {
      id: `${TEST_ID}-mixed`,
      title: 'E2E 流派混写',
      author: '测试',
      safeSummary: '一部关于密室的作品。',
      tags: ['locked-room', 'logic-school'],
      ratings: {},
    });
    check('拦截把流派写进 tags 的混写', schoolInTags.status === 422, `HTTP ${schoolInTags.status}`);

    const trickInSchool = await req('POST', '/api/books', {
      id: `${TEST_ID}-wrongdim`,
      title: 'E2E 维度写反',
      author: '测试',
      safeSummary: '一部关于密室的作品。',
      tags: ['locked-room'],
      school: ['red-herring'],
      ratings: {},
    });
    check('拦截把诡计标签写进 school', trickInSchool.status === 422, `HTTP ${trickInSchool.status}`);

    const noId = await req('POST', '/api/books', {
      title: 'E2E 无 id',
      author: '测试',
      safeSummary: '一部关于密室的作品。',
      tags: ['locked-room'],
      ratings: {},
    });
    check('拦截缺少 id 的提交', noId.status === 422, `HTTP ${noId.status}`);

    const badId = await req('POST', '/api/books', {
      id: '非法 id 带空格',
      title: 'E2E 非法 id',
      author: '测试',
      safeSummary: '一部关于密室的作品。',
      tags: ['locked-room'],
      ratings: {},
    });
    check('拦截格式非法的 id', badId.status === 422, `HTTP ${badId.status}`);

    /* ---------- 合法写入与 CRUD ---------- */
    console.log('');
    console.log(color('  [动态增删改查]', C.dim));

    const create = await req('POST', '/api/books', {
      id: TEST_ID,
      title: 'E2E 合法条目',
      author: '测试作者',
      genre: '本格推理',
      safeSummary: '十个人来到一座与外界隔绝的孤岛，主人始终没有露面。',
      tags: ['locked-room', 'closed-circle', 'isolated-island', 'ensemble'],
      school: ['orthodox-school', 'trick-school'],
      ratings: { douban: { score: 8.5, count: 1000, source: '豆瓣读书', asOf: '2025-01', summary: '用于测试的条目。' } },
      readingTips: { suitableFor: ['测试'], watchFor: ['测试维度'], warning: '' },
    });
    check('合法条目创建成功', create.status === 201, `HTTP ${create.status}`);

    const dup = await req('POST', '/api/books', {
      id: TEST_ID,
      title: 'E2E 重复 id',
      author: '测试',
      safeSummary: '一部关于密室的作品。',
      tags: ['locked-room'],
      ratings: {},
    });
    check('重复 id 被拒绝', dup.status === 409, `HTTP ${dup.status}`);

    const getOne = await req('GET', `/api/books/${TEST_ID}`);
    check('GET /api/books/:id 可读回', getOne.status === 200 && getOne.json.book.title === 'E2E 合法条目');
    check(
      '流派写入 schoolTags 且未混入 tags',
      JSON.stringify(getOne.json?.book?.schoolTags) === JSON.stringify(['orthodox-school', 'trick-school']) &&
        !(getOne.json?.book?.tags ?? []).some((id) => id.endsWith('-school')),
      `schoolTags=${JSON.stringify(getOne.json?.book?.schoolTags)}`,
    );

    const update = await req('PUT', `/api/books/${TEST_ID}`, {
      id: TEST_ID,
      title: 'E2E 已更新标题',
      author: '测试作者',
      safeSummary: '更新后的去剧透简介，仍然不含任何谜底。',
      tags: ['locked-room', 'alibi'],
      ratings: {},
    });
    check('PUT 更新成功', update.status === 200);

    const afterUpdate = await req('GET', `/api/books/${TEST_ID}`);
    check('更新已生效', afterUpdate.json?.book?.title === 'E2E 已更新标题', afterUpdate.json?.book?.title);

    // 写入一条带保险库的用户条目，验证保险库不出网
    const withVault = await req('PUT', `/api/books/${TEST_ID}`, {
      id: TEST_ID,
      title: 'E2E 已更新标题',
      author: '测试作者',
      safeSummary: '更新后的去剧透简介，仍然不含任何谜底。',
      tags: ['locked-room'],
      ratings: {},
      vault: { culprit: '绝对不该出网的名字', coreTrick: '绝对不该出网的解法', ending: '', notes: '' },
    });
    check('带保险库的条目可以保存', withVault.status === 200);
    const readBack = await req('GET', `/api/books/${TEST_ID}`);
    check('保险库内容不出网（单条读取）', !readBack.text.includes('绝对不该出网'));
    const listAgain = await req('GET', '/api/books');
    check('保险库内容不出网（列表）', !listAgain.text.includes('绝对不该出网'));

    const del = await req('DELETE', `/api/books/${TEST_ID}`);
    check('DELETE 删除成功', del.status === 200);
    const gone = await req('GET', `/api/books/${TEST_ID}`);
    check('删除后确实读不到', gone.status === 404, `HTTP ${gone.status}`);

    /* ---------- 静态资源与安全 ---------- */
    console.log('');
    console.log(color('  [静态资源与安全]', C.dim));

    const index = await fetch(`${BASE}/`);
    check('GET / 返回入口 HTML', index.status === 200 && (await index.text()).includes('<!doctype html>'));

    const appJs = await fetch(`${BASE}/js/app.js`);
    check('GET /js/app.js 返回 JS 且 MIME 正确', appJs.status === 200 && appJs.headers.get('content-type').includes('javascript'));

    const css = await fetch(`${BASE}/css/styles.css`);
    check('GET /css/styles.css 返回 CSS', css.status === 200 && css.headers.get('content-type').includes('css'));

    const dataFile = await fetch(`${BASE}/data/books/batch-01-honkaku.json`);
    check('GET /data/** 可读取知识库', dataFile.status === 200);

    const traversal = await fetch(`${BASE}/api/books/..%2f..%2fpackage.json`);
    check('路径穿越被拦截', traversal.status === 404 || traversal.status === 400, `HTTP ${traversal.status}`);

    const traversal2 = await fetch(`${BASE}/../package.json`);
    check('上级目录访问被拒绝', !(traversal2.status === 200 && (await traversal2.text()).includes('"name"')));

    const nope = await fetch(`${BASE}/api/not-exist`);
    check('未知接口返回 404', nope.status === 404);

    const spaFallback = await fetch(`${BASE}/library`);
    check('SPA 路由回退到入口 HTML', spaFallback.status === 200);

    /* ---------- 缓存与资源版本化 ---------- */
    console.log('');
    console.log(color('  [缓存与资源版本化]', C.dim));

    const indexBody = await (await fetch(`${BASE}/`)).text();
    const version = indexBody.match(/js\/app\.js\?v=([a-f0-9]+)/)?.[1];
    check('入口 HTML 的资源引用带版本号', Boolean(version), version ? `v=${version}` : '未注入');

    if (version) {
      const appRes = await fetch(`${BASE}/js/app.js?v=${version}`);
      const appSource = appRes.ok ? await appRes.text() : '';

      // 统计相对导入：静态 from、副作用 import、动态 import() 都要算上。
      // 注意这里用正则字面量而不是 new RegExp('...')：
      // 写成字符串时 '\b' 会被解释成退格符、'\s' 会变成普通字符 s，模式必然失配。
      // 捕获组先取引号内的完整内容，再剥掉可能存在的 ?v= 版本号。
      const allSpecifiers = [...appSource.matchAll(/(?:\bfrom|\bimport)\s*\(?\s*(['"])([^'"]+)\1/g)].map((m) => m[2]);
      const relative = allSpecifiers.filter((spec) => spec.startsWith('./') || spec.startsWith('../'));
      const unversioned = relative.filter((spec) => !spec.includes('?v='));

      check(
        'JS 模块的相对 import 也被版本化（否则深层模块不会随代码更新）',
        relative.length > 0 && unversioned.length === 0,
        `HTTP ${appRes.status}，${allSpecifiers.length} 个说明符，其中相对导入 ${relative.length} 条，未版本化 ${unversioned.length} 条` +
          (unversioned.length ? `：${unversioned.slice(0, 3).join(', ')}` : ''),
      );

      // 深层模块也要能被版本号加载
      if (relative.length) {
        const resolved = new URL(relative[0], `${BASE}/js/app.js?v=${version}`);
        const deep = await fetch(resolved);
        check('带版本号可正常加载深层模块', deep.status === 200, `${resolved.pathname}${resolved.search} → HTTP ${deep.status}`);
      }
    }

    const cssRes = await fetch(`${BASE}/css/styles.css`);
    check(
      '静态资源禁用强缓存（no-cache，避免用户看到旧代码）',
      (cssRes.headers.get('cache-control') ?? '').includes('no-cache'),
      cssRes.headers.get('cache-control') ?? '',
    );

    const jsRes = await fetch(`${BASE}/js/ui/dom.js`);
    const jsEtag = jsRes.headers.get('etag');
    const revalidated = await fetch(`${BASE}/js/ui/dom.js`, { headers: { 'if-none-match': jsEtag } });
    check('带 If-None-Match 复请求返回 304（缓存校验生效）', revalidated.status === 304, `HTTP ${revalidated.status}`);
  } finally {
    if (server) {
      server.kill();
      await new Promise((r) => setTimeout(r, 300));
    }
    cleanup();
  }

  console.log('');
  console.log(color('  ────────────────────────────────────────────', C.dim));
  console.log(`  通过 ${color(String(passed), C.green + C.bold)} 项，失败 ${failed ? color(String(failed), C.red + C.bold) : '0 项'}`);
  console.log('');
  process.exit(failed ? 1 : 0);
}

main().catch((error) => {
  console.error(color(`\n✗ 测试脚本异常：${error.stack ?? error.message}\n`, C.red));
  process.exit(1);
});
