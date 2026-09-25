/**
 * 视图：书籍档案详情
 * 单本书的完整去剧透档案 + 即时相似作品推荐。
 */

import { TAG_CATEGORIES, tagCategory, tagLabel } from '../core/tags.js';
import { bookTagIds, recommend } from '../core/engine.js';
import { analyzeBook, RISK_META } from '../core/safety.js';
import { gateRecommendations, isSensitive } from '../core/sensitive.js';
import { collabLabel } from '../core/seed.js';
import { markdownToHtml, renderCopyMarkdown, renderReport } from '../core/report.js';
import { copyText, download, html, raw, safeFilename, toast } from '../ui/dom.js';

export const meta = { title: '书籍档案' };

export async function render(ctx) {
  const { main, store, route, navigate } = ctx;
  const id = decodeURIComponent(route.segments[1] ?? '');
  const book = store.get(id);

  if (!book) {
    main.innerHTML = html`
      <div class="view-header">
        <h1>未找到该作品</h1>
      </div>
      <div class="card">
        <div class="empty">
          <div class="icon" aria-hidden="true">🧭</div>
          <h3>知识库中没有 id 为「${id}」的作品</h3>
          <p>它可能已被删除。你可以返回知识库浏览，或把它添加进来。</p>
          <div class="btn-row" style="justify-content:center;margin-top:var(--space-4)">
            <a class="btn" href="#/library">返回知识库</a>
            <a class="btn btn-primary" href="#/manage">添加这部作品</a>
          </div>
        </div>
      </div>
    `;
    return;
  }

  const allIds = bookTagIds(book);
  const byCat = (cat) => allIds.filter((x) => tagCategory(x) === cat);
  const sensitive = isSensitive();

  // 敏感模式：先过呈现闸门，再渲染与复制。
  // 顺序不能反——先渲染再隐藏，标签仍会留在 DOM 里。
  const recResult = recommend(book, store.all(), { limit: 3, candidatePool: 8 });
  const shownResult = gateRecommendations(recResult);
  const audit = analyzeBook(book, { includeVault: true });
  const report = renderReport({ book, recommendations: shownResult.recommendations, options: { sensitive } });
  const copyMd = renderCopyMarkdown({ book, recommendations: shownResult.recommendations, options: { sensitive } });

  const ratings = book.ratings ?? {};
  const collab = collabLabel(book);
  const platformRows = [
    ['豆瓣（10 分制）', ratings.douban, 'douban'],
    ['虎扑（10 分制）', ratings.hupu, 'hupu'],
    ['Goodreads（5 分制）', ratings.goodreads, 'goodreads'],
    ['知乎（推荐度）', ratings.zhihu, 'zhihu'],
    ['微信读书（推荐值）', ratings.weread, 'weread'],
  ];

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">Book Profile</span>
      <h1>${book.title}</h1>
      <p class="lede">
        ${book.originalTitle ? `${book.originalTitle} · ` : ''}${book.author}
        ${book.firstPublished ? ` · 首次出版 ${book.firstPublished}` : ''}
        ${book.country ? ` · ${book.country}` : ''}
        ${
          // 多人协作的醒目标签：详情页是最需要看清「谁写的」的地方
          collab
            ? raw(html`<span class="badge badge-collab badge-collab-${collab.kind}" title="${collab.detail}"
                >${collab.kind === 'anthology' ? '👥' : '✍️'} ${collab.text}</span
              >`)
            : ''
        }
      </p>
    </div>

    <div class="report-toolbar no-print">
      <a class="btn btn-sm btn-primary" href="#/analyze?id=${encodeURIComponent(book.id)}">生成完整分析报告</a>
      <button type="button" class="btn btn-sm" data-action="copy">复制 Markdown</button>
      <button type="button" class="btn btn-sm" data-action="download">导出 .md</button>
      <a class="btn btn-sm" href="#/manage?id=${encodeURIComponent(book.id)}">编辑</a>
      ${(book.origin ?? 'seed') !== 'seed'
        ? raw(html`<button type="button" class="btn btn-sm btn-danger" data-action="delete">删除</button>`)
        : ''}
    </div>

    <div class="profile-layout">
      <div class="profile-main">
        <div class="card mb-4">
          <div class="section-title"><span class="num">一</span>基础信息</div>
          <div class="table-wrap">
            <table>
              <tbody>
                <tr><th style="width:120px">书名</th><td>${book.title}${book.originalTitle ? `（${book.originalTitle}）` : ''}</td></tr>
                ${
                  Array.isArray(book.alternateTitles) && book.alternateTitles.length
                    ? raw(
                        html`<tr>
                          <th>又名</th>
                          <td>
                            ${book.alternateTitles.join(' / ')}
                            <span class="small muted">（同一部作品的其他中文译名，搜索这些名字也能找到本书）</span>
                          </td>
                        </tr>`
                      )
                    : ''
                }
                <tr><th>作者</th><td>${book.author}${book.authorEn ? ` / ${book.authorEn}` : ''}</td></tr>
                <tr><th>流派</th><td>${book.genre || '—'}</td></tr>
                <tr><th>首次出版</th><td>${book.firstPublished || '—'}${book.country ? `（${book.country}）` : ''}</td></tr>
                ${
                  // 版本年与本库所引版本对应，与「首次出版」（作品原作年）是两件事，故单列一行。
                  // 只有两者不同、或首次出版缺失时才显示，免得同一部书的多数条目多出一行噪声。
                  book.editionYear && book.editionYear !== book.firstPublished
                    ? `<tr><th>版本年</th><td>${book.editionYear}（本库收录版本的出版年）</td></tr>`
                    : ''
                }
                <tr><th>系列</th><td>${
                  book.series
                    ? `${book.series}${book.detective ? ` · 主角：${book.detective}` : ''}`
                    : `非系列作品${
                        book.seriesDetail && book.seriesDetail !== '非系列'
                          ? `（原始标注：${book.seriesDetail}）`
                          : ''
                      }`
                }</td></tr>
                <tr><th>来源</th><td>
                  ${
                    book.origin === 'user'
                      ? '用户自建条目'
                      : book.origin === 'imported'
                        ? '导入条目'
                        : `内置知识库${book.seedFile ? `（${book.seedFile}）` : ''}`
                  }
                  ${book.updatedAt ? raw(html` · 更新于 ${new Date(book.updatedAt).toLocaleString('zh-CN')}`) : ''}
                </td></tr>
              </tbody>
            </table>
          </div>
        </div>

        <div class="card mb-4">
          <div class="section-title"><span class="num">二</span>诡计标签</div>
          ${
            sensitive
              ? raw(html`
                  <div class="notice notice-ok" style="margin-bottom:0">
                    <strong>本节已按你的设置隐藏</strong>
                    <p class="small" style="margin:0">
                      当前处于「敏感模式」：诡计标签与推理流派都不会显示，以免你在毫无准备的情况下读到类型信息。
                      如需查看，请点击页面顶部的开关切回「普通模式」。
                    </p>
                  </div>
                `)
              : raw(html`
                  ${TAG_CATEGORIES.filter((c) => byCat(c.id).length).map(
                    (c) => html`
                      <div class="cat-block">
                        <div class="cat-title">
                          ${c.label}
                          <span class="weight">权重 ${String(c.weight)} · ${c.description}</span>
                        </div>
                        <div class="tag-list">
                          ${byCat(c.id).map((tid) => html`<span class="badge badge-${c.id}">${tagLabel(tid)}</span>`)}
                        </div>
                      </div>
                    `,
                  )}
                  ${(book.customTags ?? []).length
                    ? html`
                        <div class="cat-block">
                          <div class="cat-title">自定义标签</div>
                          <div class="tag-list">
                            ${book.customTags.map((t) => html`<span class="badge">${t}</span>`)}
                          </div>
                        </div>
                      `
                    : ''}
                  ${!allIds.length && !(book.customTags ?? []).length
                    ? html`<p class="muted">信息有限：尚未标注任何标签。</p>`
                    : ''}
                `)
          }
        </div>

        <div class="card mb-4">
          <div class="section-title"><span class="num">三</span>无剧透简介</div>
          <p>${book.safeSummary || '信息有限：暂无去剧透简介。'}</p>
          <p class="small muted">字数：${String(Array.from(book.safeSummary ?? '').length)} / 100</p>
        </div>

        <div class="card mb-4">
          <div class="section-title"><span class="num">四</span>相似作品推荐</div>
          ${
            // 敏感模式下不展示标签信息，这条「本书无诡计类标签」的说明同样隐去
            !sensitive && shownResult.trickGate?.relaxed
              ? raw(html`<p class="notice notice-info small">${shownResult.trickGate.note}</p>`)
              : ''
          }
          ${
            shownResult.recommendations.length
              ? shownResult.recommendations.map(
                  (rec) => html`
                    <div class="match-detail" style="border-top:1px dashed var(--border);padding:var(--space-3) 0">
                      <div style="display:flex;gap:var(--space-2);align-items:baseline;flex-wrap:wrap">
                        <strong style="font-family:var(--font-serif)">
                          <a href="#/book/${encodeURIComponent(rec.book.id)}" style="color:inherit">《${rec.book.title}》</a>
                        </strong>
                        <span class="muted small">${rec.book.author}</span>
                        ${
                          sensitive
                            ? ''
                            : raw(html`<span class="ml-auto badge ${
                                rec.confidence.level === 'high' ? 'badge-ok' : 'badge-low'
                              }">${rec.confidence.label} · ${String(rec.percent)}%</span>`)
                        }
                      </div>
                      <p class="small dim" style="margin:var(--space-2) 0 0">${rec.reason}</p>
                      ${
                        sensitive
                          ? ''
                          : raw(html`<div class="tag-list" style="margin-top:var(--space-2)">
                              ${rec.detail.matched
                                .slice(0, 8)
                                .map((tid) => html`<span class="badge badge-${tagCategory(tid)}">${tagLabel(tid)}</span>`)}
                            </div>`)
                      }
                    </div>
                  `,
                )
              : raw('<p class="muted">知识库中暂无可比对的作品。</p>')
          }
        </div>

        <div class="card">
          <div class="section-title"><span class="num">五</span>平台评价参考</div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>平台</th><th>评分</th><th>评价摘要（去剧透）</th></tr>
              </thead>
              <tbody>
                ${platformRows.map(
                  ([label, entry]) => html`
                    <tr>
                      <th style="width:150px">${label}</th>
                      <td class="num">${
                        entry?.score !== null && entry?.score !== undefined
                          ? `${String(entry.score)}${entry.count ? `（${String(entry.count)} 人）` : ''}`
                          : '暂无数据'
                      }</td>
                      <td>
                        ${entry?.summary || '暂无数据'}
                        ${
                          entry?.sourceUrl
                            ? raw(html`
                                <div class="small" style="margin-top:var(--space-2)">
                                  <a href="${entry.sourceUrl}" target="_blank" rel="noopener noreferrer">查看来源页面 ↗</a>
                                  <span class="muted">
                                    ${entry.edition ? ` · 版本：${entry.edition}` : ''}
                                    ${entry.fetchedAt ? ` · 抓取于 ${new Date(entry.fetchedAt).toLocaleDateString('zh-CN')}` : ''}
                                  </span>
                                </div>
                              `)
                            : ''
                        }
                      </td>
                    </tr>
                  `,
                )}
              </tbody>
            </table>
          </div>
          <p class="small muted" style="margin-top:var(--space-3)">
            ${
              Object.values(ratings).some((r) => r?.sourceUrl)
                ? '带「查看来源页面」的条目为实时抓取的平台公开数据，可点击核对；'
                : '评分与摘要为整理时采集的公开数据；'
            }标记「暂无数据」表示未采集到可靠公开数据，系统不编造评分。
          </p>
        </div>
      </div>

      <!-- 侧栏 -->
      <div class="side-panel no-print">
        <div class="card tight">
          <div class="section-title" style="font-size:1rem"><span class="num">◎</span>反剧透体检</div>
          ${
            audit.passed
              ? raw(html`
                  <div class="notice notice-ok" style="margin-bottom:0">
                    <strong>通过</strong>
                    <p class="small" style="margin:0">全部公开字段未检出任何泄底或暗示性表述。</p>
                  </div>
                `)
              : raw(html`
                  <div class="notice notice-warn" style="margin-bottom:0">
                    <strong>有 ${String(audit.issues.length)} 条待确认</strong>
                    <ul class="small" style="margin:var(--space-2) 0 0;padding-left:1.2em">
                      ${audit.issues
                        .slice(0, 5)
                        .map(
                          (i) =>
                            raw(html`<li>${RISK_META[i.risk]?.icon ?? ''} ${i.fieldLabel ?? i.field}：…${i.excerpt}…</li>`),
                        )}
                    </ul>
                  </div>
                `)
          }
          <div class="vault-block" style="margin-top:var(--space-3)">
            <div class="vault-head">
              <span class="vault-lock" aria-hidden="true">🔒</span>谜底保险库
            </div>
            <p class="small muted" style="margin:0">
              ${
                audit.results.find((r) => r.field === 'vault')?.filledFields?.length
                  ? `已加密保存 ${String(audit.results.find((r) => r.field === 'vault').filledFields.length)} 项保密内容，系统在任何界面与导出文件中都不会输出。`
                  : '保险库为空。本系统不存储谜底，从设计上杜绝泄露。'
              }
            </p>
          </div>
        </div>

        <div class="card tight">
          <div class="section-title" style="font-size:1rem"><span class="num">↗</span>相关导航</div>
          <div class="btn-row">
            <a class="btn btn-sm" href="#/library?genre=${encodeURIComponent(book.genre ?? '')}">同流派作品</a>
            <a class="btn btn-sm" href="#/library?q=${encodeURIComponent(book.author ?? '')}">同作者作品</a>
            ${
              // 敏感模式下隐藏"同为「密室」"这类入口——按钮文案本身就是诡计信息
              !sensitive && byCat('trick').length
                ? raw(html`<a class="btn btn-sm" href="#/library?tag=${encodeURIComponent(byCat('trick')[0])}">同为「${tagLabel(byCat('trick')[0])}」</a>`)
                : ''
            }
          </div>
        </div>

        <details class="card tight">
          <summary class="dim small" style="cursor:pointer">查看完整 Markdown 报告</summary>
          <div class="report-body" style="box-shadow:none;padding:var(--space-3);margin-top:var(--space-3)">
            ${raw(markdownToHtml(copyMd))}
          </div>
        </details>
      </div>
    </div>
  `;

  /* ---------------- 事件 ---------------- */
  const cleanups = [];
  const on = (target, event, handler) => {
    target?.addEventListener(event, handler);
    cleanups.push(() => target?.removeEventListener(event, handler));
  };

  on(main, 'click', async (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action) return;

    if (action === 'copy') {
      if (!audit.passed) {
        toast('该条目的反剧透体检存在待确认项，建议先修正后再复制。', { type: 'warn', duration: 5200 });
      }
      const ok = await copyText(copyMd);
      toast(ok ? '已复制 Markdown 报告' : '复制失败', { type: ok ? 'ok' : 'error' });
    }

    if (action === 'download') {
      download(safeFilename(`${book.title}-诡计标签分析`), report, 'text/markdown;charset=utf-8');
      toast('已导出 Markdown 文件', { type: 'ok' });
    }

    if (action === 'delete') {
      if (!confirm(`确定要从知识库中删除《${book.title}》吗？此操作可以重新导入恢复。`)) return;
      try {
        await store.remove(book.id);
        toast(`《${book.title}》已删除`, { type: 'ok' });
        navigate('library');
      } catch (error) {
        toast(String(error.message ?? error), { type: 'error', title: '删除失败' });
      }
    }
  });

  return () => {
    for (const off of cleanups) off?.();
  };
}
