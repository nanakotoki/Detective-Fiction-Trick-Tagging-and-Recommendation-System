/**
 * 视图：关于本系统
 * 说明数据来源、反剧透机制、算法口径与部署方式，并给出免责声明与自检入口。
 */

import { TAGS, TAG_CATEGORIES } from '../core/tags.js';
import { DEFAULT_CONFIG } from '../core/engine.js';
import { RULES_STATS } from '../core/rules-stats.js';
import { isSensitive } from '../core/sensitive.js';
import { html, qs, raw, toast } from '../ui/dom.js';

export const meta = { title: '关于本系统' };

export async function render(ctx) {
  const { main, store } = ctx;
  const status = store.status();
  const books = store.all();

  const seedBooks = books.filter((b) => (b.origin ?? 'seed') === 'seed');
  const userBooks = books.filter((b) => b.origin === 'user');
  const withSummary = books.filter((b) => b.safeSummary).length;
  const withRating = books.filter((b) => {
    const r = b.ratings ?? {};
    return ['douban', 'hupu', 'goodreads'].some((p) => r[p]?.score !== null && r[p]?.score !== undefined);
  }).length;

  main.innerHTML = html`
    <div class="view-header">
      <span class="eyebrow">About</span>
      <h1>关于本系统</h1>
      <p class="lede">
        一个把「推理小说诡计分析提示词规范」工程化的网页系统：<strong>结构化的诡计标签体系</strong> +
        <strong>可解释的相似度推荐</strong> + <strong>可验证的反剧透防线</strong>。
      </p>
    </div>

    <div class="grid grid-4 mb-5">
      <div class="stat-tile"><div class="v">${String(books.length)}</div><div class="k">收录作品</div></div>
      <div class="stat-tile"><div class="v">${String(TAGS.length)}</div><div class="k">标签总数</div></div>
      <div class="stat-tile"><div class="v">${String(withSummary)}</div><div class="k">含去剧透简介</div></div>
      <div class="stat-tile"><div class="v">${String(withRating)}</div><div class="k">含平台公开评分</div></div>
    </div>

    <div class="card mb-4">
      <div class="section-title"><span class="num">1</span>这个系统做什么</div>
      <p>
        输入一本推理小说的书名与无剧透梗概，系统输出一份<strong>六段式结构化报告</strong>：
        基础信息、诡计标签（核心诡计 / 叙事 / 场景 / 动机）、100 字以内去剧透简介、3 部相似作品推荐、
        各平台去剧透评价参考、以及给读者的观察维度提示。
      </p>
      <p class="mb-0">
        报告的段落结构、标签词典与自检清单，全部对应 <code>docs/reqirments.md</code> 中的规范。
      </p>
    </div>

    <div class="card mb-4">
      <div class="section-title"><span class="num">2</span>反剧透是怎么做到的（不只是靠自觉）</div>
      <p>系统把「最高铁律」做成了可执行、可验证的机制，而不是写在提示词里的君子协定：</p>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th style="width:180px">机制</th><th>说明</th></tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>字段级门禁</strong></td>
              <td>
                每个字段被明确标记为公开或保密。<code>vault</code>（谜底保险库）下的内容在渲染、导出、API 返回
                三类出口都会被递归剥离——即使有人真的填了谜底，它也没有任何路径能出现在读者眼前。
              </td>
            </tr>
            <tr>
              <td><strong>规则引擎扫描</strong></td>
              <td>
                当前内置 <strong>${String(RULES_STATS.rules)}</strong> 条剧透规则、共
                <strong>${String(RULES_STATS.patterns)}</strong> 条正则模式，覆盖
                ${RULES_STATS.categories.map((c) => `<code>${c}</code>`).join('、')}
                六类风险。命中即给出风险等级、命中片段与修复建议。
              </td>
            </tr>
            <tr>
              <td><strong>合法表述白名单</strong></td>
              <td>
                「找出凶手是谁」「不剧透」这类推理语境下的常规说法会被豁免
                （当前白名单 ${String(RULES_STATS.safePhrases)} 条），避免误报把正常文案判成泄底。
              </td>
            </tr>
            <tr>
              <td><strong>输出前自检</strong></td>
              <td>
                按需求文档的 5 条清单逐条判定。任一项未通过，<strong>复制 / 导出 / 打印三个出口会被直接拦截</strong>。
              </td>
            </tr>
            <tr>
              <td><strong>服务端第二道防线</strong></td>
              <td>
                运行后端时，入库前会在服务器重跑同一套规则；不合格的数据返回 422 并说明原因，写不进知识库。
              </td>
            </tr>
            <tr>
              <td><strong>数据出厂体检</strong></td>
              <td>
                每条著录在**进库前**都要过一遍体检（简介长度、字段完整性、剧透风险），
                不合格的不写进知识库；这套检查也是构建门禁的一部分（npm run check:data），
                结论只给维护者看，不摆在读者界面上。
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="card mb-4">
      <div class="section-title"><span class="num">3</span>推荐算法口径</div>
      <p>
        推荐逻辑严格遵循需求文档：「优先匹配<strong>诡计类</strong>标签重合度，其次匹配<strong>叙事类</strong>与<strong>场景类</strong>，
        确保推荐作品在<strong>诡计机制层面</strong>高度相似」。
      </p>
      ${
        // 敏感模式下不展示类别明细（类别名与权重本身也是分析口径的一部分，
        // 而且这里是"哪些维度参与比对"的完整说明）
        isSensitive()
          ? raw(html`
              <div class="notice notice-ok">
                <strong>类别权重明细已按你的设置隐藏</strong>
                <p class="small" style="margin:0">
                  当前处于「敏感模式」，标签类别与权重不在此展示。
                </p>
              </div>
            `)
          : raw(html`
              <div class="table-wrap mb-4">
                <table>
                  <thead>
                    <tr><th>标签类别</th><th>权重</th><th>作用</th></tr>
                  </thead>
                  <tbody>
                    ${TAG_CATEGORIES.map(
                      (c) => html`
                        <tr>
                          <td><span class="badge badge-${c.id}">${c.label}</span></td>
                          <td class="num">${String(c.weight)}</td>
                          <td class="small dim">${c.description}</td>
                        </tr>
                      `,
                    )}
                  </tbody>
                </table>
              </div>
            `)
      }
      <p>得分由三项融合而成，再加领域约束修正：</p>
      <ul>
        <li>
          <strong>加权重合度（${String(Math.round(DEFAULT_CONFIG.blend.overlap * 100))}%）</strong>——
          两书重合标签的权重之和 ÷ 目标作品的标签权重总量，直接体现「诡计类优先」。
        </li>
        <li>
          <strong>加权杰卡德相似度（${String(Math.round(DEFAULT_CONFIG.blend.jaccard * 100))}%）</strong>——
          衡量整体标签画像的相似程度，抑制「标签堆砌式」的伪相似。
        </li>
        <li>
          <strong>稀有度加权重合（${String(Math.round(DEFAULT_CONFIG.blend.rarity * 100))}%）</strong>——
          共享冷门标签比共享常见标签更有信息量。
        </li>
        <li>
          <strong>领域约束</strong>——若两本书在「诡计类」上零重合，得分会被压制到
          ${String(Math.round(DEFAULT_CONFIG.noTrickCap * 100))}% 以下；同一作者最多推荐
          ${String(DEFAULT_CONFIG.maxPerAuthor)} 本，同系列续作默认排除。
        </li>
      </ul>
      <p class="mb-0 small muted">
        推荐理由由<strong>真实共享的标签</strong>自动生成，因此不会出现「凭空相似」；理由文本同样要过反剧透校验，
        未通过的候选会被直接剔除。
      </p>
    </div>

    <div class="card mb-4">
      <div class="section-title"><span class="num">4</span>数据来源与真实性声明</div>
      <div class="notice notice-warn">
        <strong>关于平台评分：请务必阅读</strong>
        <p>
          知识库中的豆瓣 / 虎扑 / Goodreads 等评分与评价摘要，由整理者在<strong>离线环境</strong>下依据先验知识
          与公开出版信息录入，<code>asOf</code> 统一标注为整理时间点。它们<strong>是近似值，不是各平台的实时数据</strong>。
        </p>
        <p class="mb-0">
          系统遵循「不得编造」原则：任何没有把握的数据一律写为<code>暂无数据</code>，而不是填一个看起来合理的数字。
          建议以各平台实时页面为准。若你有联网环境，可运行 <code>npm run refresh:ratings</code> 尝试刷新。
        </p>
      </div>
      <p>
        种子知识库共 <strong>${String(seedBooks.length)}</strong> 部作品，按流派分批整理：
      </p>
      <ul>
        ${[...new Set(seedBooks.map((b) => b.group).filter(Boolean))].map((group) => {
          const count = seedBooks.filter((b) => b.group === group).length;
          return html`<li>${group} —— ${String(count)} 部</li>`;
        })}
      </ul>
      <p class="mb-0 small muted">
        每一条目都经过反剧透引擎全字段扫描（0 条高危命中）后才写入知识库。
      </p>
    </div>

    <div class="card mb-4">
      <div class="section-title"><span class="num">5</span>当前运行状态</div>
      <div class="grid grid-3 mb-4">
        <div class="stat-tile">
          <div class="v">${status.mode === 'api' ? '服务器' : '本地'}</div>
          <div class="k">数据模式</div>
        </div>
        <div class="stat-tile"><div class="v">${String(userBooks.length)}</div><div class="k">你的自建条目</div></div>
        <div class="stat-tile"><div class="v">${String(TAGS.length)}</div><div class="k">可用标签</div></div>
      </div>
      <p class="small mb-2">
        ${
          status.mode === 'api'
            ? '当前连接了后端服务：新增/编辑的作品会写入服务器知识库，所有访问者共享同一份数据。'
            : '当前是纯静态模式：所有计算在你的浏览器本地完成，新增的作品只保存在本机 localStorage。'
        }
      </p>
      <div class="btn-row">
        <button type="button" class="btn btn-sm" id="about-export">导出知识库 JSON</button>
        ${/*
          「运行全库反剧透体检」按钮已撤（第 192 轮，用户要求）：
          它是维护者的工具（逐条跑 analyzeBook、把待确认项列出来），读者点了只会看到
          一屏内部术语。体检改由构建门禁承担：npm run check:data / npm run audit。
        */ ''}
        ${globalThis.localStorage
          ? raw(html`<button type="button" class="btn btn-sm btn-danger" id="about-reset">清空本地数据</button>`)
          : ''}
      </div>
    </div>

    <div class="card mb-4">
      <div class="section-title"><span class="num">6</span>如何部署到你自己的域名</div>
      <ol>
        <li>
          <strong>纯静态部署（最简单）</strong>：把 <code>web/</code> 与 <code>data/</code> 一起上传到任意静态托管
          （GitHub Pages / Vercel / Netlify / 对象存储 + CDN）。所有功能可用，只是新增的作品保存在访问者自己的浏览器里。
        </li>
        <li>
          <strong>带后端部署（推荐）</strong>：在服务器上运行 <code>npm start</code>（零依赖，只需 Node.js 18+），
          由它同时托管静态资源与 <code>/api</code>。此时知识库是共享且持久化的，并支持服务端反剧透校验。
          前置 Nginx / Caddy 做 HTTPS 反向代理即可。
        </li>
        <li>
          <strong>无需数据库</strong>：用户提交的数据以 JSON 文件保存在 <code>server/data/books.json</code>，
          采用原子写入 + 串行队列，避免并发损坏。作品量级在数千条以内完全够用。
        </li>
      </ol>
    </div>

    <div class="card">
      <div class="section-title"><span class="num">7</span>免责声明</div>
      <ul class="mb-0">
        <li>本系统为阅读辅助工具，评分与评价摘要仅供参考，不构成任何购买或阅读建议。</li>
        <li>系统中所有关于诡计的描述均为<strong>类型级</strong>信息，不包含任何作品的谜底。</li>
        <li>若你认为某条目的表述仍可能构成剧透，可通过「添加小说」页修改，或提交 issue 告知我们。</li>
        <li>书籍版权归原作者与出版方所有，本系统仅整理公开的元数据与标签信息。</li>
      </ul>

      <div class="section-title"><span class="num">8</span>备案信息</div>
      <ul class="mb-0">
        <li>
          本站是<strong>非经营性个人网站</strong>，已完成 ICP 备案，备案号：
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">陕ICP备2026028756号</a>。
        </li>
        <li>网站用途：个人阅读推理小说的笔记与诡计标签整理；<strong>不提供任何图书全文阅读、电子书下载或在线出版服务</strong>。</li>
        <li>网站不开放注册，不接受陌生用户上传内容；书目信息由维护者录入。</li>
      </ul>
    </div>
  `;

  /* ---------------- 事件 ---------------- */

  const cleanups = [];
  const on = (target, event, handler) => {
    target?.addEventListener(event, handler);
    cleanups.push(() => target?.removeEventListener(event, handler));
  };

  on(qs('#about-export'), 'click', async () => {
    const { download } = await import('../ui/dom.js');
    const payload = store.exportAll();
    download(`诡计档案-知识库-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(payload, null, 2), 'application/json');
    toast(`已导出 ${String(payload.count)} 部作品`, { type: 'ok' });
  });

  /* 「运行全库反剧透体检」的处理器随按钮一起撤掉了（第 192 轮，用户要求）：那是维护者的工具，
     改由构建门禁执行 —— npm run check:data（体检）、npm run audit（质量抽查）。 */

  on(qs('#about-reset'), 'click', () => {
    if (!confirm('确定清空本地保存的自建条目与修改吗？此操作不可撤销。')) return;
    store.resetLocal();
    toast('已清空本地数据', { type: 'ok' });
    setTimeout(() => location.reload(), 700);
  });

  return () => {
    for (const off of cleanups) off?.();
  };
}
