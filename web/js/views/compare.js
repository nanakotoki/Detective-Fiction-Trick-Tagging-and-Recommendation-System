/**
 * 视图：作品对比
 * 直接对两本书做标签级差异分析，用来回答"为什么系统把这两本排在一起"。
 * 全部输出都是类型级信息，不涉及任何谜底。
 */

import { TAG_CATEGORIES, tagCategory, tagLabel } from '../core/tags.js';
import { bookTagIds, buildIdf, findBackgroundTags, scorePair, toPercent } from '../core/engine.js';
import { analyzeRecommendation } from '../core/safety.js';
import { esc, html, qs, raw, toast, copyText } from '../ui/dom.js';

export const meta = { title: '作品对比' };

export async function render(ctx) {
  const { main, store, route } = ctx;
  const all = store.all();

  const state = {
    leftId: route.params.a ?? all[0]?.id ?? '',
    rightId: route.params.b ?? all[1]?.id ?? '',
  };

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">Compare</span>
      <h1>作品对比</h1>
      <p class="lede">
        选择两部作品，查看它们在<strong>诡计类型、叙事结构、场景与动机</strong>上的标签级差异。
        这个视图也是推荐算法的"解释器"——推荐明细里的共享标签，就是在这里算出来的。
      </p>
    </div>

    <div class="card mb-4">
      <div class="grid grid-2">
        <div class="field" style="margin-bottom:0">
          <label for="cmp-a">作品 A</label>
          <select id="cmp-a">
            ${all.map((b) => raw(html`<option value="${b.id}" ${b.id === state.leftId ? 'selected' : ''}>《${b.title}》— ${b.author}</option>`))}
          </select>
        </div>
        <div class="field" style="margin-bottom:0">
          <label for="cmp-b">作品 B</label>
          <select id="cmp-b">
            ${all.map((b) => raw(html`<option value="${b.id}" ${b.id === state.rightId ? 'selected' : ''}>《${b.title}》— ${b.author}</option>`))}
          </select>
        </div>
      </div>
      <div class="btn-row" style="margin-top:var(--space-4)">
        <button type="button" class="btn btn-sm" id="cmp-swap">交换 A / B</button>
        <button type="button" class="btn btn-sm" id="cmp-copy">复制对比结论</button>
        <span class="small muted ml-auto" id="cmp-hint"></span>
      </div>
    </div>

    <div id="cmp-result"></div>
  `;

  function compute() {
    const a = store.get(state.leftId);
    const b = store.get(state.rightId);
    if (!a || !b) return null;

    const idf = buildIdf(all).idf;
    const background = findBackgroundTags(all);
    const detail = scorePair(bookTagIds(a), bookTagIds(b), { idf, background });
    const reason = `核心诡计同属 ${detail.trickMatched.slice(0, 3).map((t) => `\`${tagLabel(t)}\``).join(' ')} 机制。`;
    const safety = analyzeRecommendation({ reason, tags: detail.matched, book: b, target: a });

    // 与推荐引擎使用同一套绝对归一化，保证两个页面的相似度口径一致
    const percent = toPercent(detail.rawScore, bookTagIds(a), { background, idf });

    return { a, b, detail, percent, safety };
  }

  function renderResult() {
    const result = compute();
    const container = qs('#cmp-result');
    const hint = qs('#cmp-hint');

    if (!result) {
      container.innerHTML = html`<div class="card"><div class="empty"><h3>请选择两部作品</h3></div></div>`;
      return;
    }

    const { a, b, detail, percent } = result;
    const aTags = bookTagIds(a);
    const bTags = bookTagIds(b);

    hint.textContent = `A 有 ${String(aTags.length)} 个标签，B 有 ${String(bTags.length)} 个标签，共享 ${String(detail.matched.length)} 个`;

    const verdict =
      percent >= 75 && detail.trickMatched.length >= 2
        ? { level: 'high', text: '诡计机制高度同构', cls: 'badge-ok' }
        : percent >= 58 && detail.trickMatched.length >= 1
          ? { level: 'medium', text: '核心诡计有重合，整体较为相似', cls: 'badge-low' }
          : detail.trickMatched.length === 0
            ? { level: 'low', text: '诡计类型无重合，相似度主要来自场景或题材', cls: 'badge-medium' }
            : { level: 'low', text: '部分标签重合，属于风格层面的相近', cls: 'badge' };

    const catRows = TAG_CATEGORIES.filter((c) => detail.byCategory[c.id]?.targetCount || detail.byCategory[c.id]?.matchedCount)
      .map((c) => {
        const info = detail.byCategory[c.id];
        const onlyB = bTags.filter((id) => tagCategory(id) === c.id && !aTags.includes(id));
        return html`
          <tr>
            <th style="width:110px"><span class="badge badge-${c.id}">${c.label}</span></th>
            <td>
              ${
                // 分支里若直接写普通 HTML 字符串，会被 html`` 转义成源码显示；
                // 统一用 html`` 生成，两个分支都保持可信标记。
                info.matched.length
                  ? html`${info.matched.map((id) => html`<span class="badge badge-${c.id}">${tagLabel(id)}</span>`)}`
                  : html`<span class="muted small">无共享</span>`
              }
              ${
                info.missing.length
                  ? html`<div class="small muted" style="margin-top:4px">仅 A 有：${info.missing.map((id) => tagLabel(id)).join('、')}</div>`
                  : ''
              }
              ${
                onlyB.length
                  ? html`<div class="small muted" style="margin-top:2px">仅 B 有：${onlyB.map((id) => tagLabel(id)).join('、')}</div>`
                  : ''
              }
            </td>
          </tr>
        `;
      })
      .join('');

    container.innerHTML = html`
      <div class="card mb-4">
        <div class="section-title"><span class="num">Σ</span>相似度结论</div>
        <div style="display:flex;gap:var(--space-4);align-items:center;flex-wrap:wrap;margin-bottom:var(--space-4)">
          <div style="font-size:2.2rem;font-family:var(--font-serif);font-weight:700;color:var(--accent);line-height:1">
            ${String(percent)}%
          </div>
          <div>
            <span class="badge ${verdict.cls}">${verdict.text}</span>
            <p class="small muted" style="margin:var(--space-1) 0 0">
              加权重合度 ${(detail.weightedOverlap * 100).toFixed(1)}% ·
              加权杰卡德 ${(detail.jaccard * 100).toFixed(1)}% ·
              稀有度 ${(detail.rarity * 100).toFixed(1)}%
            </p>
          </div>
        </div>
        <div class="sim-row">
          <span>加权相似度</span>
          <span class="sim-bar"><span style="width:${String(percent)}%"></span></span>
          <span class="sim-value">${String(percent)}%</span>
        </div>
      </div>

      <div class="card mb-4">
        <div class="section-title"><span class="num">≡</span>标签级差异</div>
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>类别（权重）</th>
                <th>共享 / 差异</th>
              </tr>
            </thead>
            <tbody>
              ${raw(catRows)}
            </tbody>
          </table>
        </div>
        <p class="small muted" style="margin-top:var(--space-3)">
          类别权重：${TAG_CATEGORIES.map((c) => `${c.label} ${String(c.weight)}`).join(' · ')}。
          共享标签越集中在「诡计类」，说明两本书的谜团设计逻辑越接近。
        </p>
      </div>

      <div class="card mb-4">
        <div class="section-title"><span class="num">◎</span>反剧透校验</div>
        ${
          result.safety.passed
            ? raw('<div class="notice notice-ok" style="margin-bottom:0"><strong>通过</strong><p class="small" style="margin:0">本次对比结论仅涉及标签类型，未检出具底风险。</p></div>')
            : raw(html`
                <div class="notice notice-warn" style="margin-bottom:0">
                  <strong>有 ${String(result.safety.findings.length)} 条提示</strong>
                  <ul class="small" style="margin:var(--space-2) 0 0;padding-left:1.2em">
                    ${result.safety.findings.map((f) => raw(html`<li>${f.excerpt} —— ${f.hint}</li>`))}
                  </ul>
                </div>
              `)
        }
      </div>
    `;
  }

  /* ---------------- 事件 ---------------- */

  const cleanups = [];
  const on = (target, event, handler) => {
    target?.addEventListener(event, handler);
    cleanups.push(() => target?.removeEventListener(event, handler));
  };

  on(qs('#cmp-a'), 'change', (event) => {
    state.leftId = event.target.value;
    renderResult();
  });
  on(qs('#cmp-b'), 'change', (event) => {
    state.rightId = event.target.value;
    renderResult();
  });
  on(qs('#cmp-swap'), 'click', () => {
    [state.leftId, state.rightId] = [state.rightId, state.leftId];
    qs('#cmp-a').value = state.leftId;
    qs('#cmp-b').value = state.rightId;
    renderResult();
  });
  on(qs('#cmp-copy'), 'click', async () => {
    const result = compute();
    if (!result) return;
    const { a, b, detail, percent } = result;
    const md = [
      `# 作品对比：${a.title} × ${b.title}`,
      '',
      `- 加权相似度：${String(percent)}%`,
      `- 共享标签：${detail.matched.length ? detail.matched.map((id) => `\`${tagLabel(id)}\``).join(' ') : '无'}`,
      `- 诡计类共享：${detail.trickMatched.length ? detail.trickMatched.map((id) => `\`${tagLabel(id)}\``).join(' ') : '无'}`,
      `- 叙事类共享：${detail.narrativeMatched.length ? detail.narrativeMatched.map((id) => `\`${tagLabel(id)}\``).join(' ') : '无'}`,
      `- 场景类共享：${detail.sceneMatched.length ? detail.sceneMatched.map((id) => `\`${tagLabel(id)}\``).join(' ') : '无'}`,
      `- 动机类共享：${detail.motiveMatched.length ? detail.motiveMatched.map((id) => `\`${tagLabel(id)}\``).join(' ') : '无'}`,
      '',
      '> 以上仅为诡计类型与结构风格的比较，不涉及任何一本的谜底。',
    ].join('\n');

    const ok = await copyText(md);
    toast(ok ? '对比结论已复制' : '复制失败', { type: ok ? 'ok' : 'error' });
  });

  renderResult();

  return () => {
    for (const off of cleanups) off?.();
  };
}
