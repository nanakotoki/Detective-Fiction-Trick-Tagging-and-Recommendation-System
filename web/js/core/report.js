/**
 * 报告生成器 —— 严格复刻需求文档《输出格式（严格遵守）》的六段式结构
 *
 * 输出结构：
 *   一、小说基础信息      （表格）
 *   二、诡计标签          （2.1 核心诡计 / 2.2 叙事 / 2.3 场景 / 2.4 动机）
 *   三、无剧透简介        （100 字以内）
 *   四、相似作品推荐      （3 本）
 *   五、平台评价参考      （豆瓣 / 虎扑 / Goodreads / 其他）
 *   六、给用户的阅读提示
 *   + 安全自检清单        （需求文档要求输出前逐条确认）
 */

import { SPEC_CORE_TRICK_TAGS, tagCategory, tagLabels } from './tags.js';
import { bookTagIds } from './engine.js';
import { countChars } from './safety.js';
import { HR, cell, h, quote, ratingCell, table, tags, tidy, ul } from './markdown.js';

/** 平台展示配置 */
export const PLATFORMS = [
  { id: 'douban', label: '豆瓣', note: '10 分制' },
  { id: 'hupu', label: '虎扑', note: '10 分制' },
  { id: 'goodreads', label: 'Goodreads', note: '5 分制' },
  { id: 'zhihu', label: '知乎', note: '推荐度' },
  { id: 'weread', label: '微信读书', note: '推荐值' },
];

/** 流派与系列的展示兜底 */
function orDash(v) {
  return v === null || v === undefined || v === '' ? '—' : String(v);
}

/**
 * 一、小说基础信息
 *
 * `coverUrl` 是可选的（第 191 轮补）：用户在「诡计分析」页打开一本书时，
 * 反馈「任何小说都不显示封面」——报告里原先确实**从头到尾没有封面**。
 * 给了地址就在这一节开头插一张图，于是**复制／导出 Markdown 也带着封面**；
 * 没给就与从前完全一样（老的行为与老的单测都不受影响）。
 */
export function renderBasics(book, { coverUrl = '' } = {}) {
  const rows = [
    ['书名', orDash(book.title) + (book.originalTitle ? `（${book.originalTitle}）` : '')],
    ['作者', orDash(book.author) + (book.authorEn ? ` / ${book.authorEn}` : '')],
    ['流派', orDash(book.genre)],
    ['首次出版', orDash(book.firstPublished) + (book.country ? `（${book.country}）` : '')],
    // 版本年与「首次出版」是两件事，报告里同样分栏；相同或缺失时不重复占行
    ...(book.editionYear && book.editionYear !== book.firstPublished
      ? [['版本年', `${orDash(book.editionYear)}（本库收录版本的出版年）`]]
      : []),
    ['系列', book.series ? orDash(book.series) + (book.detective ? `，主角：${book.detective}` : '') : '非系列作品'],
  ];
  const parts = [h(2, '一、小说基础信息'), ''];
  if (coverUrl) {
    // Markdown 里的图片：导出/复制出去的.md也能看到封面（地址由调用方给绝对路径）
    parts.push(`![《${book.title}》封面](${coverUrl})`, '');
  }
  parts.push(table(['项目', '内容'], rows));
  return parts.join('\n');
}

/**
 * 二、诡计标签
 */
/**
 * 敏感模式下的「二、诡计标签」替代段落。
 *
 * 需求文档要求报告必须有第二部分，因此不能整段删掉；
 * 敏感模式下改为说明"该部分已按你的设置隐藏"，并保持编号完整。
 */
function renderHiddenTagsSection() {
  return [
    h(2, '二、诡计标签'),
    '',
    quote(
      '**本节已按你的设置隐藏。**\n' +
        '当前处于「敏感模式」：诡计标签、推理流派与匹配依据都不会显示，' +
        '以免你在毫无准备的情况下读到类型信息。\n' +
        '如需查看这部分分析，请点击页面顶部的开关切回「普通模式」。',
    ),
  ].join('\n');
}

/**
 * 二、诡计标签
 *
 * ⚠️ 小节编号 2.1~2.4 是需求文档明确规定的，不得改动。
 * 「推理流派」是需求文档未定义的第二维度，因此作为 **2.4 之后的补充小节**
 * 放在末尾，并显式标注为系统扩展 —— 这样既提供了新分类，
 * 又不会打断需求文档固定的一~六编号（三=简介、四=推荐、五=平台、六=提示）。
 */
export function renderTrickTags(book, options = {}) {
  if (options.sensitive) return renderHiddenTagsSection();

  const allIds = bookTagIds(book);
  const byCat = (cat) => tagLabels(allIds.filter((id) => tagCategory(id) === cat));

  const lines = [h(2, '二、诡计标签'), ''];

  // 2.1 核心诡计标签
  lines.push(h(3, '2.1 核心诡计标签'));
  const core = byCat('trick');
  const custom = (book.customTags ?? []).filter(Boolean);
  lines.push(tags([...core, ...custom]));
  if (!core.length && !custom.length) lines.push('信息有限：暂未标注核心诡计标签。');
  lines.push('');
  lines.push(quote(`可选取值：${SPEC_CORE_TRICK_TAGS.map((t) => `\`${t}\``).join(' ')}（可多选，也支持自定义标签）`));
  lines.push('');

  // 2.2 叙事标签
  lines.push(h(3, '2.2 叙事标签'));
  const narrative = byCat('narrative');
  lines.push(tags(narrative.length ? narrative : ['未标注']));
  lines.push('');

  // 2.3 场景标签
  lines.push(h(3, '2.3 场景标签'));
  const scene = byCat('scene');
  lines.push(tags(scene.length ? scene : ['未标注']));
  lines.push('');

  // 2.4 动机标签
  lines.push(h(3, '2.4 动机标签'));
  const motive = byCat('motive');
  lines.push(tags(motive.length ? motive : ['未标注']));
  lines.push('');
  lines.push(quote('动机仅标注类型，不说明具体指向何人。'));

  // 补充：推理流派（系统扩展维度，不进需求文档的 2.1~2.4 编号）
  lines.push('');
  lines.push(h(3, '补充：推理流派（系统扩展维度）'));
  const school = byCat('school');
  if (school.length) {
    lines.push(tags(school));
  } else {
    lines.push('信息有限：暂未标注推理流派。');
  }
  lines.push('');
  lines.push(
    quote(
      '推理流派描述的是**写法取向**（逻辑流 / 诡计流 / 法庭派 / 硬汉派 / 刑侦派 …），' +
        '与上面的「诡计标签」是两个正交维度：同一流派的作品可以有完全不同的诡计，' +
        '同一类诡计也可以出现在不同流派中。该维度为系统扩展，需求文档未定义。',
    ),
  );

  return lines.join('\n');
}

/**
 * 三、无剧透简介
 */
export function renderSafeSummary(book) {
  const text = book.safeSummary ?? '';
  const len = countChars(text);
  const lines = [h(2, '三、无剧透简介（100 字以内）'), '', text || '信息有限：暂无无剧透简介。', ''];
  lines.push(quote(`字数：${len} / 100 ${len > 100 ? '⚠️ 超出上限，请精简' : '✅'}`));
  return lines.join('\n');
}

/**
 * 四、相似作品推荐
 * @param {Array<{book:object, reason:string, detail:object, percent:number, confidence:object}>} recommendations
 * @param {number} limit
 * @param {{ sensitive?: boolean, trickGate?: object }} [options]
 *   敏感模式下不展示标签、相似度与匹配依据；
 *   `trickGate.relaxed` 为真时（目标作品没有诡计类标签）如实声明本次未做诡计比对。
 */
export function renderRecommendations(recommendations, limit = 3, options = {}) {
  const { sensitive = false, trickGate = null } = options;
  // 敏感模式整体不展示标签比对，这条「本书无诡计类标签」的说明也一并隐去
  const relaxed = !sensitive && trickGate?.relaxed === true;
  const lines = [h(2, `四、相似作品推荐（${limit} 本）`), ''];

  if (relaxed) {
    lines.push(trickGate.note ?? '本书未标注「诡计类」标签，本次推荐不含诡计机制比对。');
    lines.push('');
  }

  const list = (recommendations ?? []).slice(0, limit);

  if (!list.length) {
    lines.push('知识库中暂无可比对的作品，信息有限，无法给出推荐。');
    return lines.join('\n');
  }

  for (const rec of list) {
    const title = rec.book.title;
    const author = rec.book.author ?? '佚名';

    lines.push(`- **《${title}》** — ${author}`);

    if (sensitive) {
      // 敏感模式：只给出作品与中性理由，不给任何可反推诡计的信息
      lines.push(`  - 匹配理由：${rec.reason}`);
      continue;
    }

    const label = tagLabels((rec.detail?.matched ?? []).filter((id) => tagCategory(id) === 'trick'));
    const fallback = tagLabels((rec.detail?.matched ?? []).slice(0, 3));
    const shown = (label.length ? label : fallback).slice(0, 3);

    lines.push(`  - 核心标签：${tags(shown)}`);
    lines.push(`  - 匹配理由：${rec.reason}`);
    const extra = [];
    if (rec.percent) extra.push(`相似度 ${rec.percent}%`);
    if (rec.confidence?.label) extra.push(rec.confidence.label);
    const shared = rec.detail?.matched?.length ?? 0;
    extra.push(`共享标签 ${shared} 个`);
    lines.push(`  - 参考：${extra.join(' · ')}`);
  }

  lines.push('');
  lines.push(
    quote(
      sensitive
        ? '推荐依据为整体阅读体验的相近程度；当前处于敏感模式，不展示具体的标签比对。'
        : relaxed
          ? '本书没有「诡计类」标签，因此推荐依据为推理流派、叙事方式、场景、动机与题材的相近程度，不代表诡计类型相同，也不涉及任何一本的谜底。'
          : '推荐依据为诡计类型与结构风格的标签重合度，不涉及任何一本的谜底。',
    ),
  );
  return lines.join('\n');
}

/**
 * 判断一条平台记录的来源状态。
 * 实时抓取的带 sourceUrl；离线整理的没有；两者都没有的属于尚未采集。
 */
export function ratingStatus(entry) {
  if (!entry) return 'missing';
  if (entry.score === null || entry.score === undefined) return 'missing';
  if (entry.sourceUrl) return 'live';
  return 'estimated';
}

/**
 * 五、平台评价参考
 */
export function renderPlatforms(book) {
  const ratings = book.ratings ?? {};
  const rows = [];
  const livePlatforms = [];
  const estimated = [];
  const missing = [];

  for (const p of PLATFORMS.filter((x) => ['douban', 'hupu', 'goodreads'].includes(x.id))) {
    const entry = ratings[p.id];
    const status = ratingStatus(entry);
    if (status === 'live') livePlatforms.push(p.label);
    else if (status === 'estimated') estimated.push(p.label);
    else missing.push(p.label);

    // 若该条目来自实时抓取，追加可点击的来源链接，让每个数字都能被追溯
    let summary = entry?.summary && entry.summary !== '暂无数据' ? entry.summary : status === 'missing' ? '暂无数据' : '';
    if (status === 'estimated') summary = `（离线估计值，未联网核实）${summary}`.trim();
    if (entry?.sourceUrl) summary += `（来源：[${p.label}](${entry.sourceUrl})）`;

    rows.push([`${p.label}（${p.note}）`, ratingCell(entry), summary || '暂无数据']);
  }

  const others = normalizeOthers(ratings);
  if (others.length) {
    for (const o of others) {
      const status = ratingStatus(o);
      const link = o.sourceUrl ? `（来源：${o.sourceUrl}）` : '';
      if (status === 'live') livePlatforms.push(o.label);
      rows.push([
        `${o.label}${o.note ? `（${o.note}）` : ''}`,
        ratingCell(o),
        `${status === 'estimated' ? '（离线估计值）' : ''}${o.summary || '暂无数据'}${link}`,
      ]);
    }
  } else {
    rows.push(['其他（知乎 / 微信读书等）', '暂无数据', '暂无数据']);
  }

  const asOf = collectAsOf(ratings);
  const lines = [h(2, '五、平台评价参考'), '', table(['平台', '评分', '评价摘要（去剧透）'], rows), ''];

  // 如实区分三种来源状态，不能笼统写成"平台数据"，
  // 否则离线估计值会被误认为实时抓取结果。
  const meta = [];
  meta.push(asOf ? `数据时间：${asOf}` : '数据时间：未知');
  if (livePlatforms.length) {
    meta.push(`🟢 实时抓取：${[...new Set(livePlatforms)].join('、')} —— 带来源链接，可点击逐条核对`);
  }
  if (estimated.length) {
    meta.push(`🟡 离线估计：${[...new Set(estimated)].join('、')} —— 未联网核实，仅供参考`);
  }
  if (missing.length) {
    meta.push(`⚪ 暂无数据：${[...new Set(missing)].join('、')} —— 未采集到可靠公开数据，系统不编造评分`);
  }
  // provenance.ratingsNote 是数据整理时写下的说明，可能与当前条目的实际来源状态不符
  // （例如原说明写"Goodreads 不可达"，但该条目实际带有离线估计值）。
  // 因此只在两者不冲突时才追加，避免报告自己打自己。
  const note = book.provenance?.ratingsNote;
  if (note && !conflictsWithStatus(note, { livePlatforms, estimated, missing })) {
    meta.push(note);
  }
  meta.push('评分仅作阅读参考，全部摘要均已去除情节剧透。');
  lines.push(quote(meta.join('\n')));

  return lines.join('\n');
}

/**
 * 判断数据里的 ratingsNote 是否与当前条目的实际来源状态矛盾。
 * 例：note 声称「Goodreads 均标注暂无数据」，但本书该平台有离线估计值 → 矛盾，应丢弃。
 */
function conflictsWithStatus(note, { estimated, missing }) {
  const text = String(note);
  // note 说某平台"暂无数据"，但该书该平台其实有估计值
  for (const label of estimated) {
    if (text.includes(label) && /暂无数据|不可达|未采集/.test(text)) return true;
  }
  // note 说某平台是实时抓取，但该书该平台其实是估计值或缺数据
  for (const label of [...estimated, ...missing]) {
    if (text.includes(label) && /实时抓取/.test(text)) return true;
  }
  return false;
}

function normalizeOthers(ratings) {
  const out = [];
  const push = (id, label, note) => {
    const e = ratings[id];
    if (e && (e.score !== null && e.score !== undefined || e.summary)) out.push({ id, label, note, ...e });
  };
  push('zhihu', '知乎', '推荐度');
  push('weread', '微信读书', '推荐值');
  for (const [key, value] of Object.entries(ratings)) {
    if (['douban', 'hupu', 'goodreads', 'zhihu', 'weread'].includes(key)) continue;
    if (!value) continue;
    out.push({ id: key, label: value.source ?? key, note: value.note ?? '', ...value });
  }
  return out;
}

function collectAsOf(ratings) {
  const dates = Object.values(ratings ?? {})
    .map((e) => e?.asOf)
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

/**
 * 六、给用户的阅读提示
 */
export function renderReadingTips(book) {
  const tips = book.readingTips ?? {};
  const suitable = tips.suitableFor ?? [];
  const watchFor = tips.watchFor ?? [];
  const warning = tips.warning ?? '';

  const lines = [h(2, '六、给用户的阅读提示'), ''];
  if (suitable.length) {
    // suitableFor 里存的是"读者类型"描述，不是诡计标签，因此不能套用「喜欢 X 类型诡计」的句式
    lines.push(`- 本书适合这样的读者：${suitable.map((s) => `\`${s}\``).join(' ')}。`);
  } else {
    lines.push('- 本书适合喜欢 `本格解谜` 的读者。');
  }

  if (watchFor.length) {
    lines.push(`- 阅读时建议留意：${watchFor.map((s) => `\`${s}\``).join(' ')}。`);
  } else {
    lines.push('- 阅读时建议留意：`叙述者给出的信息边界`。');
  }
  lines.push('- 以上仅为观察维度提示，不含任何答案指向。');

  if (warning) {
    lines.push('');
    lines.push(`> **特别提醒**：${warning}`);
  } else {
    lines.push('');
    lines.push('> **特别提醒**：本报告全程不含剧透，可放心阅读。');
  }
  return lines.join('\n');
}

/**
 * 组装完整报告
 * @param {object} params
 * @param {object} params.book
 * @param {Array} params.recommendations
 * @param {object} [params.selfCheck] runSelfCheck 的返回值
 * @param {object} [params.trickGate] recommend() 返回的 trickGate，用于如实声明是否做过诡计比对
 * @param {object} [params.options]
 */
export function renderReport({ book, recommendations = [], selfCheck = null, trickGate = null, options = {} }) {
  const { limit = 3, includeSelfCheck = true, includeHeader = true, sensitive = false, coverUrl = '' } = options;
  const blocks = [];

  if (includeHeader) {
    blocks.push(h(1, `诡计标签分析报告：${book.title}`));
    blocks.push('');
    blocks.push(
      quote(
        '本报告由「推理小说诡计标签分析与推荐系统」生成。全程遵守最高铁律：不写出凶手、不写出真相与结局、不解释诡计实现方式，只描述诡计类型。',
      ),
    );
  }

  blocks.push(renderBasics(book, { coverUrl }));
  blocks.push(HR);
  blocks.push(renderTrickTags(book, { sensitive }));
  blocks.push(HR);
  blocks.push(renderSafeSummary(book));
  blocks.push(HR);
  blocks.push(renderRecommendations(recommendations, limit, { sensitive, trickGate }));
  blocks.push(HR);
  blocks.push(renderPlatforms(book));

  if (selfCheck && includeSelfCheck) {
    blocks.push(HR);
    blocks.push(renderSelfCheckSection(selfCheck));
  }

  blocks.push(HR);
  blocks.push(renderReadingTips(book));

  return tidy(blocks.join('\n\n'));
}

/**
 * 安全自检清单区块（Markdown）
 */
export function renderSelfCheckSection(selfCheck) {
  const lines = [h(2, '安全自检清单（输出前逐条确认）'), ''];
  for (const item of selfCheck.items) {
    lines.push(`- [${item.passed ? 'x' : ' '}] ${item.question} → ${item.passed ? '否 ✅' : '是 ⛔'}`);
  }
  lines.push('');
  if (selfCheck.passed) {
    lines.push(quote('五项自检全部通过，本次输出不含任何剧透内容。'));
  } else {
    lines.push(quote('存在未通过项，已按需求文档要求拦截输出。请修改下列内容后重新生成：'));
    lines.push('');
    for (const b of selfCheck.blockers.slice(0, 10)) {
      lines.push(`> - **${b.source}**${b.fieldLabel ? ` · ${b.fieldLabel}` : ''}：…${b.excerpt}…`);
      lines.push(`>   - 建议：${b.hint}`);
    }
  }
  return lines.join('\n');
}

/**
 * 生成「复制用」纯 Markdown（不含自检区块，便于直接粘贴）
 */
export function renderCopyMarkdown(params) {
  return renderReport({ ...params, options: { ...(params.options ?? {}), includeSelfCheck: false, includeHeader: false } });
}

/**
 * 把系统生成的 Markdown 子集渲染为 HTML。
 *
 * 安全模型：**逐行先识别结构、再转义文本内容**。
 * 绝不在解析前整体转义——那样会把结构标记（如引用块的 `>`）也转义掉，
 * 导致引用块永远解析不出来；也绝不把原文直接拼进 HTML。
 *
 * 支持：# 标题、表格、无序列表（含嵌套）、引用、粗体、行内代码、分隔线
 */
export function markdownToHtml(markdown) {
  // 统一换行符：CRLF 会让行级正则（表格 / 引用 / 列表）全部失配
  const source = String(markdown ?? '').replace(/\r\n?/g, '\n');

  /** HTML 转义（只作用于文本内容） */
  const escHtml = (text) =>
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  /** 行内标记：先转义，再解析 **粗体** 与 `代码` */
  const inline = (text) =>
    escHtml(text)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code class="tag">$1</code>');

  const lines = source.split('\n');
  const out = [];
  let i = 0;

  /**
   * 渲染列表。
   *
   * 注意：扁平拼接 `<li>…</li><ul>…</ul>` 会产生**无效 HTML**
   * （<ul> 的父节点必须是 <li> 或列表容器，不能是另一个 <ul>），
   * 浏览器会做容错修复，导致样式与缩进都不可控。
   * 这里的做法是：遇到缩进更深的行时，把嵌套 <ul> 放进**上一个 <li> 内部**。
   */
  const flushList = (buffer) => {
    if (!buffer.length) return;

    const parts = [];
    let open = false; // 是否有一个未闭合的顶层 <li>
    let nested = false; // 是否处于嵌套 <ul> 中

    for (const raw of buffer) {
      const indent = raw.match(/^\s*/)[0].length;
      const content = inline(raw.trim().replace(/^[-*]\s+/, ''));
      const isNested = indent >= 2;

      if (isNested) {
        if (!nested) {
          // 在上一个未闭合的 li 内部开启嵌套列表
          parts.push('<ul class="nested">');
          nested = true;
        }
        parts.push(`<li>${content}</li>`);
        continue;
      }

      // 顶层项：先收掉嵌套与上一个 li
      if (nested) {
        parts.push('</ul>');
        nested = false;
      }
      if (open) parts.push('</li>');
      parts.push(`<li>${content}`);
      open = true;
    }

    if (nested) parts.push('</ul>');
    if (open) parts.push('</li>');

    out.push(`<ul>${parts.join('')}</ul>`);
  };

  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) {
      i += 1;
      continue;
    }

    // 标题
    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      out.push(`<h${level}>${inline(heading[2])}</h${level}>`);
      i += 1;
      continue;
    }

    // 分隔线
    if (/^-{3,}$/.test(line.trim())) {
      out.push('<hr>');
      i += 1;
      continue;
    }

    // 表格
    if (/^\|.*\|$/.test(line.trim()) && /^\|[\s:|-]+\|$/.test((lines[i + 1] ?? '').trim())) {
      const parseRow = (row) =>
        row
          .trim()
          .replace(/^\|/, '')
          .replace(/\|$/, '')
          .split(/(?<!\\)\|/)
          .map((c) => inline(c.replace(/\\\|/g, '|').trim()));
      const headers = parseRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && /^\|.*\|$/.test(lines[i].trim())) {
        rows.push(parseRow(lines[i]));
        i += 1;
      }
      const thead = `<thead><tr>${headers.map((hh) => `<th>${hh}</th>`).join('')}</tr></thead>`;
      const tbody = `<tbody>${rows
        .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`)
        .join('')}</tbody>`;
      out.push(`<div class="table-wrap"><table>${thead}${tbody}</table></div>`);
      continue;
    }

    // 引用块（在转义之前识别，否则 '>' 会变成 '&gt;' 而失配）
    if (/^>\s?/.test(line)) {
      const buffer = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buffer.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${buffer.map((b) => `<p>${inline(b)}</p>`).join('')}</blockquote>`);
      continue;
    }

    // 列表
    if (/^\s*[-*]\s+/.test(line)) {
      const buffer = [];
      while (i < lines.length && (/^\s*[-*]\s+/.test(lines[i]) || /^\s{2,}\S/.test(lines[i]))) {
        buffer.push(lines[i]);
        i += 1;
      }
      flushList(buffer);
      continue;
    }

    // 段落
    out.push(`<p>${inline(line)}</p>`);
    i += 1;
  }

  return out.join('\n');
}

export { cell as escapeCell, h as heading, tags as renderTags };
