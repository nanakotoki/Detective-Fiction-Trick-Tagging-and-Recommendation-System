#!/usr/bin/env node
/**
 * 推理小说诡计标签分析与推荐系统 —— 零依赖后端服务
 * =================================================
 * 职责：
 *   1. 静态托管 web/ 与 data/（生产环境也可只部署静态部分，见 README）
 *   2. 提供知识库读取接口与「动态添加 / 编辑 / 删除小说」的写接口
 *   3. 服务端复用同一套反剧透校验，把不安全的数据挡在入库之前
 *
 * 启动： node server/index.mjs [--port 8787] [--host 127.0.0.1]
 */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JsonStore } from './lib/json-store.mjs';
import { assetVersion, collectAssetFiles, serveStatic } from './lib/static.mjs';

import { TAGS, TAG_CATEGORIES, isSchoolTag, tagCategory, tagLabel, partitionTags } from '../web/js/core/tags.js';
import { analyzeBook, stripVault } from '../web/js/core/safety.js';
import { bookTagIds, recommend, tagCooccurrence } from '../web/js/core/engine.js';
import { normalizeSeedBook, authorListOf } from '../web/js/core/seed.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');
const DATA_DIR = path.join(ROOT, 'data');
const BOOKS_DIR = path.join(DATA_DIR, 'books');
const USER_DATA_DIR = path.join(__dirname, 'data');

/* ------------------------------------------------------------------ */
/* 参数解析                                                            */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const args = { port: null, host: null, quiet: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') args.port = Number(argv[++i]);
    else if (arg === '--host' || arg === '-h') args.host = argv[++i];
    else if (arg === '--quiet') args.quiet = true;
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const PORT = args.port ?? Number(process.env.PORT ?? 8787);
const HOST = args.host ?? process.env.HOST ?? '127.0.0.1';

/* ------------------------------------------------------------------ */
/* 数据装载                                                            */
/* ------------------------------------------------------------------ */

const userBooksStore = new JsonStore(path.join(USER_DATA_DIR, 'books.json'), { books: [] });
const metaStore = new JsonStore(path.join(USER_DATA_DIR, 'meta.json'), { version: 1, seededAt: null });

/**
 * 前端资源版本号。
 *
 * 本项目前端无构建步骤、文件名不带内容哈希，若浏览器缓存了旧模块，
 * 用户会看到"改过的代码却没生效"。因此按所有 css/js 的大小与修改时间
 * 算出一个版本号，注入到 index.html 的资源引用上（?v=xxx）。
 * 文件一改，URL 就变，浏览器必然重新拉取——用户不需要强制刷新。
 */
let WEB_ASSET_VERSION = assetVersion(collectAssetFiles(WEB_DIR));

/** 资源文件变动时刷新版本号（每次请求都判断，开销极小） */
function refreshAssetVersionIfChanged() {
  const next = assetVersion(collectAssetFiles(WEB_DIR));
  if (next !== WEB_ASSET_VERSION) {
    WEB_ASSET_VERSION = next;
    return true;
  }
  return false;
}

/** 读取 data/books/*.json 得到种子知识库 */
async function loadSeed() {
  const books = [];
  let files = [];
  try {
    files = (await fs.readdir(BOOKS_DIR)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return books;
  }

  for (const file of files) {
    try {
      const raw = await fs.readFile(path.join(BOOKS_DIR, file), 'utf8');
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) {
        console.warn(`[seed] ${file} 不是数组，已跳过`);
        continue;
      }
      for (const item of list) {
        const book = normalizeSeedBook(item, null, file);
        if (!book) continue;
        book.origin = 'seed';
        books.push(book);
      }
    } catch (error) {
      console.warn(`[seed] 读取 ${file} 失败：${error.message}`);
    }
  }

  // 知识库可能被拆分到多个文件，按 id 去重（保留先出现的）
  const byId = new Map();
  for (const book of books) if (!byId.has(book.id)) byId.set(book.id, book);
  return [...byId.values()];
}

let seedBooks = [];
let mergedCache = null;

async function getAllBooks({ fresh = false } = {}) {
  if (mergedCache && !fresh) return mergedCache;
  const userData = await userBooksStore.read();
  const userBooks = (userData?.books ?? []).map((b) => normalizeSeedBook(b)).filter(Boolean);
  const deleted = new Set(userData?.deleted ?? []);
  const overrides = userData?.overrides ?? {};

  const byId = new Map();
  for (const book of seedBooks) {
    if (deleted.has(book.id)) continue;
    const override = overrides[book.id];
    byId.set(book.id, override ? { ...book, ...normalizeSeedBook(override), origin: book.origin } : book);
  }
  for (const book of userBooks) {
    byId.set(book.id, { ...book, origin: book.origin === 'seed' ? 'user' : book.origin });
  }

  mergedCache = [...byId.values()];
  return mergedCache;
}

function invalidateCache() {
  mergedCache = null;
}

/* ------------------------------------------------------------------ */
/* HTTP 工具                                                           */
/* ------------------------------------------------------------------ */

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
    'access-control-allow-origin': '*',
    'x-content-type-options': 'nosniff',
  });
  res.end(body);
}

function sendError(res, status, message, details = null) {
  sendJSON(res, status, { ok: false, error: message, details });
}

async function readBody(req, limitBytes = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new Error('请求体过大（上限 1MB）');
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('请求体不是合法 JSON');
  }
}

/* ------------------------------------------------------------------ */
/* 服务端反剧透校验                                                    */
/* ------------------------------------------------------------------ */

/**
 * 入库前的安全校验：只有通过校验的数据才会写入知识库。
 * 这是「最高铁律」在服务端的第二道防线。
 */
function validateBookPayload(payload, { strict = true } = {}) {
  const errors = [];
  const warnings = [];

  const id = String(payload?.id ?? '').trim();
  const title = String(payload?.title ?? '').trim();
  if (!id) errors.push('缺少书籍 id');
  if (!/^[a-zA-Z0-9._-]{1,64}$/.test(id)) errors.push('id 只能包含字母、数字、点、下划线、连字符，且不超过 64 字符');
  if (!title) errors.push('缺少书名');

  // 标签合法性校验：诡计/叙事/场景/动机/题材维度
  const rawTags = Array.isArray(payload?.tags) ? payload.tags : [];
  const { valid, unknown } = partitionTags(rawTags);
  if (unknown.length) errors.push(`存在未收录的标签 id：${unknown.join('、')}`);

  // 流派是独立维度，存在 school 字段；同样拒绝未收录的 id，
  // 并拒绝把流派 id 混写进 tags（两个维度混在一起会让统计与编辑回填错位）
  const rawSchool = Array.isArray(payload?.school) ? payload.school : [];
  const schoolPartition = partitionTags(rawSchool);
  if (schoolPartition.unknown.length) {
    errors.push(`存在未收录的流派 id：${schoolPartition.unknown.join('、')}`);
  }
  const schoolInTags = valid.filter(isSchoolTag);
  if (schoolInTags.length) {
    errors.push(`流派 id 必须写在 school 字段而不是 tags 中：${schoolInTags.join('、')}`);
  }
  const nonSchoolInSchool = schoolPartition.valid.filter((id) => !isSchoolTag(id));
  if (nonSchoolInSchool.length) {
    errors.push(`school 字段只能放流派 id，收到了：${nonSchoolInSchool.join('、')}`);
  }

  const summary = String(payload?.safeSummary ?? '');
  const summaryLength = Array.from(summary).length;
  if (!summary) warnings.push('未填写无剧透简介，报告第三部分将显示「信息有限」');
  if (summaryLength > 100) {
    if (strict) errors.push(`无剧透简介为 ${summaryLength} 字，超出需求文档规定的 100 字上限`);
    else warnings.push(`无剧透简介为 ${summaryLength} 字，超出 100 字上限`);
  }

  // 关键：用同一套剧透规则扫描公开字段
  const analysis = analyzeBook({ ...payload, tags: valid });
  const blockers = analysis.issues.filter((i) => i.risk === 'high' || i.risk === 'medium');
  for (const b of blockers) {
    const message = `【${b.fieldLabel ?? b.field}】${b.hint}（命中：${b.match}）`;
    if (strict) errors.push(message);
    else warnings.push(message);
  }

  return { errors, warnings, analysis, tags: valid };
}

/* ------------------------------------------------------------------ */
/* 路由                                                                */
/* ------------------------------------------------------------------ */

async function handleApi(req, res, url) {
  const segments = url.pathname.replace(/^\/api\/?/, '').split('/').filter(Boolean);
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
      'access-control-allow-headers': 'content-type',
      'access-control-max-age': '86400',
    });
    res.end();
    return true;
  }

  // GET /api/health
  if (segments[0] === 'health' && segments.length === 1) {
    const books = await getAllBooks();
    sendJSON(res, 200, {
      ok: true,
      service: 'detective-fiction-trick-tagging',
      version: '1.0.0',
      bookCount: books.length,
      seedCount: seedBooks.length,
      tagCount: TAGS.length,
      mode: 'api',
      uptimeSeconds: Math.round(process.uptime()),
    });
    return true;
  }

  // GET /api/books
  if (segments[0] === 'books' && segments.length === 1 && method === 'GET') {
    const books = await getAllBooks();
    const spoilerFree = books.map((b) => stripVault(b)); // 保险库永不出网
    sendJSON(res, 200, { ok: true, count: spoilerFree.length, books: spoilerFree });
    return true;
  }

  // POST /api/books
  if (segments[0] === 'books' && segments.length === 1 && method === 'POST') {
    const payload = await readBody(req);
    const check = validateBookPayload(payload, { strict: true });
    if (check.errors.length) {
      sendError(res, 422, '数据未通过反剧透安全校验或格式校验', check.errors);
      return true;
    }
    const books = await getAllBooks();
    if (books.some((b) => b.id === payload.id)) {
      sendError(res, 409, `书籍 id「${payload.id}」已存在，请改用 PUT 更新或更换 id`);
      return true;
    }
    const book = normalizeSeedBook({ ...payload, origin: payload.origin ?? 'user' });
    book.createdAt = book.updatedAt = new Date().toISOString();
    await userBooksStore.update((data) => ({ ...(data ?? {}), books: [...(data?.books ?? []), book] }));
    invalidateCache();
    sendJSON(res, 201, { ok: true, book: stripVault(book), warnings: check.warnings });
    return true;
  }

  // GET /api/books/:id
  if (segments[0] === 'books' && segments.length === 2 && method === 'GET') {
    const books = await getAllBooks();
    const book = books.find((b) => b.id === decodeURIComponent(segments[1]));
    if (!book) {
      sendError(res, 404, '未找到该书籍');
      return true;
    }
    sendJSON(res, 200, { ok: true, book: stripVault(book) });
    return true;
  }

  // PUT /api/books/:id
  if (segments[0] === 'books' && segments.length === 2 && method === 'PUT') {
    const id = decodeURIComponent(segments[1]);
    const payload = await readBody(req);
    const check = validateBookPayload({ ...payload, id }, { strict: true });
    if (check.errors.length) {
      sendError(res, 422, '数据未通过反剧透安全校验或格式校验', check.errors);
      return true;
    }

    const books = await getAllBooks();
    if (!books.some((b) => b.id === id)) {
      sendError(res, 404, '未找到该书籍，无法更新');
      return true;
    }

    const book = normalizeSeedBook({ ...payload, id });
    book.updatedAt = new Date().toISOString();

    await userBooksStore.update((data) => {
      const current = data ?? { books: [] };
      const isUserBook = (current.books ?? []).some((b) => b.id === id);
      if (isUserBook) {
        return { ...current, books: current.books.map((b) => (b.id === id ? book : b)) };
      }
      // 对种子条目的修改记录为 override，保持种子文件的可追溯性
      return { ...current, overrides: { ...(current.overrides ?? {}), [id]: book } };
    });
    invalidateCache();
    sendJSON(res, 200, { ok: true, book: stripVault(book), warnings: check.warnings });
    return true;
  }

  // DELETE /api/books/:id
  if (segments[0] === 'books' && segments.length === 2 && method === 'DELETE') {
    const id = decodeURIComponent(segments[1]);
    const books = await getAllBooks();
    if (!books.some((b) => b.id === id)) {
      sendError(res, 404, '未找到该书籍');
      return true;
    }
    await userBooksStore.update((data) => {
      const current = data ?? { books: [] };
      const isUserBook = (current.books ?? []).some((b) => b.id === id);
      if (isUserBook) {
        return { ...current, books: current.books.filter((b) => b.id !== id) };
      }
      return { ...current, deleted: [...new Set([...(current.deleted ?? []), id])] };
    });
    invalidateCache();
    sendJSON(res, 200, { ok: true, deleted: id });
    return true;
  }

  // POST /api/books/:id/restore —— 恢复被删除的种子条目
  if (segments[0] === 'books' && segments.length === 3 && segments[2] === 'restore' && method === 'POST') {
    const id = decodeURIComponent(segments[1]);
    await userBooksStore.update((data) => {
      const current = data ?? { books: [] };
      return { ...current, deleted: (current.deleted ?? []).filter((d) => d !== id) };
    });
    invalidateCache();
    sendJSON(res, 200, { ok: true, restored: id });
    return true;
  }

  // GET /api/tags —— 标签体系 + 语料统计（前端据此做稀有度加权与标签云）
  if (segments[0] === 'tags' && method === 'GET') {
    const books = await getAllBooks();
    const stats = tagCooccurrence(books);
    const statsMap = new Map(stats.map((s) => [s.tag, s.books.length]));
    sendJSON(res, 200, {
      ok: true,
      categories: TAG_CATEGORIES,
      tags: TAGS.map((t) => ({
        id: t.id,
        label: t.label,
        category: t.category,
        spec: t.spec,
        desc: t.desc,
        aliases: t.aliases ?? [],
        bookCount: statsMap.get(t.id) ?? 0,
      })),
      top: stats.slice(0, 30).map((s) => ({ tag: s.tag, label: t_(s.tag), count: s.books.length })),
      totalBooks: books.length,
    });
    return true;
  }

  // POST /api/recommend —— 服务端跑推荐（便于脚本化调用与结果复现）
  if (segments[0] === 'recommend' && method === 'POST') {
    const payload = await readBody(req);
    const books = await getAllBooks();
    const target = books.find((b) => b.id === payload.id) ?? null;
    if (!target) {
      sendError(res, 404, '未找到目标书籍');
      return true;
    }
    const result = recommend(target, books, { limit: payload.limit ?? 3 });
    sendJSON(res, 200, {
      ok: true,
      target: { id: target.id, title: target.title },
      recommendations: result.recommendations.map((r) => ({
        id: r.id,
        title: r.book.title,
        author: r.book.author,
        authors: Array.isArray(r.book.authors) ? r.book.authors : [],
        reason: r.reason,
        percent: r.percent,
        confidence: r.confidence,
        matchedTags: r.detail.matched.map((t) => ({ id: t, label: t_(t), category: tagCategory(t) })),
      })),
    });
    return true;
  }

  // POST /api/check —— 反剧透体检（供脚本/CI 使用）
  if (segments[0] === 'check' && method === 'POST') {
    const payload = await readBody(req);
    const check = validateBookPayload(payload, { strict: false });
    sendJSON(res, 200, {
      ok: true,
      passed: check.errors.length === 0 && check.analysis.passed,
      errors: check.errors,
      warnings: check.warnings,
      report: check.analysis,
    });
    return true;
  }

  // GET /api/stats
  if (segments[0] === 'stats' && method === 'GET') {
    const books = await getAllBooks();
    const stats = tagCooccurrence(books);
    const authors = new Map();
    const genres = new Map();
    for (const b of books) {
      // 按**署名作者列表**计：合著作品要给每位合著者各记一本，
      // 否则作者榜上会出现「马伊·舍瓦尔、佩尔·瓦勒」这样的伪作者，
      // 而两位真正的作者各自都少算一本。
      for (const name of authorListOf(b)) authors.set(name, (authors.get(name) ?? 0) + 1);
      genres.set(b.genre || '未标注', (genres.get(b.genre || '未标注') ?? 0) + 1);
    }
    sendJSON(res, 200, {
      ok: true,
      total: books.length,
      userBooks: books.filter((b) => b.origin === 'user').length,
      tagsInUse: stats.length,
      topTags: stats.slice(0, 12).map((s) => ({ label: t_(s.tag), count: s.books.length })),
      topAuthors: [...authors.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, count]) => ({ name, count })),
      genres: [...genres.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    });
    return true;
  }

  // GET /api/export —— 导出完整知识库（含保险库，仅本机使用）
  if (segments[0] === 'export' && method === 'GET') {
    const books = await getAllBooks();
    const includeVault = url.searchParams.get('vault') === '1';
    sendJSON(res, 200, {
      ok: true,
      format: 'dftr-knowledge-base',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: books.length,
      books: includeVault ? books : books.map((b) => stripVault(b)),
    });
    return true;
  }

  sendError(res, 404, `未找到接口：${method} ${url.pathname}`);
  return true;
}

function t_(id) {
  return tagLabel(id);
}

/* ------------------------------------------------------------------ */
/* 服务器                                                              */
/* ------------------------------------------------------------------ */

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`);

  try {
    // 安全响应头
    res.setHeader('referrer-policy', 'no-referrer');
    res.setHeader('x-frame-options', 'SAMEORIGIN');

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, '仅支持 GET / HEAD（写操作请走 /api/）');
      return;
    }

    // /data/** → 仓库根目录的 data/
    if (url.pathname.startsWith('/data/')) {
      const handled = await serveStatic(req, res, { root: DATA_DIR, urlPath: url.pathname.replace(/^\/data/, '') });
      if (handled) return;
      sendError(res, 404, '文件不存在');
      return;
    }

    // 其余 → web/
    refreshAssetVersionIfChanged();
    const handled = await serveStatic(req, res, { root: WEB_DIR, urlPath: url.pathname, assetVersion: WEB_ASSET_VERSION });
    if (handled) return;
    sendError(res, 404, '页面不存在');
  } catch (error) {
    console.error('[server] 未处理异常：', error);
    if (!res.headersSent) sendError(res, 500, '服务器内部错误');
    else res.end();
  }
});

async function main() {
  seedBooks = await loadSeed();
  await metaStore.update((m) => ({ ...(m ?? {}), version: 1, seededAt: m?.seededAt ?? new Date().toISOString(), seedCount: seedBooks.length }));

  server.listen(PORT, HOST, () => {
    const url = `http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`;
    if (!args.quiet) {
      console.log('');
      console.log('  推理小说诡计标签分析与推荐系统');
      console.log('  ────────────────────────────────────────────');
      console.log(`  ▸ 访问地址   ${url}`);
      console.log(`  ▸ 种子知识库 ${seedBooks.length} 本（data/books/）`);
      console.log(`  ▸ 标签字典   ${TAGS.length} 个标签 / ${TAG_CATEGORIES.length} 个类别`);
      console.log(`  ▸ 用户数据   server/data/books.json`);
      console.log(`  ▸ 反剧透校验 已启用（服务端 + 前端双层）`);
      console.log('');
      console.log('  按 Ctrl+C 停止服务');
      console.log('');
    }
  });

  const shutdown = (signal) => {
    console.log(`\n[server] 收到 ${signal}，正在关闭…`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((error) => {
  console.error('[server] 启动失败：', error);
  process.exit(1);
});
