/**
 * 知识库存储层
 * ============
 * 双模式自动降级：
 *   1) API 模式   —— 检测到后端可用（node server/index.mjs）时，书籍持久化到服务器，
 *                    所有访问者共享同一份知识库，适合部署到域名。
 *   2) 本地模式   —— 纯静态托管（GitHub Pages / OSS 等）时，书籍只保存在浏览器 localStorage，
 *                    开箱即用，无需任何服务端。
 *
 * 用户自建条目（origin = 'user'）永远标记来源，默认不参与相似作品推荐，
 * 避免个人录入的数据污染公共推荐结果。
 */

import { loadSeedBooks, normalizeSeedBook } from './seed.js';

const LOCAL_KEY = 'dftr:userBooks:v1';
const HIDDEN_KEY = 'dftr:hiddenBooks:v1';

/**
 * 搜索「去掉分隔符」回退时要去掉的字符。
 * 覆盖外国作者名里的间隔号（·・.）、各类空格与中英标点——
 * 它们是读者最容易打错、也最不影响语义的部分。
 */
const LOOSE_STRIP = /[\s\u00a0·・．.。、,，:：;；!！?？'"“”‘’\-—–_~()（）[\]【】{}<>《》/\\|]/g;

/* ------------------------------------------------------------------ */
/* localStorage 安全封装（隐私模式 / 禁用存储时不报错）                  */
/* ------------------------------------------------------------------ */

const memoryFallback = new Map();

const safeStorage = {
  get(key) {
    try {
      return globalThis.localStorage?.getItem(key) ?? memoryFallback.get(key) ?? null;
    } catch {
      return memoryFallback.get(key) ?? null;
    }
  },
  set(key, value) {
    memoryFallback.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(key) {
    memoryFallback.delete(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

function readJSON(key, fallback) {
  const raw = safeStorage.get(key);
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                              */
/* ------------------------------------------------------------------ */

export class BookStore {
  constructor(options = {}) {
    /**
     * API 基地址。
     *
     * 注意：静态部署时前端可能位于子路径（例如 GitHub Pages 的 /repo/），
     * 而 /data/** 是由仓库根目录提供的。因此这里按当前页面路径推导前缀，
     * 而不是硬编码 '/api'——否则子路径部署会探测失败并静默降级为本地模式。
     * 也可以显式传入 apiBase 覆盖。
     */
    this.apiBase = options.apiBase ?? deriveApiBase();
    this.mode = 'local'; // 'api' | 'local'
    this.serverAvailable = false;
    this.books = [];
    this.lastError = null;
    this.lastSyncedAt = null;
    this.listeners = new Set();
  }

  /* ---------------- 事件 ---------------- */

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event = 'change') {
    for (const listener of this.listeners) {
      try {
        listener(event, this);
      } catch (error) {
        console.error('[store] listener error', error);
      }
    }
  }

  /* ---------------- 初始化 ---------------- */

  async init() {
    const available = await this.probeApi();
    if (available) {
      this.mode = 'api';
      this.serverAvailable = true;
      try {
        const data = await this.apiGet('/books');
        this.books = this.mergeLocalDrafts((data.books ?? []).map((b) => normalizeSeedBook(b)));
        this.lastSyncedAt = new Date().toISOString();
        this.emit('ready');
        return this;
      } catch (error) {
        this.lastError = error;
        console.warn('[store] API 读取失败，回退到本地模式', error);
        this.serverAvailable = false;
      }
    }

    this.mode = 'local';
    this.books = this.mergeLocalDrafts(loadSeedBooks());
    this.lastSyncedAt = new Date().toISOString();
    this.emit('ready');
    return this;
  }

  /** 探测后端是否可用 */
  async probeApi() {
    if (typeof fetch !== 'function') return false;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 1800);
      const res = await fetch(`${this.apiBase}/health`, { signal: controller.signal, headers: { accept: 'application/json' } });
      clearTimeout(timer);
      if (!res.ok) return false;
      const data = await res.json();
      return data?.ok === true;
    } catch {
      return false;
    }
  }

  /** 合成最终书籍列表：服务器/种子数据 + 本地用户条目 + 本地覆盖 - 隐藏项 */
  mergeLocalDrafts(baseBooks) {
    const userBooks = readJSON(LOCAL_KEY, []);
    const overrides = readJSON(`${LOCAL_KEY}:overrides`, {});
    const hidden = new Set(readJSON(HIDDEN_KEY, []));

    const byId = new Map();
    for (const book of baseBooks) {
      if (hidden.has(book.id)) continue;
      const override = overrides[book.id];
      byId.set(book.id, override ? { ...book, ...override, origin: book.origin ?? 'seed', editedLocally: true } : book);
    }
    for (const raw of userBooks) {
      const book = normalizeSeedBook(raw, '我的条目', 'local');
      if (!book) continue;
      book.origin = 'user';
      byId.set(book.id, book);
    }

    return [...byId.values()].sort(sortBooks);
  }

  /* ---------------- 查询 ---------------- */

  all() {
    return this.books;
  }

  get(id) {
    return this.books.find((b) => b.id === id) ?? null;
  }

  /**
   * 关键词搜索（书名 / 又名 / 作者 / 系列 / 流派 / 梗概 / 标签中文名）
   *
   * 匹配分两轮：**先原样子串，再「去掉分隔符」比对**。
   * 加第二轮是因为外国作者名的分隔符读者很难打对——「佩尔·瓦勒」的间隔号
   * 必须切到中文标点或长按才能输入，实际更常见的是打成「佩尔瓦勒」或
   * 「佩尔 瓦勒」。只做原样子串的话，这两种写法都搜不到书，
   * 而读者只会以为「库里没有这本书」。
   */
  search(keyword, tagLabelsIndex = null) {
    const q = String(keyword ?? '').trim().toLowerCase();
    if (!q) return this.books;
    const loose = (s) => String(s).replace(LOOSE_STRIP, '');
    const qLoose = loose(q);
    return this.books.filter((book) => {
      const haystack = [
        book.title,
        // 又名：同一部作品的不同译名（大陆版/台版，如《球形的荒野》与
        // 《一个背叛日本的日本人》）。合并重复条目时保留了落选那一版的书名，
        // 只有把它纳入搜索，用旧译名来查的读者才找得到这本书。
        ...(Array.isArray(book.alternateTitles) ? book.alternateTitles : []),
        book.originalTitle,
        book.author,
        // 合著/合集的**其余**署名作者：只用 author 作检索词的话，
        // 用「佩尔·瓦勒」查《失踪的消防车》会查不到（author 只写了一个标签）。
        ...(Array.isArray(book.authors) ? book.authors : []),
        book.authorEn,
        book.series,
        book.detective,
        book.genre,
        book.country,
        book.firstPublished,
        book.safeSummary,
        tagLabelsIndex ? tagLabelsIndex(book.tags ?? []).join(' ') : (book.tags ?? []).join(' '),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      if (haystack.includes(q)) return true;
      // 分隔符不敏感的回退（「佩尔瓦勒」「佩尔 瓦勒」同样命中）
      return qLoose.length > 0 && loose(haystack).includes(qLoose);
    });
  }

  /* ---------------- 写入 ---------------- */

  async save(book) {
    const normalized = normalizeSeedBook(book);
    if (!normalized) throw new Error('书籍数据不完整：缺少 id 或书名');
    normalized.updatedAt = new Date().toISOString();

    const exists = this.books.some((b) => b.id === normalized.id);
    if (!exists) normalized.createdAt = normalized.createdAt ?? normalized.updatedAt;

    if (this.serverAvailable) {
      try {
        const result = await this.apiSend(exists ? 'PUT' : 'POST', exists ? `/books/${encodeURIComponent(normalized.id)}` : '/books', normalized);
        const saved = normalizeSeedBook(result.book ?? normalized);
        this.upsertLocal(saved);
        this.emit('change');
        return saved;
      } catch (error) {
        this.lastError = error;
        console.warn('[store] 服务器写入失败，改存本地', error);
        this.serverAvailable = false;
        this.mode = 'local';
      }
    }

    this.saveLocal(normalized, exists);
    this.emit('change');
    return normalized;
  }

  saveLocal(book, exists) {
    const userBooks = readJSON(LOCAL_KEY, []);
    const index = userBooks.findIndex((b) => b.id === book.id);
    const isUserBook = book.origin === 'user' || index !== -1;

    if (isUserBook) {
      if (index === -1) userBooks.push(book);
      else userBooks[index] = book;
      safeStorage.set(LOCAL_KEY, JSON.stringify(userBooks));
    } else {
      // 对种子数据的本地覆盖（静态部署时"修正"内置条目）
      const overrides = readJSON(`${LOCAL_KEY}:overrides`, {});
      overrides[book.id] = book;
      safeStorage.set(`${LOCAL_KEY}:overrides`, JSON.stringify(overrides));
    }
    this.upsertLocal(book);
  }

  upsertLocal(book) {
    const index = this.books.findIndex((b) => b.id === book.id);
    if (index === -1) this.books = [...this.books, book].sort(sortBooks);
    else this.books = this.books.map((b) => (b.id === book.id ? book : b)).sort(sortBooks);
  }

  async remove(id) {
    if (this.serverAvailable) {
      try {
        await this.apiSend('DELETE', `/books/${encodeURIComponent(id)}`);
        this.books = this.books.filter((b) => b.id !== id);
        this.emit('change');
        return true;
      } catch (error) {
        this.lastError = error;
        console.warn('[store] 服务器删除失败，改为本地隐藏', error);
        this.serverAvailable = false;
        this.mode = 'local';
      }
    }

    const userBooks = readJSON(LOCAL_KEY, []).filter((b) => b.id !== id);
    safeStorage.set(LOCAL_KEY, JSON.stringify(userBooks));
    const overrides = readJSON(`${LOCAL_KEY}:overrides`, {});
    delete overrides[id];
    safeStorage.set(`${LOCAL_KEY}:overrides`, JSON.stringify(overrides));
    const hidden = new Set(readJSON(HIDDEN_KEY, []));
    hidden.add(id);
    safeStorage.set(HIDDEN_KEY, JSON.stringify([...hidden]));
    this.books = this.books.filter((b) => b.id !== id);
    this.emit('change');
    return true;
  }

  /** 生成不冲突的 id */
  nextId(prefix = 'user') {
    let n = 1;
    const ids = new Set(this.books.map((b) => b.id));
    while (ids.has(`${prefix}-${String(n).padStart(3, '0')}`)) n += 1;
    return `${prefix}-${String(n).padStart(3, '0')}`;
  }

  /* ---------------- 导入 / 导出 ---------------- */

  exportUserBooks() {
    const userBooks = this.books.filter((b) => b.origin === 'user');
    return {
      format: 'dftr-knowledge-base',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: userBooks.length,
      books: userBooks,
    };
  }

  exportAll() {
    return {
      format: 'dftr-knowledge-base-full',
      version: 1,
      exportedAt: new Date().toISOString(),
      count: this.books.length,
      books: this.books,
    };
  }

  /**
   * 导入知识库。
   * @param {string|object} payload JSON 字符串或对象
   * @param {{ merge?: 'skip'|'overwrite' }} [options]
   */
  async importBooks(payload, options = {}) {
    const { merge = 'skip' } = options;
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    const list = Array.isArray(data) ? data : (data?.books ?? []);
    if (!Array.isArray(list) || !list.length) throw new Error('导入内容为空或格式不正确');

    const report = { added: 0, updated: 0, skipped: 0, failed: [] };

    for (const raw of list) {
      try {
        const book = normalizeSeedBook(raw, raw.group ?? '导入', 'import');
        if (!book) {
          report.failed.push({ title: raw?.title ?? '(无书名)', reason: '缺少 id 或书名' });
          continue;
        }
        book.origin = book.origin === 'user' ? 'user' : 'imported';
        const exists = this.books.some((b) => b.id === book.id);
        if (exists && merge === 'skip') {
          report.skipped += 1;
          continue;
        }
        await this.save(book);
        if (exists) report.updated += 1;
        else report.added += 1;
      } catch (error) {
        report.failed.push({ title: raw?.title ?? '(无书名)', reason: String(error.message ?? error) });
      }
    }

    this.emit('change');
    return report;
  }

  /** 重置本地数据（清空用户录入与覆盖） */
  resetLocal() {
    safeStorage.remove(LOCAL_KEY);
    safeStorage.remove(`${LOCAL_KEY}:overrides`);
    safeStorage.remove(HIDDEN_KEY);
    this.books = loadSeedBooks().sort(sortBooks);
    this.emit('change');
  }

  /* ---------------- HTTP 封装 ---------------- */

  async apiGet(path) {
    const res = await fetch(`${this.apiBase}${path}`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new Error(`GET ${path} 失败：HTTP ${res.status}`);
    return res.json();
  }

  async apiSend(method, path, body) {
    const res = await fetch(`${this.apiBase}${path}`, {
      method,
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error ?? `${method} ${path} 失败：HTTP ${res.status}`);
    return data;
  }

  /** 重新从数据源加载 */
  async reload() {
    return this.init();
  }

  /** 状态描述，用于界面角标 */
  status() {
    return {
      mode: this.mode,
      serverAvailable: this.serverAvailable,
      total: this.books.length,
      userBooks: this.books.filter((b) => b.origin === 'user').length,
      lastSyncedAt: this.lastSyncedAt,
      lastError: this.lastError ? String(this.lastError.message ?? this.lastError) : null,
    };
  }
}

/**
 * 排序用的年份：**优先取作品首次出版年 `firstPublished`，缺失时退回所引版本的 `editionYear`**。
 *
 * 为什么要退回：拆字段之后，绝大多数中译本的原作年一时查不到（豆瓣 403、馆藏拒连），
 * `firstPublished` 会留空。若此时直接把它们一律排到末尾，
 * 「按年代排序」反而比拆字段之前更差。退回版本年只是**排序用**的近似——
 * 展示时两者分栏显示，不会把版本年冒充成首次出版年。
 */
export function sortYear(book) {
  const pick = (v) => String(v ?? '').match(/\d{4}/)?.[0] ?? '';
  const y = pick(book?.firstPublished) || pick(book?.editionYear);
  return y ? parseInt(y, 10) : 9999;
}

/** 排序：按首次出版年份升序（缺失时用版本年近似），再按书名 */
export function sortBooks(a, b) {
  const ya = sortYear(a);
  const yb = sortYear(b);
  if (ya !== yb) return ya - yb;
  return String(a.title).localeCompare(String(b.title), 'zh-Hans-CN');
}

/**
 * 推导 API 基地址。
 * 页面位于 /web/index.html 或 /repo/index.html 时，后端挂在同级的 /api 上。
 */
export function deriveApiBase() {
  try {
    const { pathname, protocol } = globalThis.location ?? {};
    if (protocol === 'file:') return '/api'; // file:// 下不存在后端，探测必然失败
    const dir = pathname.replace(/[^/]*$/, ''); // 去掉文件名，保留目录
    return `${dir}api`.replace(/\/{2,}/g, '/');
  } catch {
    return '/api';
  }
}

export const store = new BookStore();
