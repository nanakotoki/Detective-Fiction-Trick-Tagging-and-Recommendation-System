/**
 * 视图：添加 / 编辑小说
 * =====================
 * 动态扩充知识库的入口。表单在提交前做两层校验：
 *   1. 结构校验（必填项、字数上限、标签合法性）
 *   2. 反剧透校验（复用 safety.js 的规则引擎，实时提示）
 *
 * 「谜底保险库」区块用虚线框隔离，明确告知用户：这里写的内容永远不会出现在
 * 任何界面、推荐或导出文件中——从设计上让剧透无处可去。
 */

import { TAG_CATEGORIES, isSchoolTag, tagCategory, tagLabel } from '../core/tags.js';
import { bookTagIds } from '../core/engine.js';
import { splitAuthors } from '../core/seed.js';
import { analyzeBook, countChars } from '../core/safety.js';
import { html, qs, qsa, raw, toast, modal, esc } from '../ui/dom.js';

export const meta = { title: '添加小说' };

const PLATFORM_FIELDS = [
  { id: 'douban', label: '豆瓣', note: '10 分制，如 8.6' },
  { id: 'hupu', label: '虎扑', note: '10 分制；无数据请留空' },
  { id: 'goodreads', label: 'Goodreads', note: '5 分制，如 4.2' },
  { id: 'zhihu', label: '知乎', note: '推荐度，可填百分比或留空' },
  { id: 'weread', label: '微信读书', note: '推荐值，如 89.5%' },
];

const AS_OF = '2025-01';

export async function render(ctx) {
  const { main, store, navigate, route, updateStatus } = ctx;

  const editingId = route.params.id ? decodeURIComponent(route.params.id) : null;
  const editing = editingId ? store.get(editingId) : null;
  const isEdit = Boolean(editing);

  const state = {
    tags: new Set(editing?.tags ?? []),
    // 流派是独立维度：必须单独回填，否则编辑已有作品时复选框全是未勾选，
    // 一保存就把这部作品的流派标注抹掉了。
    schoolTags: new Set(editing?.schoolTags ?? []),
    customTags: (editing?.customTags ?? []).join('、'),
    ratings: { ...(editing?.ratings ?? {}) },
    vault: { culprit: '', coreTrick: '', ending: '', notes: '', ...(editing?.vault ?? {}) },
  };

  /** 某个标签 id 属于哪个勾选集合 */
  const setFor = (id) => (isSchoolTag(id) ? state.schoolTags : state.tags);

  const tagCounts = new Map();
  for (const book of store.all()) {
    // 用 bookTagIds 合并两个维度，否则流派在表单里显示的收录数恒为 0
    for (const id of bookTagIds(book)) tagCounts.set(id, (tagCounts.get(id) ?? 0) + 1);
  }

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">Contribute</span>
      <h1>${isEdit ? `编辑《${editing.title}》` : '添加一部推理小说'}</h1>
      <p class="lede">
        填写去剧透档案后，这部作品会立刻加入知识库，并可参与相似作品推荐。
        系统会在提交前自动做一次反剧透体检，<strong>存在泄底风险的表述会被拦截</strong>。
      </p>
    </div>

    ${isEdit
      ? ''
      : raw(html`
          <div class="notice notice-info">
            <strong>录入原则：只写「存在什么类型的诡计」，不写「这个诡计是什么」</strong>
            <p class="mb-0">
              简介里出现凶手、手法、结局，都会让这份数据失去价值——读者点开就是为了在不被剧透的前提下选书。
            </p>
          </div>
        `)}

    <form id="book-form" novalidate>
      <div class="split">
        <div>
          <!-- 基础信息 -->
          <div class="card mb-4">
            <div class="section-title"><span class="num">一</span>基础信息</div>

            <div class="field">
              <label for="f-title">书名<span class="required">*</span></label>
              <input type="text" id="f-title" name="title" required value="${editing?.title ?? ''}" />
            </div>

            <div class="field">
              <label for="f-original">原书名（选填）</label>
              <input type="text" id="f-original" name="originalTitle" value="${editing?.originalTitle ?? ''}" />
            </div>

            <div class="grid grid-2" style="gap:0 var(--space-4)">
              <div class="field">
                <label for="f-author">作者<span class="required">*</span></label>
                <input type="text" id="f-author" name="author" required value="${
                  editing ? (Array.isArray(editing.authors) && editing.authors.length ? editing.authors.join('、') : editing.author) : ''
                }" placeholder="多位作者用「、」分隔，如：马伊·舍瓦尔、佩尔·瓦勒" />
              </div>
              <div class="field">
                <label for="f-genre">流派</label>
                <input type="text" id="f-genre" name="genre" list="genre-list" value="${editing?.genre ?? ''}" placeholder="本格推理 / 社会派 / 新本格 / 硬汉派…" />
                <datalist id="genre-list">
                  <option value="本格推理"></option>
                  <option value="新本格"></option>
                  <option value="社会派"></option>
                  <option value="硬汉派"></option>
                  <option value="变格"></option>
                  <option value="青春推理"></option>
                  <option value="犯罪悬疑"></option>
                  <option value="日常之谜"></option>
                </datalist>
              </div>
              <div class="field">
                <label for="f-year">首次出版</label>
                <input type="text" id="f-year" name="firstPublished" value="${editing?.firstPublished ?? ''}" placeholder="如 1948" />
              </div>
              <div class="field">
                <label for="f-country">国家 / 地区</label>
                <input type="text" id="f-country" name="country" value="${editing?.country ?? ''}" placeholder="日本 / 英国 / 中国…" />
              </div>
              <div class="field">
                <label for="f-series">系列（选填）</label>
                <input type="text" id="f-series" name="series" value="${editing?.series ?? ''}" placeholder="如 金田一耕助系列" />
              </div>
              <div class="field">
                <label for="f-detective">系列主角（选填）</label>
                <input type="text" id="f-detective" name="detective" value="${editing?.detective ?? ''}" />
              </div>
            </div>
          </div>

          <!-- 平台评价 -->
          <div class="card mb-4">
            <div class="section-title"><span class="num">五</span>平台评价参考</div>
            <p class="small muted">
              只填你确实掌握的公开数据。没有数据就留空，报告里会显示「暂无数据」——<strong>编造评分比没有评分更糟</strong>。
            </p>

            ${PLATFORM_FIELDS.map((p) => {
              const entry = state.ratings[p.id] ?? {};
              return html`
                <div class="field" data-platform="${p.id}">
                  <label for="f-r-${p.id}">${p.label} <span class="muted small" style="font-weight:400">${p.note}</span></label>
                  <input type="text" id="f-r-${p.id}" data-rating-score="${p.id}" value="${entry.score ?? ''}" placeholder="留空表示暂无数据" style="margin-bottom:var(--space-2)" />
                  <textarea data-rating-summary="${p.id}" placeholder="去剧透评价摘要，如：多数读者认为…；部分读者指出…（不要转述任何情节谜底）" style="min-height:64px">${entry.summary && entry.summary !== '暂无数据' ? entry.summary : ''}</textarea>
                </div>
              `;
            })}
          </div>

          <!-- 谜底保险库 -->
          <div class="card mb-4">
            <div class="section-title"><span class="num">🔒</span>谜底保险库（可选，永不输出）</div>
            <div class="vault-block">
              <div class="vault-head"><span class="vault-lock" aria-hidden="true">🔒</span>这里的任何内容都不会出现在界面、报告或导出文件中</div>
              <p class="small muted">
                如果你希望为将来「已读完」的自己留一份记录，可以写在这里。系统在渲染、导出、API 返回等所有环节
                都会剥离这一段数据；服务器模式下它也只保存在本机 <code>server/data/books.json</code>，不随 API 下发。
              </p>
              <div class="field">
                <label for="f-v-culprit">凶手 / 关键人物</label>
                <input type="text" id="f-v-culprit" data-vault="culprit" value="${state.vault.culprit}" placeholder="留空即可" />
              </div>
              <div class="field">
                <label for="f-v-trick">诡计核心解法</label>
                <textarea id="f-v-trick" data-vault="coreTrick" style="min-height:64px" placeholder="留空即可">${state.vault.coreTrick}</textarea>
              </div>
              <div class="field">
                <label for="f-v-ending">结局</label>
                <textarea id="f-v-ending" data-vault="ending" style="min-height:64px" placeholder="留空即可">${state.vault.ending}</textarea>
              </div>
              <div class="field" style="margin-bottom:0">
                <label for="f-v-notes">其他笔记</label>
                <textarea id="f-v-notes" data-vault="notes" style="min-height:64px" placeholder="留空即可">${state.vault.notes}</textarea>
              </div>
            </div>
          </div>
        </div>

        <!-- 右列 -->
        <div>
          <div class="card mb-4">
            <div class="section-title"><span class="num">二</span>诡计标签</div>
            <p class="small muted">至少选择 1 个「诡计类」标签，推荐质量直接取决于标注质量。</p>
            ${TAG_CATEGORIES.map(
              (cat) => html`
                <div class="cat-block">
                  <div class="cat-title">
                    ${cat.label}
                    <span class="weight">权重 ${String(cat.weight)}</span>
                  </div>
                  <div class="tag-picker">
                    ${[...tagCounts.keys()]
                      .filter((id) => tagCategory(id) === cat.id)
                      .sort((a, b) => (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0))
                      .map(
                        (id) => html`
                          <label class="tag-option" data-checked="${setFor(id).has(id)}" title="${esc(id)}">
                            <input type="checkbox" data-tag="${id}" ${setFor(id).has(id) ? 'checked' : ''} />
                            ${tagLabel(id)}
                            <span class="count">${String(tagCounts.get(id) ?? 0)}</span>
                          </label>
                        `,
                      )}
                  </div>
                </div>
              `,
            )}

            <div class="field" style="margin-bottom:0">
              <label for="f-custom-tags">自定义标签（逗号或顿号分隔）</label>
              <input type="text" id="f-custom-tags" value="${state.customTags}" placeholder="例如：双胞胎诡计、动物视角" />
              <p class="hint">自定义标签会原样展示，但不参与相似度加权计算。</p>
            </div>
          </div>

          <div class="card mb-4">
            <div class="section-title"><span class="num">三</span>无剧透简介（100 字以内）</div>
            <div class="field" style="margin-bottom:var(--space-2)">
              <textarea id="f-summary" name="safeSummary" style="min-height:120px" placeholder="只写故事设定与悬念：谁在什么处境下遇到什么怪事。不要写凶手、手法、结局。">${editing?.safeSummary ?? ''}</textarea>
              <p class="hint"><span class="counter" id="f-summary-count">0 / 100 字</span></p>
            </div>
          </div>

          <div class="card mb-4">
            <div class="section-title"><span class="num">六</span>阅读提示</div>
            <div class="field">
              <label for="f-suitable">适合的读者（每行一条）</label>
              <textarea id="f-suitable" style="min-height:64px" placeholder="喜欢封闭空间群像案件的读者">${(editing?.readingTips?.suitableFor ?? []).join('\n')}</textarea>
            </div>
            <div class="field">
              <label for="f-watch">建议留意的观察维度（每行一条，只写维度不写答案）</label>
              <textarea id="f-watch" style="min-height:64px" placeholder="童谣文本与事件发生的先后顺序">${(editing?.readingTips?.watchFor ?? []).join('\n')}</textarea>
            </div>
            <div class="field" style="margin-bottom:0">
              <label for="f-warning">特别提醒</label>
              <textarea id="f-warning" style="min-height:64px" placeholder="本书存在叙述层面的设计，请留意叙述者本身。">${editing?.readingTips?.warning ?? ''}</textarea>
            </div>
          </div>

          <!-- 实时体检 -->
          <div class="card mb-4" id="audit-card">
            <div class="section-title" style="font-size:1rem"><span class="num">◎</span>反剧透实时体检</div>
            <div id="audit-result">
              <p class="small muted mb-0">开始填写后，这里会实时显示体检结果。</p>
            </div>
          </div>

          <div class="card tight">
            <div class="btn-row">
              <button type="submit" class="btn btn-primary">${isEdit ? '保存修改' : '加入知识库'}</button>
              <button type="button" class="btn btn-ghost" id="f-cancel">取消</button>
              ${isEdit && (editing.origin ?? 'seed') !== 'seed'
                ? raw(html`<button type="button" class="btn btn-ghost btn-danger ml-auto" id="f-delete">删除该条目</button>`)
                : ''}
            </div>
            <p class="small muted" style="margin:var(--space-3) 0 0" id="f-mode-hint"></p>
          </div>
        </div>
      </div>
    </form>
  `;

  /* ---------------- 表单取值 ---------------- */

  const form = qs('#book-form');
  const summaryEl = qs('#f-summary');
  const countEl = qs('#f-summary-count');

  /**
   * 读取带 data-* 标记的输入框。
   * 这里刻意不直接链式调用 `.value`：若某个字段的节点缺失（模板改动、
   * 浏览器扩展干扰、DOM 被外部改写），整张表单会直接抛异常而完全无法提交。
   * 取不到就返回空字符串，让"该字段没填"而不是"整个表单崩掉"。
   */
  function fieldValue(selector) {
    const el = qs(selector);
    return el && typeof el.value === 'string' ? el.value : '';
  }

  function collect() {
    const fd = new FormData(form);
    const ratings = {};
    for (const p of PLATFORM_FIELDS) {
      const scoreRaw = fieldValue(`[data-rating-score="${p.id}"]`).trim();
      const summaryRaw = fieldValue(`[data-rating-summary="${p.id}"]`).trim();
      if (!scoreRaw && !summaryRaw) continue;

      let score = null;
      if (scoreRaw) {
        const numeric = Number(scoreRaw.replace(/[%％]/g, ''));
        score = Number.isFinite(numeric) ? numeric : scoreRaw;
      }
      ratings[p.id] = {
        score,
        count: state.ratings[p.id]?.count ?? null,
        source: state.ratings[p.id]?.source ?? p.label,
        asOf: AS_OF,
        summary: summaryRaw || '暂无数据',
      };
    }

    const vault = {};
    for (const el of qsa('[data-vault]')) {
      if (el?.dataset?.vault) vault[el.dataset.vault] = String(el.value ?? '').trim();
    }

    return {
      id: editing?.id ?? store.nextId('user'),
      title: String(fd.get('title') ?? '').trim(),
      originalTitle: String(fd.get('originalTitle') ?? '').trim(),
      author: String(fd.get('author') ?? '').trim(),
      // 表单只用一个输入框：多位作者用「、」分隔。
      // 这里显式给出 authors 数组，保存后由 normalizeSeedBook 统一拆分与去重；
      // 单作者时 authors 与 author 内容一致，行为与改造前完全相同。
      authors: splitAuthors(String(fd.get('author') ?? '')),
      genre: String(fd.get('genre') ?? '').trim(),
      firstPublished: String(fd.get('firstPublished') ?? '').trim(),
      country: String(fd.get('country') ?? '').trim(),
      series: String(fd.get('series') ?? '').trim(),
      detective: String(fd.get('detective') ?? '').trim(),
      tags: [...state.tags],
      school: [...state.schoolTags],
      customTags: qs('#f-custom-tags')
        .value.split(/[,，、;；]/)
        .map((s) => s.trim())
        .filter(Boolean),
      safeSummary: summaryEl.value.trim(),
      ratings,
      readingTips: {
        suitableFor: lines(qs('#f-suitable').value),
        watchFor: lines(qs('#f-watch').value),
        warning: qs('#f-warning').value.trim(),
      },
      vault,
      origin: editing ? editing.origin ?? 'user' : 'user',
      recommendable: editing ? editing.recommendable !== false : false,
      verification: editing?.verification ?? { verified: false, verifiedAt: null, source: '用户提交' },
      provenance: {
        source: '用户录入',
        ratingsNote: '评分与摘要由用户录入，可能未经平台核对，请以各平台实时数据为准。',
      },
    };
  }

  function lines(text) {
    return String(text ?? '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  /* ---------------- 实时体检 ---------------- */

  function runAudit() {
    const book = collect();
    const report = analyzeBook(book);
    const summaryLen = countChars(book.safeSummary);

    countEl.textContent = `${String(summaryLen)} / 100 字`;
    countEl.className = `counter${summaryLen > 100 ? ' over' : summaryLen > 85 ? ' warn' : ''}`;

    const problems = [...report.issues];
    const structural = [];
    if (!book.title) structural.push({ text: '书名未填写', risk: 'high' });
    if (!book.author) structural.push({ text: '作者未填写', risk: 'high' });
    if (!book.tags.length) structural.push({ text: '尚未选择任何标签（请至少选 1 个诡计类标签）', risk: 'medium' });
    else if (!book.tags.some((t) => tagCategory(t) === 'trick')) {
      structural.push({ text: '尚未选择「诡计类」标签，推荐效果会明显下降', risk: 'medium' });
    }
    if (!book.safeSummary) structural.push({ text: '无剧透简介未填写，报告第三部分会显示「信息有限」', risk: 'low' });
    if (summaryLen > 100) structural.push({ text: `无剧透简介 ${String(summaryLen)} 字，超出 100 字上限`, risk: 'high' });

    const riskOrder = { high: 3, medium: 2, low: 1 };
    const items = [
      ...structural.map((s) => ({ kind: 'structure', text: s.text, risk: s.risk, hint: '' })),
      ...problems.map((p) => ({
        kind: 'spoiler',
        text: `${p.fieldLabel ?? p.field}：…${p.excerpt}…`,
        risk: p.risk,
        hint: p.hint,
        match: p.match,
      })),
    ].sort((a, b) => (riskOrder[b.risk] ?? 0) - (riskOrder[a.risk] ?? 0));

    const blockers = items.filter((i) => i.risk === 'high' || i.risk === 'medium');

    qs('#audit-result').innerHTML = blockers.length
      ? html`
          <div class="notice notice-${blockers.some((b) => b.risk === 'high') ? 'error' : 'warn'}" style="margin-bottom:0">
            <strong>${String(blockers.length)} 项需要处理</strong>
            <ul class="small" style="margin:var(--space-2) 0 0;padding-left:1.2em">
              ${blockers
                .slice(0, 8)
                .map(
                  (b) => html`
                    <li>
                      ${b.risk === 'high' ? '⛔' : '⚠️'} ${b.text}
                      ${b.hint ? raw(html`<br /><span class="muted">${b.hint}</span>`) : ''}
                    </li>
                  `,
                )}
            </ul>
          </div>
        `
      : html`
          <div class="notice notice-ok" style="margin-bottom:0">
            <strong>体检通过</strong>
            <p class="small" style="margin:0">
              未检出泄底或暗示性表述，标签结构完整。${report.passed ? '' : '（存在低风险提示，可自行确认）'}
            </p>
          </div>
        `;

    return { book, report, blockers };
  }

  /* ---------------- 事件 ---------------- */

  const cleanups = [];
  const on = (target, event, handler) => {
    target?.addEventListener(event, handler);
    cleanups.push(() => target?.removeEventListener(event, handler));
  };

  on(form, 'input', () => runAudit());
  on(form, 'change', (event) => {
    const tag = event.target.dataset?.tag;
    if (tag) {
      const set = setFor(tag);
      if (event.target.checked) set.add(tag);
      else set.delete(tag);
      event.target.closest('.tag-option').dataset.checked = String(event.target.checked);
    }
    runAudit();
  });

  on(qs('#f-cancel'), 'click', () => {
    if (editing) navigate(`book/${editing.id}`);
    else navigate('library');
  });

  on(qs('#f-delete'), 'click', async () => {
    if (!confirm(`确定删除《${editing.title}》吗？`)) return;
    try {
      await store.remove(editing.id);
      updateStatus();
      toast(`《${editing.title}》已删除`, { type: 'ok' });
      navigate('library');
    } catch (error) {
      toast(String(error.message ?? error), { type: 'error', title: '删除失败' });
    }
  });

  on(form, 'submit', async (event) => {
    event.preventDefault();
    const { book, blockers } = runAudit();
    const hardBlockers = blockers.filter((b) => b.risk === 'high');

    if (hardBlockers.length) {
      toast(`存在 ${String(hardBlockers.length)} 项高危问题（可能泄露谜底或格式不合规），已拦截提交。`, {
        type: 'error',
        title: '提交被拦截',
        duration: 6000,
      });
      return;
    }

    if (blockers.length) {
      const confirmed = await confirmDialog(
        '存在待确认项',
        html`
          <p>以下 ${String(blockers.length)} 项被标记为<b>需要确认</b>（非高危）：</p>
          <ul class="small">
            ${blockers.map((b) => html`<li>${b.text}</li>`)}
          </ul>
          <p class="small muted">系统无法百分之百判断这些表述是否构成暗示。确认无误后仍可入库，入库后条目会带有 ⚠ 标记。</p>
        `,
      );
      if (!confirmed) return;
    }

    try {
      const saved = await store.save(book);
      updateStatus();
      toast(`《${saved.title}》已${isEdit ? '保存' : '加入知识库'}`, {
        type: 'ok',
        title: isEdit ? '保存成功' : '录入成功',
        duration: 4200,
      });
      navigate(`book/${encodeURIComponent(saved.id)}`);
    } catch (error) {
      toast(String(error.message ?? error), { type: 'error', title: '保存失败', duration: 6000 });
    }
  });

  /* ---------------- 初始化 ---------------- */

  countEl.textContent = `${String(countChars(summaryEl.value))} / 100 字`;
  runAudit();

  const modeHint = qs('#f-mode-hint');
  modeHint.textContent =
    store.mode === 'api'
      ? '当前为服务器模式：提交后写入服务器知识库，所有访问者可见。'
      : '当前为本地模式：条目仅保存在本机浏览器（localStorage）。运行 npm start 启动后端即可共享。';

  return () => {
    for (const off of cleanups) off?.();
  };
}

/** 简单确认对话框 */
function confirmDialog(title, bodyHtml) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = (value) => {
      if (resolved) return;
      resolved = true;
      resolve(value);
    };
    const { close } = modal({
      title,
      body: bodyHtml,
      actions: [
        { label: '返回修改', variant: 'btn-ghost', onClick: () => finish(false) },
        { label: '确认无误，继续入库', variant: 'btn-primary', onClick: () => finish(true) },
      ],
    });
    // 关闭（Esc / 点击遮罩）视为取消
    const observer = new MutationObserver(() => {
      if (!document.body.contains(document.querySelector('.modal-backdrop'))) {
        observer.disconnect();
        finish(false);
      }
    });
    observer.observe(document.body, { childList: true });
    void close;
  });
}
