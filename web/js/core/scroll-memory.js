/**
 * 回到列表时把位置还给你（第 187 轮）
 * ==================================
 * 用户反馈：**「知识库翻到很后面 → 点进一本书 → 看完返回 → 回到最上面，又得重新翻。」**
 *
 * 原因有两层，都要修：
 *   1. `library.js` 的 `page` 是每次渲染新建的局部状态（默认 1），返回时只剩 48 张卡片，
 *      **后面的内容根本不在 DOM 里**，滚动位置也就无处可恢复；
 *   2. 路由渲染默认 `scrollTo(0)`，返回列表时不会把原来的偏移还回去。
 *
 * 这个模块放**纯函数**（可单测），把「该不该恢复、恢复到哪一页」这类判断从 DOM 里剥出来：
 *
 *   · `scrollKey()`   —— 把 hash 归一化成记忆键；
 *   · `listStateKey()`—— 按「筛选 + 排序」分桶记页码（换了筛选就该从第一页开始）；
 *   · `shouldRestoreScroll()` —— 什么时候该恢复滚动位置。
 *
 * 恢复的时机刻意收窄：**只有「回到你刚才那条列表」才恢复**——浏览器前进后退，
 * 或者从书籍档案页返回。从顶部导航主动切到知识库 = 从头看（那是另一次浏览行为）。
 */

/** 记忆键：hash 归一化（去掉 `#`、去掉尾部斜杠，`#/library/` 与 `#/library` 视为同一页） */
export function scrollKey(hash = '') {
  const clean = String(hash ?? '').replace(/^#\/?/, '').replace(/\/+$/, '');
  return clean ? `#/${clean}` : '#/';
}

/**
 * 列表页码的分桶键：筛选或排序一变，就该回到第一页——
 * 否则「搜完 A 再搜 B，结果只剩 3 部，却还记着第 7 页」这种怪事就会出现。
 */
export function listStateKey(params = {}) {
  const pick = (k) => String(params?.[k] ?? '');
  return [pick('q'), pick('cat'), pick('tag'), pick('genre'), pick('origin'), pick('country'), pick('sort')].join('|');
}

/**
 * 该不该在渲染完成后恢复滚动位置？
 *
 * @param {{prevView?:string|null, prevKey?:string|null, nextView?:string|null, nextKey?:string|null, isPop?:boolean, saved?:number|null}} args
 * @returns {boolean}
 */
export function shouldRestoreScroll({ prevView = null, prevKey = null, nextView = null, nextKey = null, isPop = false, saved = null } = {}) {
  if (saved == null || !Number.isFinite(saved)) return false; // 没记过位置
  if (!nextKey) return false;
  if (prevKey && prevKey === nextKey) return false; // 同一页重绘（改筛选等）→ 由 keepScroll 负责
  if (isPop) return true; // 浏览器后退／前进：用户明确在「往回走」
  // 从书籍档案页返回列表：书页上那个「返回」也是新的一次导航，但意图同样是回到原处
  return prevView === 'book' && nextView !== 'book';
}
