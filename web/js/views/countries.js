/**
 * 视图：作者国别总览（第 189 轮）
 * ============================
 * 用户需求：**「把数据库的书再设计一个分类，按照作者的国别来分类，不少人只爱看某些国家的。」**
 * 知识库里的国别筛选（第 188 轮）解决的是「已经知道要看哪国」；这一页解决的是
 * **「先看看都有哪些国别、各有多少、谁写的」**——每个国别一张卡片：
 *
 *   · 藏书量（日本 1521 部这样的大数字要一眼看到）；
 *   · **代表作者**（按该国藏书量排的前三位，点名字直接看他的作品）；
 *   · **该国最高分的三本**（有评分的才算，带上分数与年份）；
 *   · 一个「浏览这 1521 部」的按钮 → 进知识库并带上 `?country=日本`。
 *
 * 卡片按**大区**分组（东亚 / 欧洲 / 北美 / 拉美 / 大洋洲 / 其他），
 * 分组的映射与聚合都在 `core/catalog.js` 里（纯函数，带单测）。
 */

import { countryStats, REGION_ORDER } from '../core/catalog.js';
import { coverBlock } from '../ui/cover.js';
import { html, raw } from '../ui/dom.js';

export const meta = { title: '作者国别' };

export async function render(ctx) {
  const { main, store, navigate } = ctx;

  const all = store.all();
  const stats = countryStats(all);
  const byRegion = new Map();
  for (const item of stats) {
    if (!byRegion.has(item.region)) byRegion.set(item.region, []);
    byRegion.get(item.region).push(item);
  }

  const totalBooks = stats.reduce((sum, s) => sum + s.count, 0);

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">By Country</span>
      <h1>按作者国别浏览</h1>
      <p class="lede">
        全库 ${String(totalBooks)} 部作品来自 <strong>${String(stats.length)} 个国别</strong>。
        每个国别一张卡片：藏书量、代表作者、该国评分最高的三本。
        点「浏览这些书」进入知识库并自动带上该国筛选，也可以直接收藏
        <code>#/library?country=日本</code> 这样的地址。
      </p>
    </div>

    ${REGION_ORDER.filter((region) => byRegion.has(region)).map(
      (region) => raw(html`
        <section class="mb-4">
          <h2 class="cat-title">${region}<span class="weight">${String(byRegion.get(region).length)} 个国别</span></h2>
          <div class="country-grid">
            ${byRegion.get(region).map(
              (item) => raw(html`
                <article class="card tight country-card">
                  <header class="country-head">
                    <h3>${item.country}</h3>
                    <span class="country-count">${String(item.count)} 部</span>
                  </header>

                  <p class="small muted" style="margin:var(--space-2) 0 var(--space-3)">
                    代表作者：${item.authors.slice(0, 3).map(
                      (a, i) => raw(html`${i ? ' · ' : ''}<a href="#/library?author=${encodeURIComponent(a.name)}">${a.name}</a>
                        <span class="muted">(${String(a.count)})</span>`),
                    )}
                  </p>

                  ${item.best.length
                    ? raw(html`
                        <div class="country-best">
                          ${item.best.map(
                            (book) => raw(html`
                              <a class="country-best-item" href="#/book/${encodeURIComponent(book.id)}">
                                ${coverBlock(book)}
                                <span class="country-best-meta">
                                  <strong>${book.title}</strong>
                                  <span class="small muted">${book.author}${book.firstPublished ? ` · ${book.firstPublished}` : ''}</span>
                                  <span class="small rating">豆瓣 ${String(book.ratings?.douban?.score ?? '—')}</span>
                                </span>
                              </a>
                            `),
                          )}
                        </div>
                      `)
                    : raw(html`<p class="small muted" style="margin:0">这个国别还没有可用的豆瓣评分。</p>`)}

                  <div class="btn-row" style="margin-top:var(--space-3)">
                    <button type="button" class="btn btn-sm" data-country="${item.country}">
                      浏览这些书（${String(item.count)}）
                    </button>
                  </div>
                </article>
              `),
            )}
          </div>
        </section>
      `),
    )}

    <p class="small muted">
      找不到想看的国别？可以用「更多国别」下拉框在知识库里逐个试，或到
      <a href="#/authors">作者总览</a>按作者名搜索——那里能看到每位作者有多少卷。
    </p>
  `;

  const cleanups = [];
  for (const btn of main.querySelectorAll('[data-country]')) {
    const handler = () => navigate(`library?country=${encodeURIComponent(btn.dataset.country)}`);
    btn.addEventListener('click', handler);
    cleanups.push(() => btn.removeEventListener('click', handler));
  }
  return () => {
    for (const off of cleanups) off?.();
  };
}
