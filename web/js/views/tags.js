/**
 * 视图：标签体系
 * 展示标签字典（类别 / 权重 / 释义 / 别名 / 收录数量），并给出共现矩阵辅助理解推荐依据。
 */

import { TAG_CATEGORIES, TAGS, tagCategory, tagLabel } from '../core/tags.js';
import { bookTagIds, tagCooccurrence } from '../core/engine.js';
import { html, qs, raw } from '../ui/dom.js';

export const meta = { title: '标签体系' };

const MATRIX_SIZE = 14;

export async function render(ctx) {
  const { main, store } = ctx;
  const books = store.all();
  const stats = tagCooccurrence(books);
  const countMap = new Map(stats.map((s) => [s.tag, s.books.length]));

  const specTags = TAGS.filter((t) => t.spec);
  const extTags = TAGS.filter((t) => !t.spec);

  const topTags = stats.slice(0, MATRIX_SIZE).map((s) => s.tag);

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">Tag Taxonomy</span>
      <h1>标签体系</h1>
      <p class="lede">
        标签分为 <strong>诡计类、叙事类、场景类、动机类</strong> 四个来自需求文档的类别，另加一个用于兜底的
        <strong>氛围题材类</strong>。推荐算法按类别权重加权：<code>诡计 3.0</code> &gt; <code>叙事 1.6</code> &gt;
        <code>场景 1.0</code> = <code>动机 1.0</code> &gt; <code>题材 0.5</code>，确保推荐作品在
        <strong>诡计机制层面</strong>高度相似。
      </p>
    </div>

    <div class="grid grid-4 mb-5">
      ${TAG_CATEGORIES.map(
        (c) => html`
          <div class="stat-tile">
            <div class="v">${String([...countMap.keys()].filter((id) => tagCategory(id) === c.id).length)}</div>
            <div class="k">${c.label} · 权重 ${String(c.weight)}</div>
          </div>
        `,
      )}
    </div>

    <div class="card mb-5">
      <div class="section-title"><span class="num">◎</span>高频标签云</div>
      <p class="small muted">数字为该标签在当前知识库中的收录数量。点击标签可跳转到知识库筛选结果。</p>
      <div class="tag-cloud" id="tag-cloud">
        ${stats
          .slice(0, 48)
          .map(
            (s) => html`
              <a class="tag-chip" href="#/library?tag=${encodeURIComponent(s.tag)}">
                ${s.label}<span class="n">${String(s.books.length)}</span>
              </a>
            `,
          )}
      </div>
    </div>

    <div class="card mb-5">
      <div class="section-title"><span class="num">▦</span>标签共现矩阵（推荐依据可视化）</div>
      <p class="small muted">
        行与列为知识库中收录最多的 ${String(topTags.length)} 个标签，单元格中的 <span class="cell-hit">n</span>
        表示同时具备这两个标签的作品数量。数值越大，说明这两类诡计/风格在推理小说中越常同时出现，
        也是推荐算法的重要信号。
      </p>
      <div class="matrix-scroll" id="matrix"></div>
    </div>

    ${TAG_CATEGORIES.map(
      (cat) => html`
        <div class="card mb-4">
          <div class="section-title">
            <span class="num">${String(cat.specOrder ?? '')}</span>${cat.label}
            <span class="small muted" style="font-weight:400">权重 ${String(cat.weight)} · ${cat.en}</span>
          </div>
          <p class="small muted">${cat.description}</p>
          <div class="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style="width:130px">标签</th>
                  <th>无剧透释义（只说明类型，不说明内容）</th>
                  <th style="width:90px">收录</th>
                  <th style="width:170px">别名 / 容错写法</th>
                </tr>
              </thead>
              <tbody>
                ${TAGS.filter((t) => t.category === cat.id)
                  .map(
                    (t) => html`
                      <tr>
                        <td>
                          <span class="badge badge-${cat.id}">${t.label}</span>
                          ${t.spec
                            ? raw('<div class="small muted" style="margin-top:2px">需求文档标签</div>')
                            : raw('<div class="small muted" style="margin-top:2px">系统扩展</div>')}
                        </td>
                        <td>
                          ${t.desc}
                          <div class="small muted mono" style="margin-top:2px">id: ${t.id}</div>
                        </td>
                        <td class="num">
                          ${
                            // 两个分支都必须是可信 HTML：分支里写普通字符串会被 html`` 转义，
                            // 页面上就会显示出 <span class="muted">0 部</span> 的源码。
                            countMap.get(t.id)
                              ? html`<a href="#/library?tag=${encodeURIComponent(t.id)}">${String(countMap.get(t.id))} 部</a>`
                              : html`<span class="muted">0 部</span>`
                          }
                        </td>
                        <td class="small muted">${(t.aliases ?? []).join('、') || '—'}</td>
                      </tr>
                    `,
                  )}
              </tbody>
            </table>
          </div>
        </div>
      `,
    )}

    <div class="card">
      <div class="section-title"><span class="num">Σ</span>标签统计</div>
      <div class="grid grid-3">
        <div class="stat-tile"><div class="v">${String(TAGS.length)}</div><div class="k">标签总数</div></div>
        <div class="stat-tile"><div class="v">${String(specTags.length)}</div><div class="k">需求文档原生标签</div></div>
        <div class="stat-tile"><div class="v">${String(extTags.length)}</div><div class="k">系统扩展标签</div></div>
        <div class="stat-tile"><div class="v">${String(books.length)}</div><div class="k">已标注作品</div></div>
        <div class="stat-tile"><div class="v">${String(stats.length)}</div><div class="k">实际使用中的标签</div></div>
        <div class="stat-tile">
          <div class="v">${String(books.filter((b) => bookTagIds(b).length).length ? Math.round((books.reduce((s, b) => s + bookTagIds(b).length, 0) / Math.max(1, books.length)) * 10) / 10 : 0)}</div>
          <div class="k">平均标签数 / 部</div>
        </div>
      </div>
    </div>
  `;

  renderMatrix();

  function renderMatrix() {
    const tags = topTags;
    const sets = tags.map((id) => new Set(stats.find((s) => s.tag === id)?.books ?? []));

    const head = tags
      .map((id) => html`<th title="${tagLabel(id)}" style="writing-mode:vertical-rl;text-orientation:mixed;padding:var(--space-2) 4px;font-weight:600">${tagLabel(id)}</th>`)
      .join('');

    const body = tags
      .map((rowId, i) => {
        const cells = tags
          .map((colId, j) => {
            const size = stats.find((s) => s.tag === colId)?.books.length ?? 0;
            const shared = [...sets[i]].filter((b) => sets[j].has(b)).length;
            const ratio = size ? shared / size : 0;
            return html`<td
              class="num ${shared ? 'cell-hit' : 'cell-miss'}"
              style="text-align:center;opacity:${String(Math.max(0.18, ratio).toFixed(2))}"
              title="${tagLabel(rowId)} × ${tagLabel(colId)}：${String(shared)} 部"
            >${String(shared || '·')}</td>`;
          })
          .join('');
        return html`<tr><th style="text-align:left">${tagLabel(rowId)}</th>${raw(cells)}</tr>`;
      })
      .join('');

    qs('#matrix').innerHTML = html`
      <table>
        <thead>
          <tr><th></th>${raw(head)}</tr>
        </thead>
        <tbody>
          ${raw(body)}
        </tbody>
      </table>
    `;
  }

  return () => {};
}
