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
import { gzipSync } from 'node:zlib';
// `node:fs` 的同步侧：**`fs.watch` 只在回调式 fs 上有，promises 版没有**——
// 第 147 轮第一次写热加载时就是用 `fs.watch`（= `fs.promises.watch`，不存在）触发了 TypeError，
// 被兜底 catch 吞掉，表现为「监听没生效但也不报错」。测试当场抓到了这一点。
import { watch as watchDir } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { JsonStore } from './lib/json-store.mjs';
import { assetVersion, collectAssetFiles, serveStatic } from './lib/static.mjs';
import { corsHeaders, isAllowedOrigin, originOf, parseAllowedOrigins, securityHeaders } from './lib/headers.mjs';
import { redactedSeedBuffer } from './lib/public-seed.mjs';

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
  const args = { port: null, host: null, quiet: false, cors: '' };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--port' || arg === '-p') args.port = Number(argv[++i]);
    else if (arg === '--host' || arg === '-h') args.host = argv[++i];
    else if (arg === '--quiet') args.quiet = true;
    else if (arg === '--cors') args.cors = String(argv[++i] ?? '');
  }
  return args;
}

const args = parseArgs(process.argv.slice(2));
const PORT = args.port ?? Number(process.env.PORT ?? 8787);
const HOST = args.host ?? process.env.HOST ?? '127.0.0.1';

/**
 * 允许跨源访问 API 的来源白名单（默认**空** = 只允许同源）。
 *
 * 第 193 轮收紧：原先一律回 `access-control-allow-origin: *`，而接口没有鉴权，
 * 等于「任何网站都能从访客浏览器往这台服务写数据」。同源使用根本不需要 CORS 头，
 * 所以默认一个都不发；真要前后端分端口部署，用 `--cors http://localhost:3000`
 * 或环境变量 `DSH_CORS_ORIGINS` 显式放行。
 */
const ALLOWED_ORIGINS = parseAllowedOrigins(process.argv.slice(2), process.env);

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

/** 读一个批次文件，解析失败时重试——外部脚本是「整体覆盖」写法，中间有一段半截文件窗口 */
const SEED_READ_ATTEMPTS = 4;
const SEED_READ_BACKOFF = 120; // 毫秒；4 次合计最多等约 0.4 秒

async function readSeedFile(file) {
  const full = path.join(BOOKS_DIR, file);
  let lastError = null;
  for (let attempt = 1; attempt <= SEED_READ_ATTEMPTS; attempt += 1) {
    try {
      return { list: JSON.parse(await fs.readFile(full, 'utf8')) };
    } catch (error) {
      lastError = error;
      // 采集脚本删/改名中间文件时会撞上 ENOENT：这不是故障，当它不存在即可，重试没有意义
      if (error.code === 'ENOENT') return { list: null, gone: true };
      if (attempt < SEED_READ_ATTEMPTS) await new Promise((r) => setTimeout(r, SEED_READ_BACKOFF));
    }
  }
  return { list: null, error: lastError };
}

/** 读取 data/books/*.json 得到种子知识库（外加读不出来的文件清单） */
async function loadSeed() {
  const books = [];
  const unreadable = [];
  let files = [];
  try {
    files = (await fs.readdir(BOOKS_DIR)).filter((f) => f.endsWith('.json')).sort();
  } catch {
    return { books, unreadable };
  }

  for (const file of files) {
    const { list, gone, error } = await readSeedFile(file);
    if (gone) continue;
    if (error) {
      // 重试完还是坏文件：**必须报出来**。以前这里只打一行 warn 就 continue，
      // 结果 `apply-ratings --apply` 覆盖 20 个文件时，服务端正好读到半截 JSON，
      // 整文件被跳过，页面上的总数凭空少了 3 本（日志里 3428 → 3425），
      // 看起来像「书丢了」却查不出原因（第 178 轮）。
      unreadable.push({ file, error: error.message });
      console.warn(`[seed] 读取 ${file} 失败（已重试 ${SEED_READ_ATTEMPTS} 次）：${error.message}`);
      continue;
    }
    if (!Array.isArray(list)) {
      console.warn(`[seed] ${file} 不是数组，已跳过`);
      unreadable.push({ file, error: '不是数组' });
      continue;
    }
    for (const item of list) {
      const book = normalizeSeedBook(item, null, file);
      if (!book) continue;
      book.origin = 'seed';
      books.push(book);
    }
  }

  // 知识库可能被拆分到多个文件，按 id 去重（保留先出现的）
  const byId = new Map();
  for (const book of books) if (!byId.has(book.id)) byId.set(book.id, book);
  return { books: [...byId.values()], unreadable };
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
  /** 全量响应体（含其 gzip 结果）也一并作废：数据变了就不能再端出旧的那一份 */
  booksPayloadCache = null;
}

/**
 * `/api/books` 的响应体缓存（第 173 轮）。
 *
 * 全量 3429 部的 JSON 有 7.5 MB：每次请求都重新 `stripVault` + `stringify` 是白烧 CPU，
 * 而这份数据**只在知识库重载时才变**（`invalidateCache()` 已经覆盖了添加/编辑/删除/热加载）。
 */
let booksPayloadCache = null;

/* ------------------------------------------------------------------ */
/* 种子知识库的热加载（第 147 轮）                                     */
/* ------------------------------------------------------------------ */
/**
 * 起因：`seedBooks` 只在启动时读一次，而**整理知识库是「往 `data/books/` 里添批次文件」**——
 * 外部加书服务器察觉不到。于是出现过这样的事：数据已经 3243 部，
 * 页面上还是 2954 部，**看起来像丢了 289 本书**（其实是服务端拿着启动时的快照）。
 *
 * 现在两条路都能刷新：
 *   ① **自动**：`fs.watch(BOOKS_DIR)` 监听数据目录，文件一变（含改名、删除）就重读，
 *      带 300ms 防抖（一次 `git checkout` 会触发很多事件，不防抖会连读十几次）；
 *   ② **手动**：`POST /api/reload`，返回条数与文件数，便于脚本与测试核对。
 *
 * 重读是**整体替换** `seedBooks` 再清缓存，不做增量合并——批次文件之间可能互相改名、
 * 合并（`merge-dups`）甚至删除，增量合并会留下幽灵条目。
 */
let seedMeta = { loadedAt: null, files: 0, books: 0, unreadable: [] };
let reloading = null;

async function reloadSeed({ reason = 'manual' } = {}) {
  if (reloading) return reloading;
  reloading = (async () => {
    const { books, unreadable } = await loadSeed();
    seedBooks = books;
    invalidateCache();
    const files = (await fs.readdir(BOOKS_DIR).catch(() => [])).filter((f) => f.endsWith('.json')).length;
    seedMeta = { loadedAt: new Date().toISOString(), files, books: books.length, unreadable };
    console.log(`[seed] 重新载入（${reason}）：${books.length} 部 / ${files} 个文件`);
    if (unreadable.length) {
      console.warn(`[seed] 其中 ${unreadable.length} 个文件读不出来，本次少了它们的条目：${unreadable.map((u) => u.file).join('、')}`);
    }
    return seedMeta;
  })();
  try {
    return await reloading;
  } finally {
    reloading = null;
  }
}

function startSeedWatcher() {
  let timer = null;
  const schedule = (eventType, filename) => {
    if (filename && !String(filename).endsWith('.json')) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      reloadSeed({ reason: `watch:${eventType} ${filename ?? ''}`.trim() }).catch((error) =>
        console.warn(`[seed] 自动重载失败：${error.message}`),
      );
    }, 300);
  };
  try {
    watchDir(BOOKS_DIR, schedule);
    console.log(`[seed] 已监听 ${BOOKS_DIR}（数据目录变动会自动重载）`);
  } catch (error) {
    console.warn(`[seed] 无法监听数据目录（${error.message}）——仍可用 POST /api/reload 手动刷新`);
  }
}

/* ------------------------------------------------------------------ */
/* HTTP 工具                                                           */
/* ------------------------------------------------------------------ */

/**
 * 统一的响应出口：**压缩 + 去掉缩进 + 允许缓存复用**（第 173 轮）。
 *
 * 起因是部署时的一个真问题：`/api/books` 全量 3429 部、**11.5 MB**、单次要 3.9 秒——
 * 那是「每个访客每次打开页面都要重下一遍」的量级。三处都不改功能，纯省：
 *   1. `JSON.stringify(payload, null, 2)` 的**两空格缩进**白占约三成体积 → 改成紧凑输出；
 *   2. 客户端支持 gzip 时压一遍（JSON 重复度高，实测 11.5MB → 1MB 上下）；
 *   3. 全量响应的**压缩结果缓存**起来（数据一变就作废），不必每次重压。
 */
const gzipCache = new WeakMap();

function sendBuffer(res, status, buf, req, type = 'application/json; charset=utf-8') {
  const headers = {
    ...securityHeaders(req),
    ...corsHeaders(req, ALLOWED_ORIGINS),
    'content-type': type,
    'cache-control': 'no-store',
  };
  let body = buf;
  const accept = String(req?.headers?.['accept-encoding'] ?? '');
  if (/\bgzip\b/i.test(accept) && buf.length >= 1024) {
    let gz = gzipCache.get(buf);
    if (!gz) {
      gz = gzipSync(buf);
      gzipCache.set(buf, gz);
    }
    body = gz;
    headers['content-encoding'] = 'gzip';
    headers.vary = 'accept-encoding';
  }
  headers['content-length'] = body.length;
  res.writeHead(status, headers);
  res.end(body);
}

function sendJSON(res, status, payload, req = null) {
  // 紧凑输出：同样的数据，去掉缩进后小约三成（前端本来也不读带缩进的 JSON）
  sendBuffer(res, status, Buffer.from(JSON.stringify(payload), 'utf8'), req);
}

function sendError(res, status, message, details = null, req = null) {
  sendJSON(res, status, { ok: false, error: message, details }, req);
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
    // 预检只对**白名单来源**回 CORS 头（默认白名单是空的：同源请求不需要预检）
    res.writeHead(204, { ...securityHeaders(req), ...corsHeaders(req, ALLOWED_ORIGINS) });
    res.end();
    return true;
  }

  /**
   * CSRF 防线（第 193 轮）：状态变更请求若带了 `Origin`/`Referer` 且不是同源，一律 403。
   *
   * 为什么 CORS 不够：CORS 只限制「读响应」，`<form>` 或 `fetch(…, {mode:'no-cors'})`
   * 照样能把 POST 打到本机服务上（接口没有鉴权，写进去就是真写进去）。
   * 而浏览器发跨源写请求**一定带 Origin**，命令行工具通常不带——所以按这条判据拦，
   * 既挡住了「别的网站借用访客浏览器」，又不影响 curl／脚本。
   */
  if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
    const origin = originOf(req);
    if (origin && !isAllowedOrigin(origin, req, ALLOWED_ORIGINS)) {
      sendError(res, 403, `跨源写请求被拒绝（来源 ${origin}）`, null, req);
      return true;
    }
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
      // 读不出来的批次文件（截断 / 语法错）——正常必须是空数组：
      // 有条目就意味着本次总数偏低，调用方一眼能看出「少书」不是数据被删了（第 178 轮）
      unreadableFiles: (seedMeta.unreadable ?? []).map((u) => u.file),
      uptimeSeconds: Math.round(process.uptime()),
    });
    return true;
  }

  // POST /api/reload —— 手动重读 data/books（第 147 轮加）
  // 用途：整理知识库时往数据目录添批次文件，不想等 watch 或想立刻确认时调一次。
  if (segments[0] === 'reload' && segments.length === 1 && method === 'POST') {
    const meta = await reloadSeed({ reason: 'POST /api/reload' });
    const books = await getAllBooks({ fresh: true });
    sendJSON(res, 200, {
      ok: true,
      seedCount: meta.books,
      bookCount: books.length,
      files: meta.files,
      loadedAt: meta.loadedAt,
      unreadable: meta.unreadable ?? [],
    });
    return true;
  }

  // GET /api/books
  if (segments[0] === 'books' && segments.length === 1 && method === 'GET') {
    if (!booksPayloadCache) {
      const books = await getAllBooks();
      const spoilerFree = books.map((b) => stripVault(b)); // 保险库永不出网
      booksPayloadCache = Buffer.from(JSON.stringify({ ok: true, count: spoilerFree.length, books: spoilerFree }), 'utf8');
    }
    sendBuffer(res, 200, booksPayloadCache, req);
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
    /**
     * 安全响应头（第 193 轮集中到 `lib/headers.mjs`）。
     * 在这里统一 `setHeader`：后面的 `writeHead(…)` 只会**覆盖同名字段**，
     * 所以静态文件、JSON 接口、301 跳转、304 全都会带上这一套（CSP、nosniff、
     * Referrer-Policy、Permissions-Policy、HTTPS 下的 HSTS）。
     */
    for (const [key, value] of Object.entries(securityHeaders(req))) res.setHeader(key, value);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendError(res, 405, '仅支持 GET / HEAD（写操作请走 /api/）');
      return;
    }

    /**
     * `/data/**` → 仓库根目录的 `data/`。**两种版本、按路径分**（第 192 → 194 轮）：
     *
     *   · `data/books/*.json` —— **去掉 vault 再发**。前端 `seed-files.js` 是 243 条静态 import，
     *     这些文件 404 的话整个应用起不来（页面永远停在「加载中…」，第 194 轮踩过）；
     *     但原文里躺着 3420 条谜底，所以**同一份文件、剥掉 vault 后发**。
     *     前端从不使用 vault（所有出口都 stripVault），去掉它界面毫无变化。
     *   · `/covers-editions.json`、`/manifest.json` —— 派生数据，原样发（本来就不含谜底）。
     *   · 其余（covers.json 台账、merge-pairs、ratings-* 之类）—— 404，它们只归维护者。
     */
    if (url.pathname.startsWith('/data/')) {
      const rel = url.pathname.replace(/^\/data/, '');
      const PUBLIC_DATA = new Set(['/covers-editions.json', '/manifest.json']);

      if (/^\/books\/[^/]+\.json$/.test(rel)) {
        const file = path.join(DATA_DIR, decodeURIComponent(rel));
        if (!file.startsWith(path.join(DATA_DIR, 'books'))) {
          sendError(res, 404, '文件不存在', null, req);
          return;
        }
        const body = redactedSeedBuffer(file);
        if (!body) {
          sendError(res, 404, '文件不存在', null, req);
          return;
        }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-cache',
          'content-length': body.length,
          // 与源文件不完全一致（去了 vault），别让缓存把它当同一份
          vary: 'accept-encoding',
        });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      if (!PUBLIC_DATA.has(rel)) {
        sendError(res, 404, '文件不存在', null, req);
        return;
      }
      const handled = await serveStatic(req, res, { root: DATA_DIR, urlPath: rel });
      if (handled) return;
      sendError(res, 404, '文件不存在', null, req);
      return;
    }

    // 其余 → web/
    refreshAssetVersionIfChanged();

    /**
     * `/web/...` 一律 301 到 `/...`（第 174 轮修的一个真坑）。
     *
     * 两种部署方式的入口路径**不一样**：
     *   · **纯静态托管**（GitHub Pages / Netlify）：docroot 是仓库根，入口是 `/web/`；
     *   · **带后端**（本服务）：`web/` 就是站点根，入口是 `/`。
     * 而 README 与部署文档里写的是纯静态那套地址，于是照抄 `/web/` 的人会看到
     * **一个能打开的 HTML、但 CSS/JS/封面全 404 的破页**（`/web/css/styles.css` 找不到）——
     * 明明服务是好的，看起来却像坏了。与其让人踩，不如直接跳到根路径。
     */
    if (url.pathname === '/web' || url.pathname.startsWith('/web/')) {
      const target = url.pathname.replace(/^\/web/, '') || '/';
      res.writeHead(301, { location: `${target}${url.search ?? ''}` });
      res.end();
      return;
    }

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
  const loaded = await loadSeed();
  seedBooks = loaded.books;
  seedMeta = { loadedAt: new Date().toISOString(), files: 0, books: seedBooks.length, unreadable: loaded.unreadable };
  if (loaded.unreadable.length) {
    console.warn(`[seed] 启动时有 ${loaded.unreadable.length} 个文件读不出来：${loaded.unreadable.map((u) => u.file).join('、')}`);
  }
  // 数据目录热加载：整理知识库时往 data/books/ 添批次文件，服务端会自动重读（第 147 轮）
  startSeedWatcher();
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
