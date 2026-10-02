/**
 * 封面渲染（第 166 轮）
 * ====================
 * 库里的封面是**本地文件**：`web/covers/<作品 id>.webp`（少数没有 webp 档的存成 .jpg）。
 * 有没有封面、文件叫什么、图是从哪条豆瓣条目来的，全在 `core/covers.js` 那份由
 * `scripts/gen-cover-manifest.mjs` 生成的清单里。
 *
 * 一条重要取舍：**没有封面时不发任何请求**，直接画本地占位图。
 * 若改成「先试着加载、失败再兜底」，全库几百部缺封面的作品会让每页控制台刷一串 404，
 * 既慢又难看；有清单就能一开始就知道该画什么。
 */

import { html } from './dom.js';
import { COVER_PLACEHOLDER, coverCredit, coverUrl } from '../core/covers.js';

/**
 * 一块封面。
 *
 * @param {object} book 作品记录
 * @param {{size?: 'card'|'hero'|'mini', link?: boolean}} [options]
 *   size：卡片缩略图 / 详情页大图 / 列表小图；link：是否点封面进详情页
 */
export function coverBlock(book, options = {}) {
  const { size = 'card', link = true } = options;
  const url = coverUrl(book.id);
  const alt = url ? `《${book.title}》封面` : `暂未找到《${book.title}》的封面`;
  const img = html`<img
    class="cover-img"
    src="${url || COVER_PLACEHOLDER}"
    alt="${alt}"
    loading="lazy"
    decoding="async"
    width="270"
    height="400"
  />`;
  const cls = `cover cover-${size}${url ? '' : ' cover-none'}`;
  const title = url ? `《${book.title}》` : `《${book.title}》暂未找到封面`;
  if (!link) {
    return html`<div class="${cls}" title="${title}">${img}</div>`;
  }
  return html`<a
    class="${cls}"
    href="#/book/${encodeURIComponent(book.id)}"
    title="${title}"
    tabindex="-1"
    aria-hidden="true"
    >${img}</a
  >`;
}

/**
 * 详情页「封面来源」一行。
 *
 * 这一行的意义不在好看，而在**可复核**：点进那条豆瓣条目就能看到同一张图与同一版信息，
 * 弱链接（只按题名吻合）会明说自己是弱链接。
 */
export function coverCreditLine(book) {
  const credit = coverCredit(book.id);
  if (!credit) {
    return html`<p class="cover-credit">
      封面：<span class="muted">暂未找到（已试过豆瓣检索与条目页）</span>
    </p>`;
  }
  const year = credit.year ? ` · ${credit.year} 版` : '';
  const inner = credit.subjectId
    ? html`<a href="${credit.url}" target="_blank" rel="noopener noreferrer">豆瓣条目 ${credit.subjectId}</a>`
    : html`<span>豆瓣</span>`;
  return html`<p class="cover-credit">封面：${inner}${year} · ${credit.how}</p>`;
}
