/**
 * 把种子数据「去谜底」后发给浏览器（第 194 轮）
 * ==========================================
 * 事情是这样：第 192 轮的安全修补把 `/data/**` 收成白名单，理由是
 * `data/books/*.json` 里躺着 3420 条谜底保险库（凶手／核心诡计／结局），
 * 整目录开放等于把答案挂在网上。**但那一刀砍断了前端自己的腿**：
 *
 *   `web/js/core/seed-files.js` 里是 243 条**静态 import**：
 *   `import batch01 from '../../../data/books/batch-01-honkaku.json' with { type: 'json' }`
 *
 * 模块图是浏览器加载 `app.js` 时一并解析的——那些 JSON 一旦 404，**整个应用都起不来**，
 * 页面就永远停在「加载中…」。换句话说：**谜底不能给，但这些文件必须给**。
 *
 * 于是这里做「同一份文件、两种版本」：**去掉 vault 再发**。
 * 前端本来就从不使用 vault（所有出口都 `stripVault()`，甚至有测试盯着「保险库不出网」），
 * 所以去掉它对界面没有任何影响，而谜底留在服务器上。
 *
 * 缓存按「文件 mtime + 大小」失效：243 个文件、18MB，没必要每次请求都重新序列化。
 */
import fs from 'node:fs';

const cache = new Map(); // file -> { key, body }

/** 去掉每条记录的 vault 字段（数组或 {books:[…]} 两种形态都认） */
export function redactVault(value) {
  const strip = (item) => {
    if (!item || typeof item !== 'object' || !('vault' in item)) return item;
    const { vault, ...rest } = item;
    return rest;
  };
  if (Array.isArray(value)) return value.map(strip);
  if (value && typeof value === 'object' && Array.isArray(value.books)) {
    return { ...value, books: value.books.map(strip) };
  }
  return value;
}

/**
 * 读一个批次文件并去掉谜底，返回 Buffer。
 * @param {string} file 绝对路径
 * @returns {Buffer|null} 文件不存在／解析失败返回 null（由调用方给 404）
 */
export function redactedSeedBuffer(file) {
  let stat;
  try {
    stat = fs.statSync(file);
  } catch {
    return null;
  }
  const key = `${stat.mtimeMs}:${stat.size}`;
  const hit = cache.get(file);
  if (hit && hit.key === key) return hit.body;

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // 半截文件（正在被写入）——让调用方 404，别把坏内容发出去
    return null;
  }
  const body = Buffer.from(JSON.stringify(redactVault(parsed)), 'utf8');
  cache.set(file, { key, body });
  return body;
}

/** 清缓存（测试用） */
export function clearSeedCache() {
  cache.clear();
}
