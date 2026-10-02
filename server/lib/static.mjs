/**
 * 静态文件服务
 * ============
 * 零依赖实现，带路径穿越防护、ETag/Last-Modified 协商缓存与正确 MIME。
 */

import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

export const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

export function contentTypeFor(filePath) {
  return MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * 计算一组文件的资源版本号（基于大小 + 修改时间）。
 *
 * 用途：给 HTML 里的 css/js 引用附加 `?v=xxx`。
 * 本项目前端无构建步骤、文件名不带哈希，若不这样做，用户浏览器可能一直
 * 复用旧缓存的模块（表现为"代码明明改了，页面还是老样子"）。
 * 有了版本号，文件一改 URL 就变，浏览器必然重新拉取——**无需用户强制刷新**。
 *
 * @param {string[]} files 绝对路径列表
 * @returns {string} 短版本号
 */
export function assetVersion(files) {
  const parts = [];
  for (const file of files) {
    try {
      const stat = fsSync.statSync(file);
      parts.push(`${path.basename(file)}:${stat.size}:${Math.floor(stat.mtimeMs)}`);
    } catch {
      /* 文件不存在则忽略 */
    }
  }
  return createHash('sha1').update(parts.join('|')).digest('hex').slice(0, 10);
}

/** 收集 web/js 与 web/css 下所有脚本样式的绝对路径 */
export function collectAssetFiles(webDir) {
  const out = [];
  const walk = (dir) => {
    let entries = [];
    try {
      entries = fsSync.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(js|css)$/.test(entry.name)) out.push(full);
    }
  };
  walk(path.join(webDir, 'js'));
  walk(path.join(webDir, 'css'));
  return out;
}

/**
 * 给 HTML 里的本地 css/js 引用附加版本号。
 * 只处理相对路径，跳过带协议的绝对地址与已有查询串的引用。
 * @param {string} html
 * @param {string} version
 */
export function versionAssets(html, version) {
  if (!version) return html;
  return String(html).replace(
    /(href|src)="((?!https?:|\/\/|data:|#)[^"?]+\.(?:css|js))"/g,
    (_match, attr, url) => `${attr}="${url}?v=${version}"`,
  );
}

/**
 * 给 JS 模块里的**相对 import 说明符**附加版本号。
 *
 * 为什么必须做：HTML 里只有入口 app.js 带 ?v=xxx，而 app.js 内部的
 * `import './ui/dom.js'` 解析出的 URL 是不带查询串的，
 * 于是深层模块（dom.js / analyze.js / core/*.js …）永远不会因为版本变化而更新。
 * 重写说明符后，整条模块图都会随代码变动而变，缓存问题被彻底消除。
 *
 * 覆盖的形态：
 *     import x from './a.js'          import './a.js'
 *     export { y } from './a.js'      import('./a.js')      import ('./a.js')
 * 说明符一律是相对路径（浏览器相对模块 URL 解析），因此只需追加查询串。
 *
 * 实现要点（这几处都是踩过的坑）：
 *   1. 动态 import 的 `import` 后面直接跟 `(`，不是引号，
 *      所以关键词与引号之间必须允许一个可选的左括号。
 *   2. 引号要用捕获组 + 反向引用配平；反向引用写 `\4`（而非写在组内），
 *      否则它会被解释成"再匹配一个 .js"。
 *   3. 说明符字符类里排除 `?`，保证已加版本号的不会被重复追加。
 *
 * @param {string} source
 * @param {string} version
 */
export function versionModuleImports(source, version) {
  if (!version) return source;
  return String(source).replace(
    /\b(import|from)(\s*)(\(?)(['"])(\.{1,2}\/[^'"?]+\.js)\4/g,
    (_match, keyword, spacing, paren, quote, specifier) =>
      `${keyword}${spacing}${paren}${quote}${specifier}?v=${version}${quote}`,
  );
}

/** 解析并校验请求路径，阻止 ../ 穿越 */
export function resolveSafe(rootDir, urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const normalized = path.normalize(decoded).replace(/^([/\\])+/, '');
  const full = path.resolve(rootDir, normalized);
  const root = path.resolve(rootDir);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  return full;
}

/** 计算 ETag */
export function etagFor(stat) {
  return `W/"${stat.size.toString(16)}-${Math.floor(stat.mtimeMs).toString(16)}"`;
}

/** 计算内容哈希（用于强校验） */
export function contentHash(buffer) {
  return `"${createHash('sha1').update(buffer).digest('hex').slice(0, 16)}"`;
}

/**
 * 提供静态文件。返回 true 表示已处理响应。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ root: string, urlPath: string, spaFallback?: string }} options
 */
export async function serveStatic(req, res, options) {
  const { root, urlPath, spaFallback = 'index.html' } = options;
  const target = resolveSafe(root, urlPath);
  if (!target) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('400 非法路径');
    return true;
  }

  let filePath = target;
  let stat;
  try {
    stat = await fs.stat(filePath);
    if (stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      stat = await fs.stat(filePath);
    }
  } catch {
    // 未找到：SPA 回退到入口 HTML（仅对无扩展名的导航请求生效）
    const hasExtension = path.extname(filePath) !== '';
    if (hasExtension) return false;
    const fallback = path.join(root, spaFallback);
    try {
      stat = await fs.stat(fallback);
      filePath = fallback;
    } catch {
      return false;
    }
  }

  const etag = etagFor(stat);
  const inm = req.headers['if-none-match'];
  if (inm && inm === etag) {
    res.writeHead(304, { etag });
    res.end();
    return true;
  }

  const ext = path.extname(filePath).toLowerCase();
  const immutable = /[.-][0-9a-f]{8,}\./i.test(path.basename(filePath));

  /**
   * HTML 入口需要做资源版本注入（把 css/js 引用改写成带 ?v=xxx 的形式）；
   * JS 模块需要给内部的相对 import 也加上同一个版本号，否则深层模块不会更新。
   * 注意先改内容再算长度与 ETag，否则 304 会与实际内容不一致。
   */
  let body = null;
  let etagValue = etag;
  const version = typeof options.assetVersion === 'string' ? options.assetVersion : '';

  if (version && (ext === '.html' || ext === '.htm')) {
    const source = await fs.readFile(filePath, 'utf8');
    body = versionAssets(source, version);
  } else if (version && ext === '.js') {
    const source = await fs.readFile(filePath, 'utf8');
    const rewritten = versionModuleImports(source, version);
    // 没有相对 import 的文件（如纯工具模块）不必重写，省一次内存拷贝
    if (rewritten !== source) body = rewritten;
  }

  if (body !== null) {
    etagValue = contentHash(body);
    if (inm && inm === etagValue) {
      res.writeHead(304, { etag: etagValue });
      res.end();
      return true;
    }
  }

  /**
   * 缓存策略。
   *
   * 本项目的前端**没有构建步骤**：ES Module 与 CSS 的文件名里不带内容哈希，
   * 改一次代码文件名也不会变。因此绝不能给它们设置 max-age —— 否则用户会
   * 在缓存过期前一直运行旧代码，表现为"明明修好了却还是老样子"（真实踩过的坑）。
   *
   * 正确做法是 `no-cache`（注意不是 no-store）：浏览器仍会缓存，但每次都会带
   * If-None-Match 回来校验，未变更时服务端返回 304，既省流量又能立即生效。
   * 只有文件名里确实带内容哈希的资源才使用长缓存。
   *
   * **封面图是例外**（第 173 轮）：`web/covers/<作品 id>.webp` 这种名字是稳定的，
   * 一天之内不会变；给它们 1 天缓存能省掉「每张图每次翻页都回源校验」的那一串请求
   * （一页 48 张卡就是 48 次往返）。真换了封面，最多一天后自然更新。
   */
  const isCover = /[\\/]covers[\\/]/i.test(filePath) && /\.(webp|jpe?g|png|svg)$/i.test(ext);
  const cacheControl = immutable
    ? 'public, max-age=31536000, immutable'
    : isCover
      ? 'public, max-age=86400'
      : 'no-cache';

  res.writeHead(200, {
    'content-type': contentTypeFor(filePath),
    'content-length': body === null ? stat.size : Buffer.byteLength(body),
    etag: etagValue,
    // 不发送 last-modified：仅凭 If-None-Match 校验即可，
    // 避免某些浏览器用启发式规则绕过 ETag 直接命中本地缓存。
    'cache-control': cacheControl,
    'x-content-type-options': 'nosniff',
  });

  if (req.method === 'HEAD') {
    res.end();
    return true;
  }

  // HTML 已在上面读入并改写，直接写出
  if (body !== null) {
    res.end(body);
    return true;
  }

  await new Promise((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('end', resolve);
    stream.pipe(res);
  }).catch(() => {
    if (!res.headersSent) res.writeHead(500);
    res.end();
  });

  return true;
}
