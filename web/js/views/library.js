/**
 * 视图：知识库浏览
 * 支持关键词搜索、按标签类别与流派筛选、多种排序与导出导入。
 */

import { TAG_CATEGORIES, tagCategory, tagLabel, tagLabels } from '../core/tags.js';
import { bookTagIds } from '../core/engine.js';
import { analyzeBook } from '../core/safety.js';
import { isSensitive } from '../core/sensitive.js';
import { GENRE_OPTIONS, collabLabel } from '../core/seed.js';
import { sortYear } from '../core/store.js';
import { download, html, qs, qsa, raw, toast } from '../ui/dom.js';

export const meta = { title: '知识库' };

const PAGE_SIZE = 48;

/**
 * 排序方式。做成**按钮组**而不是下拉框——下拉框不点开就看不到有什么选项，
 * 真实反馈过「找不到评分排名在哪里」。
 *
 * `primary: true` 的项会被强调显示，因为它是最常用的两种口径。
 */
const SORT_OPTIONS = [
  { id: 'rating', label: '⭐ 评分排名', primary: true },
  { id: 'votes', label: '评价人数', primary: true },
  { id: 'rating-raw', label: '原始评分' },
  { id: 'year', label: '出版年份' },
  { id: 'title', label: '书名' },
  { id: 'author', label: '作者' },
  { id: 'tags', label: '标签数量' },
];

/** 默认排序：直接落在评分排名上，用户一进知识库看到的就是榜单 */
const DEFAULT_SORT = 'rating';

/* ------------------------------------------------------------------ */
/* 评分排名                                                            */
/* ------------------------------------------------------------------ */

/**
 * 样本量门槛。评价人数低于此值的条目，分数稳定性差。
 * 与抓取脚本的 --min-votes 口径保持一致（见 scripts/refresh-ratings.mjs）。
 */
const MIN_VOTES = 200;

/** 全库豆瓣均分，作为加权排名的收缩目标 */
function globalMeanScore(books) {
  const scores = books.map((b) => b.ratings?.douban?.score).filter((n) => typeof n === 'number');
  if (!scores.length) return 7.5;
  return scores.reduce((a, b) => a + b, 0) / scores.length;
}

/**
 * 按评分排名用的**加权分**（贝叶斯收缩）。
 *
 * 直接比原始分会出现排行榜最常见的失真：
 *   《犬滩歌谣》8.6 分，26 人评价   →  压过
 *   《无人生还》9.0 分，17 万人评价
 * 26 人的均分随时会变，把它排进前列等于用一个不可靠的数字冒充榜单。
 * 因此把分数按票数往全库均分收缩：票数越少，拉得越多。
 * 票数达到数百以上时，加权分与原始分几乎一致，不影响正常条目。
 *
 * 返回 null 表示该书没有豆瓣评分，排序时统一沉底。
 */
function weightedScore(book, mean) {
  const d = book.ratings?.douban;
  const score = typeof d?.score === 'number' ? d.score : null;
  if (score === null) return null;
  const v = typeof d?.count === 'number' ? d.count : 0;
  return (v / (v + MIN_VOTES)) * score + (MIN_VOTES / (v + MIN_VOTES)) * mean;
}

/**
 * **降序**比较器：值大的排前面，取不到值的（null）一律沉底。
 *
 * ⚠️ 调用时**不要再交换 a、b**。早期版本写成 `compareNullable(b, a, ...)`，
 * 结果是双重取反：既把整体顺序倒了过来，又让「无评分」的条目排到了最前面，
 * 于是榜单头部全是没有分数的卡片（真实反馈过「排名出来了但看不到评分」）。
 * 排序方向只在这一个函数里定义，调用点保持 `compareNullable(a, b, pick)`。
 */
function compareNullable(a, b, pick) {
  const x = pick(a);
  const y = pick(b);
  if (x === null && y === null) return a.title.localeCompare(b.title, 'zh');
  if (x === null) return 1; // a 无值 → a 排后面
  if (y === null) return -1; // b 无值 → b 排后面
  return y - x; // 值大的在前
}

/** 评价人数：用「万」压缩，避免六位数撑破卡片 */
function formatVotes(n) {
  if (typeof n !== 'number') return '';
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`;
  return String(n);
}

export async function render(ctx) {
  const { main, store, navigate, route, updateStatus } = ctx;

  const state = {
    keyword: route.params.q ?? '',
    category: route.params.cat ?? '',
    tag: route.params.tag ?? '',
    genre: route.params.genre ?? '',
    origin: route.params.origin ?? '',
    sort: route.params.sort ?? DEFAULT_SORT,
    page: 1,
  };

  const all = store.all();
  // 流派用受控词表，保证下拉框顺序稳定、不出现「社会派」与「社会派推理」两个选项
  const presentGenres = new Set(all.map((b) => b.genre).filter(Boolean));
  const genres = GENRE_OPTIONS.filter((g) => presentGenres.has(g));
  if (presentGenres.has('其他')) genres.push('其他');
  const tagCounts = new Map();
  for (const book of all) for (const id of bookTagIds(book)) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">Knowledge Base</span>
      <h1>知识库</h1>
      <p class="lede">
        收录 ${String(all.length)} 部推理小说，每一条都标注了诡计类型、叙事结构、场景与动机标签，
        并附去剧透简介与各平台评价摘要。<strong>点击任意作品查看完整档案与相似作品。</strong>
      </p>
    </div>

    <div class="card tight mb-4">
      <div class="search-bar" style="margin-bottom:var(--space-3)">
        ${/*
          搜索框：`autocomplete="off"` 是必要的——浏览器会自作主张地把上一次
          在这个框里输入过的词在整页刷新后填回来，于是「刷新之后搜索框里总有
          一个我没输的词」这种反馈会一直出现（真机上遇到过）。
          真正的状态来源是 URL 里的 `q`，由 syncUrl 负责同步。
        */ ''}
        <input
          type="search"
          id="lib-search"
          autocomplete="off"
          placeholder="搜索书名、作者、系列、梗概或标签…"
          value="${state.keyword}"
        />
        <button type="button" class="btn btn-sm" id="lib-reset">清空筛选</button>
      </div>

      ${/*
        排序做成**直接可见的按钮组**，而不是下拉框。
        下拉框没有可见标签、默认显示「按首次出版年份」，用户不点开
        根本不知道里面有「评分排名」——这是真实反馈过的问题。
        按钮组把 7 种排序一次摊开，一眼就能看到。
      */ ''}
      <div class="sort-bar">
        <span class="sort-label">排序</span>
        <div class="sort-chips" id="lib-sort" role="group" aria-label="排序方式">
          ${SORT_OPTIONS.map(
            (opt) => raw(html`
              <button
                type="button"
                class="sort-chip${opt.primary ? ' primary' : ''}"
                data-sort="${opt.id}"
                aria-pressed="${state.sort === opt.id}"
              >
                ${opt.label}
              </button>
            `),
          )}
        </div>
      </div>

      ${
        // 敏感模式：标签筛选整块不渲染（标签名本身就是诡计信息，
        // 只用 CSS 隐藏会留在 HTML 里被"查看源代码"读到）
        isSensitive()
          ? raw(html`
              <div class="notice notice-ok" style="margin-bottom:var(--space-4)">
                <strong>标签筛选已按你的设置隐藏</strong>
                <p class="small" style="margin:0">
                  当前处于「敏感模式」，诡计标签不会显示。你仍可用关键词搜索与流派筛选浏览作品，
                  并照常按评分排名。
                </p>
              </div>
              ${
                /**
                 * 标签筛选在敏感模式下**依然生效**，只是界面被隐藏了。
                 * 不加这个提示的话，用户会看到「搜索结果莫名其妙变少」，
                 * 甚至以为某本书从知识库里消失了——真实反馈过这个问题。
                 * 因此必须明确告知「有筛选在起作用」并给出一键清除。
                 */
                state.tag || state.category
                  ? raw(html`
                      <div class="notice notice-warn" id="lib-filter-notice" style="margin-bottom:var(--space-4)">
                        <strong>⚠ 当前有一个标签筛选仍在生效</strong>
                        <p class="small" style="margin:0 0 var(--space-2)">
                          敏感模式下不显示是哪个标签，但它正在收窄下面的结果——搜索也只在这个范围内进行。
                          如果找不到某本书，多半是这个原因。
                        </p>
                        <button type="button" class="btn btn-sm" id="lib-clear-tag-filter">清除标签筛选</button>
                      </div>
                    `)
                  : ''
              }
            `)
          : raw(html`
              <div class="cat-block">
                <div class="cat-title">按标签筛选<span class="weight">点击切换</span></div>
                <div class="tag-picker" id="lib-tags"></div>
              </div>
            `)
      }

      <div class="btn-row" style="gap:var(--space-3)">
        <label class="small muted" style="display:flex;gap:var(--space-2);align-items:center">
          流派
          <select id="lib-genre" style="width:auto;min-width:150px">
            <option value="">全部</option>
            ${genres.map((g) => raw(html`<option value="${g}">${g}</option>`))}
          </select>
        </label>
        <label class="small muted" style="display:flex;gap:var(--space-2);align-items:center">
          来源
          <select id="lib-origin" style="width:auto;min-width:130px">
            <option value="">全部</option>
            <option value="seed">内置知识库</option>
            <option value="user">我添加的</option>
            <option value="imported">导入的</option>
          </select>
        </label>
        <span class="ml-auto small muted" id="lib-count"></span>
        <button type="button" class="btn btn-sm" id="lib-export">导出我的条目</button>
        <button type="button" class="btn btn-sm" id="lib-import">导入 JSON</button>
      </div>
    </div>

    <div id="lib-results"></div>
  `;

  const searchEl = qs('#lib-search');
  const sortEl = qs('#lib-sort');
  const genreEl = qs('#lib-genre');
  const originEl = qs('#lib-origin');
  const countEl = qs('#lib-count');
  const resultsEl = qs('#lib-results');

  genreEl.value = state.genre;
  originEl.value = state.origin;

  /** 同步排序按钮的选中态 */
  function syncSortChips() {
    for (const btn of qsa('#lib-sort .sort-chip')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.sort === state.sort));
    }
  }

  /**
   * 把当前筛选与排序写回 URL。
   *
   * 不写回 URL 会有一个隐蔽的后果：视图状态只活在内存里，
   * 任何一次路由重渲染（hashchange、敏感模式切换）都会用
   * `route.params` 重新初始化 state，把用户的排序/筛选悄悄抹掉。
   * 顺带的好处是排序结果可以直接分享、收藏。
   *
   * ⚠️ **必须用 `history.replaceState`**（第 123 轮修）：
   *   · 直接写 `location.hash` 会触发 `hashchange` → 整个视图重绘一次，
   *     搜索框每敲一个字就重绘一次会丢焦点；
   *   · 更要紧的是**只在「点排序按钮」时写 URL、改完搜索词却不写**，
   *     URL 里就会留着一个过期的 `q`：读者清了搜索框或点「清空筛选」，
   *     URL 仍旧写着旧词，一刷新搜索框又被填回那个词
   *     （真实反馈：「每次刷新之后知识库的搜索框都是佩尔」）。
   *     所以现在**每个改变筛选的动作都同步 URL**，两边不再可能不一致。
   */
  function syncUrl() {
    const params = new URLSearchParams();
    if (state.keyword) params.set('q', state.keyword);
    if (state.tag) params.set('tag', state.tag);
    if (state.genre) params.set('genre', state.genre);
    if (state.origin) params.set('origin', state.origin);
    if (state.sort && state.sort !== DEFAULT_SORT) params.set('sort', state.sort);
    const query = params.toString();
    const next = `#/library${query ? `?${query}` : ''}`;
    if (location.hash === next) return;
    // replaceState 只改地址栏、不加历史记录，也不触发 hashchange（因此不会重绘）
    if (typeof history !== 'undefined' && typeof history.replaceState === 'function') {
      history.replaceState(null, '', next);
    } else {
      location.hash = next;
    }
  }

  /** 渲染标签筛选器 */
  function renderTagFilter() {
    const container = qs('#lib-tags');
    if (!container) return;

    // 敏感模式：标签筛选器本身就是"诡计类型清单"，整块不渲染
    if (isSensitive()) {
      container.innerHTML = html`
        <p class="small muted" style="margin:0">
          当前处于「敏感模式」，标签筛选已隐藏。可用上方的关键词搜索与流派筛选浏览。
        </p>
      `;
      return;
    }

    const groups = [];
    for (const cat of TAG_CATEGORIES) {
      const ids = [...tagCounts.keys()]
        .filter((id) => tagCategory(id) === cat.id)
        .sort((a, b) => (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0));
      if (!ids.length) continue;
      groups.push(html`
        <div style="width:100%">
          <div class="cat-title small" style="margin:var(--space-3) 0 var(--space-2)">${cat.label}</div>
          <div class="tag-cloud">
            ${ids.map(
              (id) => html`
                <button type="button" class="tag-chip" data-tag="${id}" aria-pressed="${state.tag === id}">
                  ${tagLabel(id)}<span class="n">${String(tagCounts.get(id) ?? 0)}</span>
                </button>
              `,
            )}
          </div>
        </div>
      `);
    }
    container.innerHTML = groups.join('');
  }

  /** 过滤 + 排序 */
  function computeList() {
    let list = store.search(state.keyword, (ids) => tagLabels(ids));

    // 标签 / 流派 / 来源都是**筛选**，排序是**独立维度**：
    // 先筛后排，因此「选了标签之后依旧能按评分排名」。
    if (state.tag) list = list.filter((b) => bookTagIds(b).includes(state.tag));
    if (state.category) list = list.filter((b) => bookTagIds(b).some((id) => tagCategory(id) === state.category));
    if (state.genre) list = list.filter((b) => b.genre === state.genre);
    if (state.origin) list = list.filter((b) => (b.origin ?? 'seed') === state.origin);

    const mean = globalMeanScore(store.all());
    const sorters = {
      // 按年代：用 sortYear（首次出版年优先，缺失退回版本年），与 core/store.js 的规则一致
      year: (a, b) => sortYear(a) - sortYear(b) || a.title.localeCompare(b.title, 'zh'),
      title: (a, b) => a.title.localeCompare(b.title, 'zh-Hans-CN'),
      author: (a, b) => String(a.author).localeCompare(String(b.author), 'zh-Hans-CN') || a.title.localeCompare(b.title, 'zh'),
      rating: (a, b) => compareNullable(a, b, (x) => weightedScore(x, mean)),
      'rating-raw': (a, b) => compareNullable(a, b, (x) => x.ratings?.douban?.score ?? null),
      votes: (a, b) => compareNullable(a, b, (x) => x.ratings?.douban?.count ?? null),
      tags: (a, b) => bookTagIds(b).length - bookTagIds(a).length,
    };
    return [...list].sort(sorters[state.sort] ?? sorters.year);
  }

  /** 当前排序是否属于「评分排名」（决定要不要显示名次） */
  const isRanking = () => state.sort === 'rating' || state.sort === 'rating-raw' || state.sort === 'votes';

  /** 渲染结果网格 */
  function renderResults() {
    const list = computeList();
    countEl.textContent = `共 ${String(list.length)} 部`;
    const visible = list.slice(0, state.page * PAGE_SIZE);

    if (!list.length) {
      resultsEl.innerHTML = html`
        <div class="card">
          <div class="empty">
            <div class="icon" aria-hidden="true">🗂️</div>
            <h3>没有符合条件的作品</h3>
            <p>试着放宽筛选条件，或到「添加小说」录入新的作品。</p>
          </div>
        </div>
      `;
      return;
    }

    const ranking = isRanking() && state.sort !== 'votes';
    resultsEl.innerHTML = html`
      ${
        ranking
          ? raw(html`
              <p class="small muted" style="margin:0 0 var(--space-3)">
                按评分排名：分数按评价人数加权，样本过少的作品不会因偶然高分挤进前列。
                带 <strong>⚠</strong> 表示评价人数不足 ${String(MIN_VOTES)}，分数稳定性较差。
              </p>
            `)
          : ''
      }
      <div class="book-grid">
        ${visible.map((book, i) => raw(renderCard(book, ranking ? i + 1 : null)))}
      </div>
      ${list.length > visible.length
        ? raw(html`
            <div class="center" style="margin-top:var(--space-5)">
              <button type="button" class="btn" id="lib-more">显示更多（还有 ${String(list.length - visible.length)} 部）</button>
            </div>
          `)
        : ''}
    `;
  }

  function renderCard(book, rank) {
    // 敏感模式：卡片上不渲染任何标签（不是用 CSS 藏，而是不写进 DOM）
    const showTags = !isSensitive();
    const trickTags = showTags ? bookTagIds(book).filter((id) => tagCategory(id) === 'trick') : [];
    const otherTags = showTags ? bookTagIds(book).filter((id) => tagCategory(id) !== 'trick').slice(0, 3) : [];
    const douban = book.ratings?.douban;
    const doubanScore = douban?.score;
    const doubanCount = douban?.count;
    const lowSample = typeof doubanCount === 'number' && doubanCount < MIN_VOTES;
    const issues = analyzeBook(book).issues.filter((i) => i.risk === 'high' || i.risk === 'medium');
    const collab = collabLabel(book);

    return html`
      <article class="book-card${rank ? ' ranked' : ''}">
        ${rank
          ? raw(html`<span class="rank" aria-label="排名第 ${String(rank)}">#${String(rank)}</span>`)
          : ''}
        <h3><a href="#/book/${encodeURIComponent(book.id)}" style="color:inherit">${book.title}</a></h3>
        <p class="by">
          ${book.author}${book.firstPublished ? ` · ${book.firstPublished}` : ''}${book.series ? ` · ${book.series}` : ''}
        </p>
        <div class="meta-row">
          ${book.genre ? raw(html`<span>${book.genre}</span>`) : ''}
          ${book.country ? raw(html`<span>${book.country}</span>`) : ''}
          ${
            // 评分一律带上评价人数：只给分数会让人误以为「8.6 分」和
            // 「9.0 分」是同等可靠的数字，而样本量差几个数量级
            typeof doubanScore === 'number'
              ? raw(html`<span class="rating" title="${lowSample ? '评价人数偏少，分数稳定性差' : ''}"
                  >豆瓣 ${String(doubanScore)}${doubanCount ? `（${formatVotes(doubanCount)}人）` : ''}${lowSample ? ' ⚠' : ''}</span
                >`)
              : ''
          }
          ${(book.origin ?? 'seed') !== 'seed'
            ? raw(html`<span class="badge">${book.origin === 'user' ? '自建' : '导入'}</span>`)
            : ''}
          ${
            // 「不是一个人写的」要一眼看得见：合集与合著各自一个醒目徽章
            collab
              ? raw(html`<span class="badge badge-collab badge-collab-${collab.kind}" title="${collab.detail}"
                  >${collab.kind === 'anthology' ? '👥' : '✍️'} ${collab.text}</span
                >`)
              : ''
          }
          ${issues.length ? raw(html`<span class="badge badge-medium" title="反剧透体检有提示">⚠ ${String(issues.length)}</span>`) : ''}
        </div>
        <p class="summary">${book.safeSummary || '（暂无去剧透简介）'}</p>
        <div class="tag-list">
          ${trickTags.slice(0, 4).map((id) => raw(html`<span class="badge badge-trick">${tagLabel(id)}</span>`))}
          ${otherTags.map((id) => raw(html`<span class="badge badge-${tagCategory(id)}">${tagLabel(id)}</span>`))}
        </div>
        <div class="footer">
          <a class="btn btn-sm btn-ghost" href="#/book/${encodeURIComponent(book.id)}">查看档案</a>
          <a class="btn btn-sm btn-ghost" href="#/analyze?id=${encodeURIComponent(book.id)}">生成报告</a>
        </div>
      </article>
    `;
  }

  /* ---------------- 事件 ---------------- */

  const cleanups = [];
  const on = (target, event, handler) => {
    target?.addEventListener(event, handler);
    cleanups.push(() => target?.removeEventListener(event, handler));
  };

  on(searchEl, 'input', () => {
    state.keyword = searchEl.value;
    state.page = 1;
    renderResults();
    // 改完立刻同步 URL：否则清了搜索框而 URL 里还留着旧词，一刷新又被填回来
    syncUrl();
  });
  // 排序按钮组：点击即切换，同步选中态并写回 URL
  on(sortEl, 'click', (event) => {
    const btn = event.target.closest?.('.sort-chip');
    if (!btn) return;
    const next = btn.dataset.sort;
    if (!next || next === state.sort) return;
    state.sort = next;
    state.page = 1;
    syncSortChips();
    renderResults();
    syncUrl();
  });
  on(genreEl, 'change', () => {
    state.genre = genreEl.value;
    state.page = 1;
    renderResults();
    syncUrl();
  });

  /**
   * 敏感模式下清除「看不见的」标签筛选。
   *
   * 该按钮只在那条提示里出现。点击后必须**同时清掉 URL 里的 tag/cat**，
   * 否则下一次路由重渲染又会按 URL 把筛选装回去。
   */
  on(qs('#lib-clear-tag-filter'), 'click', () => {
    state.tag = '';
    state.category = '';
    state.keyword = '';
    state.page = 1;
    // 提示块本身渲染在模板里，必须整页重绘才会消失；
    // navigate 会重写 URL（去掉 ?tag=），否则下次重渲染又把筛选装回来
    navigate('library');
  });
  on(originEl, 'change', () => {
    state.origin = originEl.value;
    state.page = 1;
    renderResults();
    syncUrl();
  });
  on(qs('#lib-tags'), 'click', (event) => {
    const id = event.target.closest('[data-tag]')?.dataset.tag;
    if (!id) return;
    state.tag = state.tag === id ? '' : id;
    state.page = 1;
    renderTagFilter();
    renderResults();
    syncUrl();
  });
  on(qs('#lib-reset'), 'click', () => {
    state.keyword = '';
    state.tag = '';
    state.genre = '';
    state.origin = '';
    // 「清空筛选」只清筛选条件，排序回到默认的评分排名
    state.sort = DEFAULT_SORT;
    state.page = 1;
    searchEl.value = '';
    genreEl.value = '';
    originEl.value = '';
    syncSortChips();
    renderTagFilter();
    renderResults();
    // 关键：URL 也要一起清干净，否则刷新之后这些筛选会被 route.params 装回来
    syncUrl();
  });
  on(resultsEl, 'click', (event) => {
    if (event.target.closest('#lib-more')) {
      state.page += 1;
      renderResults();
    }
  });
  on(qs('#lib-export'), 'click', async () => {
    const payload = store.exportAll();
    download(`诡计档案-知识库导出-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast(`已导出 ${String(payload.count)} 部作品（含去剧透资料，保险库内容不会导出）`, { type: 'ok' });
  });
  on(qs('#lib-import'), 'click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const text = await file.text();
        const report = await store.importBooks(text, { merge: 'skip' });
        updateStatus();
        renderResults();
        toast(
          `导入完成：新增 ${String(report.added)} 部，跳过重复 ${String(report.skipped)} 部${
            report.failed.length ? `，失败 ${String(report.failed.length)} 部` : ''
          }`,
          { type: report.failed.length ? 'warn' : 'ok', duration: 5200 },
        );
      } catch (error) {
        toast(String(error.message ?? error), { type: 'error', title: '导入失败' });
      }
    });
    input.click();
  });

  /* ---------------- 初始化 ---------------- */

  renderTagFilter();
  renderResults();

  return () => {
    for (const off of cleanups) off?.();
  };
}
