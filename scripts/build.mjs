#!/usr/bin/env node
/**
 * 构建 / 发布前检查
 * ================
 * 本项目的「构建」不需要打包：前端是原生 ES Module，浏览器直接加载；
 * 数据 (data/books/*.json) 由前端 fetch 或服务端读取。
 *
 * 因此这里的职责是「发布前把关」：
 *   1. 运行知识库反剧透体检（check-data）
 *   2. 运行口径排除项回归（check-exclusions：纯恐怖、纯间谍不收）
 *   3. 运行核心逻辑单元测试
 *   4. 生成 data/manifest.json（版本、统计、标签分布、构建时间）
 *   5. 给出部署说明与体积报告
 *
 * 用法：node scripts/build.mjs  或  npm run build
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { TAGS, TAG_CATEGORIES, tagCategory } from '../web/js/core/tags.js';
import { normalizeSeedBook } from '../web/js/core/seed.js';
import { analyzeBook } from '../web/js/core/safety.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const WEB_DIR = path.join(ROOT, 'web');

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/**
 * 运行一个质量门禁脚本。
 *
 * 注意：不使用 stdio:'pipe' 捕获子进程输出。部分受限沙箱环境禁止管道形式的进程派生
 * （spawn EPERM），会表现为「命令失败但没有任何输出」，误导使用者。
 * 因此这里让子进程输出直通终端，只读取退出码判断成败。
 */
function runStep(label, scriptPath) {
  console.log('');
  console.log(color(`  ▸ ${label}`, C.cyan));
  console.log(color('  ────────────────────────────────────────────', C.dim));
  const result = spawnSync(process.execPath, [scriptPath], { cwd: ROOT, stdio: 'inherit' });
  const ok = result.status === 0;
  console.log(ok ? color(`  ✓ ${label} 通过`, C.green) : color(`  ✗ ${label} 未通过（退出码 ${result.status ?? '信号终止'}）`, C.red));
  return { ok };
}

async function collectBooks() {
  const books = [];
  let files = [];
  try {
    files = (await fs.readdir(BOOKS_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  } catch {
    return { books, files };
  }
  for (const file of files) {
    try {
      const list = JSON.parse(await fs.readFile(path.join(BOOKS_DIR, file), 'utf8'));
      if (!Array.isArray(list)) continue;
      for (const item of list) {
        const book = normalizeSeedBook(item, null, file);
        if (book) books.push(book);
      }
    } catch (error) {
      console.warn(color(`  ! 跳过 ${file}：${error.message}`, C.yellow));
    }
  }
  return { books, files };
}

async function dirSize(dir, filter = () => true) {
  let total = 0;
  let count = 0;
  const walk = async (current) => {
    let entries = [];
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (filter(full)) {
        const stat = await fs.stat(full);
        total += stat.size;
        count += 1;
      }
    }
  };
  await walk(dir);
  return { total, count };
}

function human(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function main() {
  console.log('');
  console.log(color('  推理小说诡计标签分析与推荐系统 —— 构建检查', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));

  // 1. 七道质量门禁
  const dataCheck = runStep('知识库反剧透体检', path.join(__dirname, 'check-data.mjs'));
  const exclusions = runStep('口径排除项回归（纯恐怖／纯间谍不收）', path.join(__dirname, 'check-exclusions.mjs'));
  /**
   * 第 121 轮新增：`data/not-collected.json`（已分诊但不另立条目的候选）的反向把关——
   * 台账里判过「不收／待核」的题名，一旦哪一轮又被收进库，这里就会失败。
   * §116 的《帕诺拉马岛绮谭》正是这样被当成新书收进去的，靠这道门禁兜住。
   */
  const notCollected = runStep('已分诊候选 · 不收／待核不回流', path.join(__dirname, 'check-not-collected.mjs'));
  const tests = runStep('核心逻辑单元测试', path.join(__dirname, 'run-tests.mjs'));
  const frontend = runStep('前端模块图与语法检查', path.join(__dirname, 'check-frontend.mjs'));
  const views = runStep('视图层回归测试（真实执行前端视图）', path.join(__dirname, 'test-views.mjs'));
  const serverTest = runStep('后端 API 端到端测试', path.join(__dirname, 'test-server.mjs'));

  // 2. 汇总数据
  const { books, files } = await collectBooks();
  // 流派（school）是与诡计类正交的第二个维度，存在 schoolTags 字段而非 tags，
  // 这里必须一并统计，否则 manifest 的流派分布会全是 0。
  const tagCounts = new Map();
  for (const book of books) {
    for (const t of book.tags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
    for (const t of book.schoolTags ?? []) tagCounts.set(t, (tagCounts.get(t) ?? 0) + 1);
  }
  const schoolTagIds = new Set(TAGS.filter((t) => t.category === 'school').map((t) => t.id));
  const tagsInUse = [...tagCounts.keys()].filter((id) => !schoolTagIds.has(id)).length;
  const schoolsInUse = [...tagCounts.keys()].filter((id) => schoolTagIds.has(id)).length;

  const allClean = books.every((b) => analyzeBook(b).passed);
  const withSummary = books.filter((b) => b.safeSummary).length;
  const withRating = books.filter((b) =>
    ['douban', 'hupu', 'goodreads'].some((p) => b.ratings?.[p]?.score !== null && b.ratings?.[p]?.score !== undefined),
  ).length;

  // 3. 生成 manifest
  const manifest = {
    name: '诡计档案 · 推理小说诡计标签分析与推荐系统',
    version: '1.0.0',
    generatedAt: new Date().toISOString(),
    spec: 'docs/reqirments.md',
    mode: 'static-esm',
    requiresBuildStep: false,
    stats: {
      books: books.length,
      dataFiles: files.length,
      tags: TAGS.length,
      categories: TAG_CATEGORIES.length,
      tagsInUse,
      schoolsInUse,
      withSafeSummary: withSummary,
      withPlatformRating: withRating,
    },
    tagDistribution: TAG_CATEGORIES.map((c) => ({
      category: c.id,
      label: c.label,
      weight: c.weight,
      tags: TAGS.filter((t) => t.category === c.id).map((t) => ({
        id: t.id,
        label: t.label,
        books: tagCounts.get(t.id) ?? 0,
      })),
    })),
    spoilerAudit: {
      passed: allClean,
      engine: 'web/js/core/safety.js',
      checkedBooks: books.length,
    },
    deploy: {
      static: '把 web/ 与 data/ 一起部署到静态托管即可（无后端）',
      withServer: 'node server/index.mjs（零依赖，Node.js 18+），同时提供静态资源与 /api',
      entry: 'web/index.html',
    },
  };

  await fs.writeFile(path.join(ROOT, 'data', 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  // 4. 体积报告
  const web = await dirSize(WEB_DIR);
  const data = await dirSize(path.join(ROOT, 'data'), (f) => f.endsWith('.json'));
  const critical = await dirSize(WEB_DIR, (f) => /\.(css|js)$/.test(f) && !f.includes('views'));

  console.log('');
  console.log(color('  产物统计', C.bold));
  console.log(`  作品总数       ${color(String(books.length), C.bold)} 部（${files.length} 个数据文件）`);
  console.log(`  标签字典       ${TAGS.length} 个 / ${TAG_CATEGORIES.length} 类，实际使用 ${tagsInUse} 个标签 + ${schoolsInUse} 个流派`);
  console.log(`  去剧透简介     ${withSummary} / ${books.length} 部`);
  console.log(`  平台评分       ${withRating} / ${books.length} 部含至少一个平台评分`);
  console.log(`  反剧透体检     ${allClean ? color('全库通过', C.green) : color('存在待确认项', C.yellow)}`);
  console.log('');
  console.log(color('  体积', C.bold));
  console.log(`  web/ 前端资源  ${human(web.total)}（${web.count} 个文件）`);
  console.log(`  其中核心 CSS/JS ${human(critical.total)}（不含按需加载的视图）`);
  console.log(`  data/ 知识库   ${human(data.total)}（${data.count} 个 JSON）`);
  console.log('');
  console.log(`  已生成 ${color('data/manifest.json', C.cyan)}`);
  console.log('');
  console.log(color('  部署方式', C.bold));
  console.log('  ① 纯静态：把 web/ 与 data/ 保持同级上传到任意静态托管');
  console.log('  ② 带后端：node server/index.mjs  （推荐，作品可持久化共享）');
  console.log('');

  if (!dataCheck.ok || !exclusions.ok || !notCollected.ok || !tests.ok || !frontend.ok || !views.ok || !serverTest.ok) {
    console.log(color('  ✗ 构建检查未通过，请先修复上述问题', C.red + C.bold));
    console.log('');
    process.exit(1);
  }

  console.log(color('  ✓ 构建检查全部通过，可以发布', C.green + C.bold));
  console.log('');
}

main().catch((error) => {
  console.error(color(`\n✗ 构建脚本异常：${error.stack ?? error.message}\n`, C.red));
  process.exit(1);
});
