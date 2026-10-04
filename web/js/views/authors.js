/**
 * 视图：作者总览与检索（第 189 轮）
 * ==============================
 * 用户原话：**「2 的话我建议你做出搜索作者可以查看它的卷数的功能，不要二级浏览。」**
 *
 * 所以这一页不是「国别 → 作者」的下钻，而是**一张平的作者表**：
 * 搜名字（或国别）就能立刻看到**这位作者在本库有几卷**、他是哪国人、最高分那一本是哪本。
 * 点行尾的「看这 N 卷」进知识库并带上 `?author=姓名`，与国别筛选同一种做法（可收藏、可分享）。
 */

import { authorStats, filterAuthors } from '../core/catalog.js';
import { html, qs, qsa, raw } from '../ui/dom.js';

export const meta = { title: '作者总览' };

/** 一屏别塞太多：857 位作者，一次渲染 60 行，其余靠「显示更多」 */
const PAGE_SIZE = 60;

const SORTS = [
  { id: 'count', label: '⭐ 卷数最多' },
  { id: 'score', label: '最高分' },
  { id: 'name', label: '姓名' },
];

export async function render(ctx) {
  const { main, store, navigate } = ctx;

  const all = store.all();
  const authors = authorStats(all);
  const state = { keyword: '', sort: 'count', page: 1 };

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">By Author</span>
      <h1>作者总览</h1>
      <p class="lede">
        全库共 <strong>${String(authors.length)} 位作者</strong>（合著与合集按每位署名作者各计一次）。
        搜名字就能看到**他在这套知识库里有多少卷**、最高分是哪一本；
        点「看这 N 卷」进入知识库并自动筛出他的作品。
      </p>
    </div>

    <div class="card tight mb-4">
      <div class="search-bar" style="margin-bottom:var(--space-3)">
        <input type="search" id="au-search" autocomplete="off" placeholder="搜索作者姓名，或按国别搜（例如「日本」）…" />
        <button type="button" class="btn btn-sm" id="au-reset">清空</button>
      </div>
      <div class="sort-bar">
        <span class="sort-label">排序</span>
        <div class="sort-chips" id="au-sort" role="group" aria-label="作者排序">
          ${SORTS.map(
            (opt) => raw(html`
              <button type="button" class="sort-chip${state.sort === opt.id ? '' : ''}" data-sort="${opt.id}" aria-pressed="${state.sort === opt.id}">
                ${opt.label}
              </button>
            `),
          )}
        </div>
        <span class="ml-auto small muted" id="au-count"></span>
      </div>
    </div>

    <div id="au-results"></div>
  `;

  const searchEl = qs('#au-search');
  const countEl = qs('#au-count');
  const resultsEl = qs('#au-results');
  const sortEl = qs('#au-sort');

  /** 当前条件下的作者列表（过滤 + 排序） */
  function compute() {
    const list = filterAuthors(authors, state.keyword);
    const withScore = (a) => (typeof a.topScore === 'number' ? a.topScore : -1);
    const sorters = {
      count: (a, b) => b.count - a.count || a.name.localeCompare(b.name, 'zh'),
      score: (a, b) => withScore(b) - withScore(a) || b.count - a.count,
      name: (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'),
    };
    return [...list].sort(sorters[state.sort] ?? sorters.count);
  }

  function renderResults() {
    const list = compute();
    countEl.textContent = `共 ${String(list.length)} 位作者`;
    const visible = list.slice(0, state.page * PAGE_SIZE);
    if (!list.length) {
      resultsEl.innerHTML = html`
        <div class="card"><div class="empty">
          <div class="icon" aria-hidden="true">🔍</div>
          <h3>没有匹配的作者</h3>
          <p>换个写法试试，或者到知识库按关键词搜书名。</p>
        </div></div>
      `;
      return;
    }
    resultsEl.innerHTML = html`
      <div class="card tight">
        <table class="author-table">
          <thead>
            <tr>
              <th>作者</th>
              <th>国别</th>
              <th class="num">卷数</th>
              <th>最高分</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            ${visible.map(
              (a) => raw(html`
                <tr>
                  <td><strong>${a.name}</strong></td>
                  <td>${a.country || '—'}</td>
                  <td class="num">${String(a.count)}</td>
                  <td>
                    ${a.best
                      ? raw(html`<a href="#/book/${encodeURIComponent(a.best.id)}">${a.best.title}</a>
                          <span class="small rating">${String(a.topScore)}</span>`)
                      : raw(html`<span class="muted">暂无评分</span>`)}
                  </td>
                  <td class="num">
                    <button type="button" class="btn btn-sm" data-author="${a.name}">看这 ${String(a.count)} 卷</button>
                  </td>
                </tr>
              `),
            )}
          </tbody>
        </table>
      </div>
      ${list.length > visible.length
        ? raw(html`
            <div class="center" style="margin-top:var(--space-5)">
              <button type="button" class="btn" id="au-more">显示更多（还有 ${String(list.length - visible.length)} 位）</button>
            </div>
          `)
        : ''}
    `;
  }

  function syncSortChips() {
    for (const btn of qsa('#au-sort .sort-chip')) btn.setAttribute('aria-pressed', String(btn.dataset.sort === state.sort));
  }

  const cleanups = [];
  const on = (target, event, handler) => {
    target?.addEventListener(event, handler);
    cleanups.push(() => target?.removeEventListener(event, handler));
  };

  on(searchEl, 'input', () => {
    state.keyword = searchEl.value;
    state.page = 1;
    renderResults();
  });
  on(qs('#au-reset'), 'click', () => {
    state.keyword = '';
    state.page = 1;
    searchEl.value = '';
    renderResults();
  });
  on(sortEl, 'click', (event) => {
    const id = event.target.closest?.('.sort-chip')?.dataset.sort;
    if (!id || id === state.sort) return;
    state.sort = id;
    state.page = 1;
    syncSortChips();
    renderResults();
  });
  on(resultsEl, 'click', (event) => {
    const btn = event.target.closest?.('[data-author]');
    if (btn) {
      navigate(`library?author=${encodeURIComponent(btn.dataset.author)}`);
      return;
    }
    if (event.target.closest?.('#au-more')) {
      state.page += 1;
      renderResults();
    }
  });

  syncSortChips();
  renderResults();

  return () => {
    for (const off of cleanups) off?.();
  };
}
