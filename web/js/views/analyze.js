/**
 * 视图：诡计分析（首页）
 * =====================
 * 严格按需求文档的六段式结构输出报告，并附安全自检清单。
 *
 * 两种输入路径：
 *   A. 从知识库选择已有作品 —— 直接分析
 *   B. 输入知识库中没有的书名 + 无剧透梗概 —— 系统推断候选标签，用户确认后再分析
 *      （对应需求文档「若用户只给了书名、没给梗概，可自行查阅公开资料补全」的人工兜底路径）
 */

import { CATEGORY_MAP, TAG_CATEGORIES, isSchoolTag, tagCategory, tagLabel } from '../core/tags.js';
import { bookTagIds, recommend } from '../core/engine.js';
import { countChars, runSelfCheck } from '../core/safety.js';
import { gateRecommendations, isSensitive } from '../core/sensitive.js';
import { suggestTags } from '../core/suggest.js';
import { markdownToHtml, renderCopyMarkdown, renderReport } from '../core/report.js';
import { copyText, debounce, download, html, onAll, qs, qsa, raw, safeFilename, toast } from '../ui/dom.js';

export const meta = { title: '诡计分析' };

const SHIELD_SVG = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l7 3v6c0 4.2-2.9 7.6-7 9-4.1-1.4-7-4.8-7-9V6l7-3z"/><path d="M9 12l2 2 4-4"/></svg>`;

export async function render(ctx) {
  const { main, store, route } = ctx;

  const state = {
    mode: 'library', // library | custom
    selectedId: route.params.id ?? null,
    custom: { title: '', author: '', safeSummary: '', tags: new Set(), schoolTags: new Set(), customTags: '' },
    suggestions: [],
    result: null,
  };

  const allBooks = store.all();
  const tagStats = buildTagStats(allBooks);
  const cleanups = [];

  /**
   * 临时分析用的两个维度分开存放：流派存在 schoolTags，其余存在 tags。
   * 表单里两类复选框混在一起渲染，勾选时必须按类别路由，否则流派会被写进 tags，
   * 与知识库的字段约定不一致。
   */
  const setForCustom = (id) => (isSchoolTag(id) ? state.custom.schoolTags : state.custom.tags);
  const customTagCount = () => state.custom.tags.size + state.custom.schoolTags.size;

  /**
   * 初始化时的敏感模式快照。
   * 敏感模式下**不渲染任何标签相关的 DOM**（包括折叠面板里的标签选择器）——
   * 若只是用 CSS 藏起来，标签名仍然留在 HTML 里，用户"查看源代码"就能读到。
   */
  const sensitiveInitial = isSensitive();

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">Spoiler-Free Analysis</span>
      <h1>推理小说诡计标签分析</h1>
      <p class="lede">
        输入书名与无剧透梗概，系统会给出结构化的诡计标签、<strong>诡计机制高度相似</strong>的作品推荐，
        以及各平台去剧透评价参考。全过程不写出凶手、不写出真相与结局、不解释诡计实现方式。
      </p>
    </div>

    <div class="ironclad-rule">
      <span class="shield" aria-hidden="true">${raw(SHIELD_SVG)}</span>
      <div>
        <strong>最高铁律（本系统不会违反）</strong>
        <ul>
          <li>绝不写出凶手是谁，也绝不透露真相、结局与手法核心答案</li>
          <li>只描述「存在什么类型的诡计」，不描述「这个诡计是什么、怎么破的」</li>
          <li>推荐作品只比较诡计类型与风格，不泄露任何一本的谜底</li>
        </ul>
      </div>
    </div>

    <div class="report-layout">
      <!-- 左：输入区 -->
      <div>
        <div class="card" id="input-card">
          <div class="card-head">
            <h2>输入作品</h2>
          </div>

          <div class="btn-row mb-4" role="tablist" aria-label="输入方式">
            <button type="button" class="btn btn-sm" data-mode="library" role="tab" aria-selected="true">
              从知识库选择
            </button>
            <button type="button" class="btn btn-sm" data-mode="custom" role="tab" aria-selected="false">
              输入新作品
            </button>
          </div>

          <!-- A. 知识库选择 -->
          <div data-panel="library">
            <div class="field">
              <label for="book-search">搜索书名 / 作者 / 标签</label>
              <input
                type="search"
                id="book-search"
                placeholder="${sensitiveInitial ? '输入书名或作者…' : '试试「密室」「横沟正史」「叙述性诡计」…'}"
                autocomplete="off"
                spellcheck="false"
              />
              <p class="hint">快捷键 <kbd>/</kbd> 可直接聚焦搜索框。共 ${String(allBooks.length)} 部作品。</p>
            </div>

            <div class="tag-list mb-4" id="quick-tags"></div>
            <div class="result-list" id="book-results" role="listbox" aria-label="书籍列表"></div>
          </div>

          <!-- B. 自定义输入 -->
          <div data-panel="custom" class="hidden">
            ${sensitiveInitial
              ? raw(html`
                  <div class="notice notice-info" style="margin-bottom:0">
                    <strong>敏感模式下无法录入新作品</strong>
                    <p class="small" style="margin:0">
                      录入新作品需要从候选标签中勾选诡计类型，而标签本身在敏感模式下是隐藏的。
                      如需录入，请点击页面顶部的开关切回「普通模式」。
                    </p>
                  </div>
                `)
              : raw(html`
                  <div class="field">
                    <label for="c-title">小说名称<span class="required">*</span></label>
                    <input type="text" id="c-title" placeholder="要分析的书名" />
                  </div>
                  <div class="field">
                    <label for="c-author">作者（选填）</label>
                    <input type="text" id="c-author" placeholder="作者名" />
                  </div>
                  <div class="field">
                    <label for="c-summary">无剧透梗概<span class="required">*</span></label>
                    <textarea
                      id="c-summary"
                      placeholder="只写故事设定与悬念，例如：十名互不相识的人受邀来到一座与外界隔绝的孤岛，主人始终没有露面，随后有人接连死去。"
                    ></textarea>
                    <p class="hint">
                      <span class="counter" id="c-summary-count">0 / 100 字</span>
                      —— 请勿写入凶手、手法或结局。系统会从中推断候选诡计标签。
                    </p>
                  </div>

                  <div id="suggest-area" class="hidden">
                    <div class="field">
                      <span class="field-label">候选标签（系统推断，请核对后勾选）</span>
                      <div class="tag-picker" id="suggest-list"></div>
                      <p class="hint" id="suggest-hint"></p>
                    </div>
                  </div>

                  <details class="mb-4">
                    <summary class="dim small" style="cursor:pointer">手动补充标签 / 自定义标签</summary>
                    <div class="tag-picker" id="manual-tags" style="margin-top:var(--space-3)"></div>
                    <div class="field" style="margin-top:var(--space-3);margin-bottom:0">
                      <label for="c-custom-tags">自定义标签（用逗号或顿号分隔）</label>
                      <input type="text" id="c-custom-tags" placeholder="例如：双胞胎诡计、动物视角" />
                    </div>
                  </details>
                `)}
          </div>

          <div class="btn-row">
            <button type="button" class="btn btn-primary" id="run-btn" disabled>生成分析报告</button>
            <button type="button" class="btn btn-ghost btn-sm" id="reset-btn">重置</button>
          </div>
        </div>
      </div>

      <!-- 右：报告区 -->
      <div id="report-area">
        <div class="card">
          <div class="empty">
            <div class="icon" aria-hidden="true">🔍</div>
            <h3>等待输入</h3>
            <p>从左侧选择一部作品，或输入新作品的书名与无剧透梗概，<br />然后点击「生成分析报告」。</p>
          </div>
        </div>
      </div>
    </div>
  `;

  /* ---------------- 元素引用 ---------------- */

  const resultsEl = qs('#book-results');
  const searchEl = qs('#book-search');
  const runBtn = qs('#run-btn');
  const summaryEl = qs('#c-summary');
  const countEl = qs('#c-summary-count');
  const reportArea = qs('#report-area');

  /* ---------------- 书籍列表 ---------------- */

  function renderList(keyword = '') {
    if (!resultsEl) return;
    const showTags = !isSensitive();
    const list = store.search(keyword, (ids) => ids.map(tagLabel));
    if (!list.length) {
      resultsEl.innerHTML = html`<p class="muted small" style="padding:var(--space-4)">
        没有匹配的作品。可以切到「输入新作品」手动录入。
      </p>`;
      return;
    }
    resultsEl.innerHTML = list
      .slice(0, 200)
      .map((book) => {
        // 敏感模式：卡片上连一个标签都不渲染（不是用 CSS 藏起来，
        // 而是根本不写进 DOM，避免"查看源代码"仍能读到）
        const tags = showTags
          ? bookTagIds(book)
              .filter((id) => tagCategory(id) === 'trick')
              .slice(0, 3)
              .map((id) => tagLabel(id))
          : [];
        const douban = book.ratings?.douban?.score;
        return html`
          <button
            type="button"
            class="result-item"
            role="option"
            data-id="${book.id}"
            aria-selected="${book.id === state.selectedId}"
          >
            <span class="t">${book.title}</span>
            <span class="s">
              ${book.author}${book.firstPublished ? ` · ${book.firstPublished}` : ''}${book.genre ? ` · ${book.genre}` : ''}
              ${douban ? ` · 豆瓣 ${douban}` : ''}
            </span>
            ${showTags
              ? raw(html`<span class="tag-list">
                  ${tags.map((t) => html`<span class="badge badge-trick">${t}</span>`)}
                  ${book.origin === 'user' ? html`<span class="badge">自建</span>` : ''}
                </span>`)
              : ''}
          </button>
        `;
      })
      .join('');
  }

  function renderQuickTags() {
    const container = qs('#quick-tags');
    if (!container) return;
    // 敏感模式下快捷标签本身就是"诡计类型清单"，直接不渲染
    if (isSensitive()) {
      container.innerHTML = '';
      return;
    }
    const top = [...tagStats.entries()]
      .filter(([id]) => tagCategory(id) === 'trick')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    // 直接把 html`` 数组交给模板插值（html`` 会递归处理数组），
    // 不要先 raw() 再 join('')：那样会走 Array.prototype.toString 得到 [object Object]
    container.innerHTML = html`
      ${top.map(
        ([id, count]) => html`
          <button type="button" class="tag-chip" data-quick="${tagLabel(id)}">
            ${tagLabel(id)}<span class="n">${String(count)}</span>
          </button>
        `,
      )}
    `;
  }

  /* ---------------- 自定义输入 ---------------- */

  function updateSummaryCounter() {
    if (!summaryEl || !countEl) return;
    const len = countChars(summaryEl.value);
    countEl.textContent = `${len} / 100 字`;
    countEl.className = `counter${len > 100 ? ' over' : len > 85 ? ' warn' : ''}`;
  }

  const runSuggest = debounce(() => {
    if (!summaryEl) return;
    state.suggestions = suggestTags(summaryEl.value);

    const area = qs('#suggest-area');
    const list = qs('#suggest-list');
    const hint = qs('#suggest-hint');
    if (!area || !list || !hint) return;

    if (!state.suggestions.length) {
      area.classList.add('hidden');
      return;
    }
    area.classList.remove('hidden');

    const byCat = new Map();
    for (const s of state.suggestions) {
      if (!byCat.has(s.category)) byCat.set(s.category, []);
      byCat.get(s.category).push(s);
    }

    list.innerHTML = [...byCat.entries()]
      .map(
        ([cat, items]) => html`
          <div style="width:100%">
            <div class="cat-title small" style="margin:var(--space-2) 0">
              ${CATEGORY_MAP[cat]?.label ?? cat}
              <span class="weight">权重 ${String(CATEGORY_MAP[cat]?.weight ?? '')}</span>
            </div>
            <div class="tag-picker">
              ${items.map(
                (s) => raw(html`
                  <label class="tag-option" data-checked="${setForCustom(s.id).has(s.id)}" title="命中：${s.hits.join('、')}">
                    <input type="checkbox" data-suggest="${s.id}" ${s.level === 'high' ? 'checked' : ''} />
                    ${s.label}
                    <span class="count">${s.level === 'high' ? '明确' : '可能'}</span>
                  </label>
                `),
              )}
            </div>
          </div>
        `,
      )
      .join('');

    // 「明确」命中的默认勾选（按类别路由到对应维度）
    for (const s of state.suggestions) if (s.level === 'high') setForCustom(s.id).add(s.id);

    hint.textContent = `共推断出 ${String(state.suggestions.length)} 个候选标签，其中「明确」为梗概中直接提到的类型。请核对后取消不准确的项。`;
    updateRunState();
  }, 240);

  function renderManualTags() {
    const container = qs('#manual-tags');
    if (!container) return;
    container.innerHTML = TAG_CATEGORIES.map((cat) => {
      const items = [...tagStats.keys()].filter((id) => tagCategory(id) === cat.id);
      if (!items.length) return '';
      return html`
        <div class="cat-block">
          <div class="cat-title">${cat.label}<span class="weight">权重 ${String(cat.weight)}</span></div>
          <div class="tag-picker">
            ${items.map(
              (id) => raw(html`
                <label class="tag-option" data-checked="${setForCustom(id).has(id)}">
                  <input type="checkbox" data-manual="${id}" ${setForCustom(id).has(id) ? 'checked' : ''} />
                  ${tagLabel(id)}
                  <span class="count">${String(tagStats.get(id) ?? 0)}</span>
                </label>
              `),
            )}
          </div>
        </div>
      `;
    }).join('');
  }

  function updateRunState() {
    if (!runBtn) return;
    if (state.mode === 'library') {
      runBtn.disabled = !state.selectedId;
      return;
    }
    runBtn.disabled = !(
      state.custom.title.trim() &&
      state.custom.safeSummary.trim() &&
      customTagCount() > 0
    );
  }

  /* ---------------- 模式切换 ---------------- */

  function setMode(mode) {
    state.mode = mode;
    for (const btn of qsa('[data-mode]')) {
      const active = btn.dataset.mode === mode;
      btn.classList.toggle('btn-primary', active);
      btn.setAttribute('aria-selected', String(active));
    }
    qs('[data-panel="library"]')?.classList.toggle('hidden', mode !== 'library');
    qs('[data-panel="custom"]')?.classList.toggle('hidden', mode !== 'custom');
    updateRunState();
  }

  /* ---------------- 执行分析 ---------------- */

  function buildCustomBook() {
    const custom = state.custom;
    const extra = custom.customTags
      .split(/[,，、;；]/)
      .map((s) => s.trim())
      .filter(Boolean);
    return {
      id: `adhoc-${Date.now().toString(36)}`,
      title: custom.title.trim(),
      author: custom.author.trim() || '未注明',
      genre: '',
      firstPublished: '',
      series: '',
      tags: [...custom.tags],
      school: [...custom.schoolTags],
      customTags: extra,
      safeSummary: custom.safeSummary.trim(),
      ratings: {},
      readingTips: { suitableFor: [], watchFor: [], warning: '' },
      origin: 'adhoc',
      group: '临时分析',
    };
  }

  function analyze() {
    const isLibrary = state.mode === 'library';
    const book = isLibrary ? store.get(state.selectedId) : buildCustomBook();
    if (!book) {
      toast('请先选择一部作品', { type: 'warn' });
      return;
    }

    if (!isLibrary && countChars(book.safeSummary) > 100) {
      toast(`无剧透简介为 ${countChars(book.safeSummary)} 字，超出需求文档规定的 100 字上限，请精简后再生成。`, {
        type: 'warn',
        title: '简报超长',
        duration: 5200,
      });
      return;
    }

    const corpus = [...store.all()];
    const recResult = recommend(book, corpus, { limit: 3, candidatePool: 10 });

    /**
     * 敏感模式：先把推荐结果过一遍呈现闸门，再交给报告渲染器。
     *
     * 顺序很重要——必须**先闸门后渲染**。若先渲染再把标签藏起来，
     * 标签就已经进了 DOM，用户"查看源代码"或复制页面仍能读到，
     * 等于敏感模式形同虚设。
     */
    const sensitive = isSensitive();
    const shownResult = gateRecommendations(recResult);

    const selfCheck = runSelfCheck({ book, recommendations: shownResult.recommendations });
    const markdown = renderReport({
      book,
      recommendations: shownResult.recommendations,
      selfCheck,
      trickGate: shownResult.trickGate,
      options: { sensitive },
    });
    const copyMarkdown = renderCopyMarkdown({
      book,
      recommendations: shownResult.recommendations,
      options: { sensitive },
    });

    state.result = {
      book,
      recResult,
      shownResult,
      selfCheck,
      markdown,
      copyMarkdown,
      sensitive,
      isCustom: !isLibrary,
    };
    renderReportArea();
  }

  /* ---------------- 报告区 ---------------- */

  function renderReportArea() {
    const area = reportArea;
    if (!area) return;
    const r = state.result;

    if (!r) {
      area.innerHTML = html`
        <div class="card">
          <div class="empty">
            <div class="icon" aria-hidden="true">🔍</div>
            <h3>等待输入</h3>
            <p>从左侧选择一部作品，或输入新作品的书名与无剧透梗概，<br />然后点击「生成分析报告」。</p>
          </div>
        </div>
      `;
      return;
    }

    const { book, recResult, shownResult, selfCheck, sensitive } = r;
    const blocked = !selfCheck.passed;

    area.innerHTML = html`
      <div class="report-toolbar no-print">
        <button type="button" class="btn btn-sm btn-primary" data-action="copy">复制 Markdown</button>
        <button type="button" class="btn btn-sm" data-action="download">导出 .md</button>
        <button type="button" class="btn btn-sm" data-action="print">打印 / 存 PDF</button>
        ${r.isCustom ? raw(html`<button type="button" class="btn btn-sm" data-action="save">存入知识库</button>`) : ''}
        <span class="ml-auto small muted">生成于 ${new Date().toLocaleString('zh-CN')}</span>
      </div>

      ${blocked
        ? raw(html`
            <div class="notice notice-error no-print">
              <strong>⛔ 反剧透自检未通过，已拦截导出</strong>
              <p>检测到可能存在剧透风险的表述。请修改书籍资料后重新生成；「复制 / 导出」在通过自检前不可用。</p>
            </div>
          `)
        : ''}

      <div class="report-body" id="report-body">
        <div class="print-header">
          <div class="ph-title">${sensitive ? '阅读信息报告' : '诡计标签分析报告'}：${book.title}</div>
          <div class="ph-sub">
            ${book.author} · 生成于 ${new Date().toLocaleString('zh-CN')} · 本报告不含任何剧透
          </div>
        </div>
        ${raw(markdownToHtml(r.markdown))}
      </div>

      <div class="card no-print" style="margin-top:var(--space-4)">
        <details class="selfcheck" ${blocked ? 'open' : ''}>
          <summary>
            安全自检清单
            ${blocked
              ? raw('<span class="badge badge-high">未通过 · 已拦截</span>')
              : raw('<span class="badge badge-ok">5 / 5 通过</span>')}
          </summary>
          ${raw(renderSelfCheckHtml(selfCheck))}
        </details>
      </div>

      ${sensitive
        ? raw(html`
            <div class="card no-print" style="margin-top:var(--space-4)">
              <div class="section-title"><span class="num">◈</span>敏感模式</div>
              <p class="small dim" style="margin:0">
                匹配明细（共享了哪些标签、相似度百分比）已按你的设置隐藏。
                推荐顺序仍然由完整的标签比对算法得出，只是不把比对过程展示出来——
                因为「哪些标签重合」本身就是能反推出诡计类型的信息。
              </p>
            </div>
          `)
        : raw(renderMatchPanel(recResult))}
    `;

    // 相似度条动画（写 style 前先确认元素与 style 都存在，
    // 否则一个意外节点就会让整个报告区渲染失败）
    requestAnimationFrame(() => {
      for (const bar of qsa('.sim-bar > span[data-w]', area)) {
        if (bar?.style) bar.style.width = `${bar.dataset.w}%`;
      }
    });
  }

  function renderSelfCheckHtml(selfCheck) {
    const items = selfCheck.items
      .map(
        (item) => html`
          <li>
            <span class="mark ${item.passed ? 'ok' : 'bad'}">${item.passed ? '✓' : '✕'}</span>
            <span>
              ${item.question}
              <span class="muted">→ ${item.passed ? '否' : '是'}</span>
              ${
                item.hits.length
                  ? raw(html`
                      <ul class="small muted" style="margin:var(--space-1) 0 0;padding-left:1.1em">
                        ${item.hits
                          .slice(0, 3)
                          .map(
                            (hh) =>
                              raw(html`<li>${hh.source}：…${hh.excerpt}…<br /><span class="muted">${hh.hint}</span></li>`),
                          )}
                      </ul>
                    `)
                  : ''
              }
            </span>
          </li>
        `,
      )
      .join('');

    return html`
      <ul class="checklist">${raw(items)}</ul>
      <p class="small muted" style="margin-top:var(--space-3)">
        ${selfCheck.passed
          ? '五项自检全部通过，本次输出不含任何剧透内容。'
          : '存在未通过项，系统已按需求文档要求拦截导出。'}
      </p>
    `;
  }

  /** 匹配明细面板：回答「为什么推荐这几本」 */
  function renderMatchPanel(recResult) {
    const recs = recResult.recommendations;
    const excluded = recResult.excluded ?? [];

    if (!recs.length) {
      const trickZero = excluded.filter((e) => e.reason.includes('没有共享任何「诡计类」标签'));
      const reasons = new Map();
      for (const e of excluded) reasons.set(e.reason, (reasons.get(e.reason) ?? 0) + 1);

      return html`
        <div class="card no-print" style="margin-top:var(--space-4)">
          <div class="section-title"><span class="num">!</span>为什么没有推荐</div>
          ${
            excluded.length
              ? raw(html`
                  <p class="small dim">知识库中共有 ${String(recs.length + excluded.length)} 部候选作品，但都被下列规则排除了：</p>
                  <ul class="small" style="padding-left:1.2em">
                    ${[...reasons.entries()]
                      .sort((a, b) => b[1] - a[1])
                      .map(([reason, count]) => raw(html`<li>${reason} —— ${String(count)} 部</li>`))}
                  </ul>
                  ${
                    trickZero.length === excluded.length
                      ? raw(html`
                          <div class="notice notice-warn" style="margin:var(--space-3) 0 0">
                            <strong>这是因为「诡计类」标签过冷门</strong>
                            <p class="small" style="margin:0">
                              本书标注的诡计类标签在知识库中没有其他作品共享。需求文档要求推荐作品必须在
                              <b>诡计机制层面高度相似</b>，因此系统选择不推荐，而不是勉强凑数。
                              可在「添加小说」页为本书补充更常见的诡计标签，或向知识库添加同类作品。
                            </p>
                          </div>
                        `)
                      : ''
                  }
                `)
              : raw('<p class="muted small">知识库中暂无可比对的作品，无法给出相似度明细。</p>')
          }
        </div>
      `;
    }

    const rows = recs
      .map((rec) => {
        const detail = rec.detail;
        const catRows = TAG_CATEGORIES.filter((c) => detail.byCategory[c.id]?.targetCount)
          .map((c) => {
            const info = detail.byCategory[c.id];
            return html`
              <div class="cat-row">
                <span class="cat-label">${c.label}</span>
                <span class="tag-list">
                  ${info.matched.map((id) => raw(html`<span class="badge badge-${c.id}">${tagLabel(id)}</span>`))}
                  ${info.missing.map(
                    (id) => raw(html`<span class="badge" style="opacity:.45" title="未共享">${tagLabel(id)}</span>`),
                  )}
                  ${!info.matched.length && !info.missing.length ? raw('<span class="muted small">—</span>') : ''}
                </span>
              </div>
            `;
          })
          .join('');

        return html`
          <div style="padding:var(--space-3) 0;border-bottom:1px dashed var(--border)">
            <div style="display:flex;gap:var(--space-2);align-items:baseline;flex-wrap:wrap">
              <strong style="font-family:var(--font-serif)">《${rec.book.title}》</strong>
              <span class="muted small">${rec.book.author}</span>
              <span class="ml-auto badge ${
                rec.confidence.level === 'high' ? 'badge-ok' : rec.confidence.level === 'medium' ? 'badge-low' : ''
              }">${rec.confidence.label}</span>
            </div>
            <div class="sim-row" style="margin-top:var(--space-2)">
              <span>相似度</span>
              <span class="sim-bar"><span style="width:0" data-w="${String(rec.percent)}"></span></span>
              <span class="sim-value">${String(rec.percent)}%</span>
            </div>
            <p class="small dim" style="margin-bottom:var(--space-2)">${rec.reason}</p>
            <div class="match-detail">${raw(catRows)}</div>
          </div>
        `;
      })
      .join('');

    const others = recResult.candidates.filter((c) => !recs.includes(c)).slice(0, 6);

    return html`
      <div class="card no-print" style="margin-top:var(--space-4)">
        <div class="section-title"><span class="num">◎</span>匹配明细（为什么是这几本）</div>
        <p class="small muted">
          按需求文档的推荐逻辑，优先比对「诡计类」重合度，其次比对「叙事类」与「场景类」。
          灰色标签表示目标作品有、候选作品没有。相似度为绝对口径（与该书标签完全一致 = 100%）。
        </p>
        ${raw(rows)}

        ${others.length
          ? raw(html`
              <details style="margin-top:var(--space-4)">
                <summary class="dim small" style="cursor:pointer">其他候选（相似度较低或受多样性约束）</summary>
                <ul class="small muted" style="margin-top:var(--space-2);padding-left:1.2em">
                  ${others.map(
                    (o) => raw(html`
                      <li>
                        《${o.book.title}》— ${o.book.author}
                        <span class="tnum">${String(o.percent)}%</span>
                        ${o.dropped ? raw(html`<span class="muted">（${o.dropped}）</span>`) : ''}
                      </li>
                    `),
                  )}
                </ul>
              </details>
            `)
          : ''}

        ${excluded.length
          ? raw(html`
              <details style="margin-top:var(--space-3)">
                <summary class="dim small" style="cursor:pointer">已排除 ${String(excluded.length)} 部作品</summary>
                <ul class="small muted" style="margin-top:var(--space-2);padding-left:1.2em">
                  ${excluded.slice(0, 12).map((e) => raw(html`<li>《${e.book.title}》— ${e.reason}</li>`))}
                </ul>
              </details>
            `)
          : ''}
      </div>
    `;
  }

  /* ---------------- 报告动作 ---------------- */

  async function handleAction(action) {
    const r = state.result;
    if (!action || !r) return;

    if (action === 'copy') {
      if (!r.selfCheck.passed) {
        toast('反剧透自检未通过，已拦截复制。请先修正书籍资料。', { type: 'error', title: '已拦截' });
        return;
      }
      const ok = await copyText(r.copyMarkdown);
      toast(ok ? '已复制到剪贴板（可直接粘贴到任何 Markdown 编辑器）' : '复制失败，请手动选择报告内容', {
        type: ok ? 'ok' : 'error',
      });
      return;
    }

    if (action === 'download') {
      if (!r.selfCheck.passed) {
        toast('反剧透自检未通过，已拦截导出。', { type: 'error', title: '已拦截' });
        return;
      }
      download(safeFilename(`${r.book.title}-诡计标签分析`), r.markdown, 'text/markdown;charset=utf-8');
      toast('已导出 Markdown 文件', { type: 'ok' });
      return;
    }

    if (action === 'print') {
      if (!r.selfCheck.passed) {
        toast('反剧透自检未通过，已拦截打印。', { type: 'error', title: '已拦截' });
        return;
      }
      window.print();
      return;
    }

    if (action === 'save') {
      try {
        const book = { ...r.book, id: store.nextId('user'), origin: 'user', recommendable: false };
        const saved = await store.save(book);
        toast(`《${saved.title}》已存入知识库（标记为自建条目，默认不参与公共推荐）`, {
          type: 'ok',
          title: '保存成功',
          duration: 5200,
        });
      } catch (error) {
        toast(String(error.message ?? error), { type: 'error', title: '保存失败' });
      }
    }
  }

  /* ---------------- 事件绑定 ---------------- */

  cleanups.push(
    onAll(qsa('[data-mode]'), 'click', (event) => setMode(event.currentTarget.dataset.mode)),
  );
  cleanups.push(onAll(searchEl, 'input', () => renderList(searchEl.value)));
  cleanups.push(
    onAll(qs('#quick-tags'), 'click', (event) => {
      const value = event.target.closest?.('[data-quick]')?.dataset.quick;
      if (!value) return;
      searchEl.value = value;
      renderList(value);
      searchEl.focus();
    }),
  );
  cleanups.push(
    onAll(resultsEl, 'click', (event) => {
      const item = event.target.closest?.('[data-id]');
      if (!item) return;
      state.selectedId = item.dataset.id;
      for (const el of qsa('.result-item', resultsEl)) {
        el.setAttribute('aria-selected', String(el === item));
      }
      updateRunState();
      analyze(); // 单击即分析，减少一次点击
    }),
  );
  cleanups.push(
    onAll(summaryEl, 'input', () => {
      updateSummaryCounter();
      runSuggest();
    }),
  );
  cleanups.push(
    onAll(qs('#c-title'), 'input', (event) => {
      state.custom.title = event.target.value;
      updateRunState();
    }),
  );
  cleanups.push(onAll(qs('#c-author'), 'input', (event) => {
    state.custom.author = event.target.value;
  }));
  cleanups.push(onAll(qs('#c-custom-tags'), 'input', (event) => {
    state.custom.customTags = event.target.value;
  }));
  cleanups.push(
    onAll(qs('#suggest-list'), 'change', (event) => {
      const id = event.target.dataset?.suggest;
      if (!id) return;
      const set = setForCustom(id);
      if (event.target.checked) set.add(id);
      else set.delete(id);
      event.target.closest?.('.tag-option')?.setAttribute('data-checked', String(event.target.checked));
      updateRunState();
    }),
  );
  cleanups.push(
    onAll(qs('#manual-tags'), 'change', (event) => {
      const id = event.target.dataset?.manual;
      if (!id) return;
      const set = setForCustom(id);
      if (event.target.checked) set.add(id);
      else set.delete(id);
      event.target.closest?.('.tag-option')?.setAttribute('data-checked', String(event.target.checked));
      updateRunState();
    }),
  );
  cleanups.push(onAll(runBtn, 'click', analyze));
  cleanups.push(
    onAll(qs('#reset-btn'), 'click', () => {
      state.selectedId = null;
      state.custom = { title: '', author: '', safeSummary: '', tags: new Set(), schoolTags: new Set(), customTags: '' };
      state.result = null;
      for (const sel of ['#c-title', '#c-author', '#c-custom-tags', '#c-summary', '#book-search']) {
        const el = qs(sel);
        if (el) el.value = '';
      }
      updateSummaryCounter();
      qs('#suggest-area')?.classList.add('hidden');
      const manual = qs('#manual-tags');
      if (manual) manual.innerHTML = '';
      renderList('');
      renderReportArea();
      updateRunState();
      toast('已重置输入', { type: 'info', duration: 1600 });
    }),
  );
  cleanups.push(
    onAll(reportArea, 'click', (event) => {
      const action = event.target.closest?.('[data-action]')?.dataset.action;
      if (action) void handleAction(action);
    }),
  );

  /**
   * 响应同一路由下的 hash 参数变化。
   *
   * 场景：用户在「书籍档案」页点「生成报告」→ #/analyze?id=xxx。
   * 此时路由名没变（仍是 analyze），app.js 不会重新渲染视图，
   * 若不监听 hashchange，页面会停留在旧状态，看起来像"链接点了没反应"。
   */
  const onHashChange = () => {
    const next = new URLSearchParams(location.hash.split('?')[1] ?? '').get('id');
    if (!next || next === state.selectedId) return;
    if (!store.get(next)) return;
    state.selectedId = next;
    setMode('library');
    if (searchEl) searchEl.value = '';
    renderList('');
    analyze();
  };
  window.addEventListener('hashchange', onHashChange);
  cleanups.push(() => window.removeEventListener('hashchange', onHashChange));

  /* ---------------- 初始化 ---------------- */

  renderList('');
  renderQuickTags();
  updateSummaryCounter();
  setMode('library');

  if (state.selectedId && store.get(state.selectedId)) analyze();

  return () => {
    for (const off of cleanups) off?.();
  };
}

/* ------------------------------------------------------------------ */
/* 辅助                                                               */
/* ------------------------------------------------------------------ */

/** 统计每个标签被多少部作品使用，用于推荐标签与手动标签的排序 */
function buildTagStats(books) {
  const map = new Map();
  for (const book of books) for (const id of bookTagIds(book)) map.set(id, (map.get(id) ?? 0) + 1);
  return map;
}
