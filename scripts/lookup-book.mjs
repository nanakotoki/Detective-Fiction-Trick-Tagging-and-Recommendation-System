#!/usr/bin/env node
/**
 * 从豆瓣补全书籍客观元数据
 * ==========================
 * 需求文档允许「若用户只给了书名、没给梗概，可自行查阅公开资料补全」。
 * 本脚本用书名检索豆瓣，输出**客观元数据**，供你填进知识库。
 *
 * ⚠️ 刻意**不抓取内容简介**：
 *    豆瓣的官方简介是出版社写的卖点文案，推理小说的简介经常直接写出谜底
 *    （「凶手竟是……」「原来一切都是……」）。把它自动填进本系统的
 *    「无剧透简介」字段，等于往系统心脏里注入剧透。
 *    因此本工具只提供元数据，**梗概必须由人来写**——这是设计选择，不是功能缺失。
 *
 * 输出内容：
 *   - 书名 / 原作名 / 作者 / 译者 / 出版社 / 出版年 / 页数 / ISBN / 丛书
 *   - 豆瓣评分与评价人数（含来源链接）
 *   - 基于书名与元数据的**标签建议**（可粘贴到表单里再核对）
 *
 * 用法：
 *   node scripts/lookup-book.mjs 无人生还
 *   node scripts/lookup-book.mjs "钟表馆事件" --candidates 5
 *   node scripts/lookup-book.mjs 姑获鸟之夏 --json
 *   node scripts/lookup-book.mjs 方舟 --oneline        只打一行，便于批量核对
 */

import { parseDoubanSuggest, parseDoubanSubject, stripTags, decodeEntities } from '../web/js/core/ratings.js';
import { suggestTags } from '../web/js/core/suggest.js';
import { TAG_CATEGORIES, tagCategory, TAGS } from '../web/js/core/tags.js';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
/**
 * 单行输出模式。
 *
 * 批量核对十几本书的元数据时，完整报告每人要几十行，翻起来很痛苦。
 * `--oneline` 只打「书名 | 原作名 | 作者 | 初版年 | 出版社 | 评分(人数) | 系列」一行，
 * 需要细看时再去掉这个开关。
 */
const ONELINE = argv.includes('--oneline');
const candidateCount = (() => {
  const i = argv.indexOf('--candidates');
  return i === -1 ? 3 : Math.max(1, Math.min(8, Number(argv[i + 1]) || 3));
})();
const query = argv.find((a) => !a.startsWith('--') && argv[argv.indexOf(a) - 1] !== '--candidates');

if (!query) {
  console.log('');
  console.log('  用法：node scripts/lookup-book.mjs <书名> [--candidates N] [--json]');
  console.log('');
  console.log('  例：  node scripts/lookup-book.mjs 无人生还');
  console.log('');
  process.exit(1);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(url, json = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': UA,
        accept: json ? 'application/json' : 'text/html,application/xhtml+xml',
        'accept-language': 'zh-CN,zh;q=0.9',
        referer: 'https://book.douban.com/',
      },
    });
    if (!res.ok) return null;
    const text = await res.text();
    return json ? text : text;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** 从详情页抽取客观元数据 */
function parseMeta(html) {
  const grab = (regex, transform = (s) => s) => {
    const m = html.match(regex);
    return m ? transform(decodeEntities(stripTags(m[1])).trim()) : '';
  };
  return {
    title: grab(/<span[^>]*property="v:itemreviewed"[^>]*>([\s\S]*?)<\/span>/i),
    author: grab(/<span[^>]*class="[^"]*pl"[^>]*>\s*作者[\s\S]{0,40}?<a[^>]*>([\s\S]*?)<\/a>/i),
    translator: grab(/<span[^>]*class="[^"]*pl"[^>]*>\s*译者[\s\S]{0,40}?<a[^>]*>([\s\S]*?)<\/a>/i),
    publisher: grab(/出版社:<\/span>\s*([\s\S]*?)<br/i),
    publishedAt: grab(/出版年:<\/span>\s*([\s\S]*?)<br/i),
    originalTitle: grab(/原作名:<\/span>\s*([\s\S]*?)<br/i),
    pages: grab(/页数:<\/span>\s*([\s\S]*?)<br/i),
    isbn: grab(/ISBN:<\/span>\s*([\s\S]*?)<br/i),
    series: grab(/丛书:<\/span>\s*([\s\S]*?)<br/i),
    // 只取书名的字符信息用于标签建议，不取简介
    keywords: grab(/<meta[^>]*name="keywords"[^>]*content="([^"]*)"/i),
  };
}

/** 基于可用文本给出标签建议（不含任何剧情信息） */
function suggestFromMeta(meta) {
  const text = [meta.title, meta.originalTitle, meta.keywords, meta.series, meta.publisher].filter(Boolean).join(' ');
  const byId = suggestTags(text);
  // 再补一层：按书名/关键词里的标签中文名直接命中
  const direct = [];
  for (const tag of TAGS) {
    if (text.includes(tag.label)) direct.push({ id: tag.id, label: tag.label, category: tag.category, level: 'high', hits: [tag.label] });
  }
  const merged = new Map();
  for (const s of [...direct, ...byId]) if (!merged.has(s.id)) merged.set(s.id, s);
  return [...merged.values()];
}

async function main() {
  if (ONELINE) {
    const suggestRaw = await get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`, true);
    const candidates = parseDoubanSuggest(suggestRaw);
    if (!candidates.length) {
      console.log(`  ${query}  ->  （无命中）`);
      process.exit(1);
    }
    const picked = candidates.slice(0, candidateCount);
    const rows = [];
    for (const candidate of picked) {
      await sleep(1000);
      const html = await get(candidate.url);
      if (!html) continue;
      rows.push({ candidate, meta: parseMeta(html), rating: parseDoubanSubject(html, { subjectId: candidate.id, sourceUrl: candidate.url }) });
    }
    if (!rows.length) {
      console.log(`  ${query}  ->  ✗ 详情页均无法解析`);
      process.exit(1);
    }
    const best = rows.reduce((a, b) => ((b.rating?.count ?? 0) > (a.rating?.count ?? 0) ? b : a));
    const m = best.meta ?? {};
    const r = best.rating ?? {};
    const rating = r.score != null ? `${r.score}（${r.count ?? 0} 人）` : '暂无评分';
    console.log(
      `  ${query}  ->  ${m.title ?? best.candidate.title} | 原作：${m.originalTitle || '—'} | ${m.author || '—'} | 初版：${m.publishedAt || '—'} | ${m.publisher || '—'} | ${rating} | 系列：${m.series || '—'}`,
    );
    return;
  }

  console.log('');
  console.log(color(`  豆瓣元数据查询：${query}`, C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));

  const suggestRaw = await get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`, true);
  const candidates = parseDoubanSuggest(suggestRaw);

  if (!candidates.length) {
    console.log(color('  未检索到任何条目。可尝试：', C.yellow));
    console.log('    · 去掉标点与「之」等连接字（如「砂之器」→「砂器」）');
    console.log('    · 换用通行译名或繁体写法');
    console.log('    · 在 data/search-aliases.mjs 中登记该书别名');
    console.log('');
    process.exit(1);
  }

  const picked = candidates.slice(0, candidateCount);
  const results = [];

  for (const candidate of picked) {
    await sleep(1000);
    const html = await get(candidate.url);
    if (!html) continue;
    const meta = parseMeta(html);
    const rating = parseDoubanSubject(html, { subjectId: candidate.id, sourceUrl: candidate.url });
    results.push({ candidate, meta, rating });
  }

  if (!results.length) {
    console.log(color('  ✗ 详情页均无法解析（可能被反爬拦截）', C.red));
    console.log('');
    process.exit(1);
  }

  // 选评价人数最多的作为推荐版本
  const best = results.reduce((a, b) => ((b.rating?.count ?? 0) > (a.rating?.count ?? 0) ? b : a));

  if (AS_JSON) {
    console.log(
      JSON.stringify(
        {
          query,
          best: {
            subjectId: best.candidate.id,
            sourceUrl: best.candidate.url,
            score: best.rating?.score ?? null,
            count: best.rating?.count ?? null,
            ...best.meta,
          },
          allEditions: results.map((r) => ({
            subjectId: r.candidate.id,
            title: r.meta.title,
            publishedAt: r.meta.publishedAt,
            publisher: r.meta.publisher,
            score: r.rating?.score ?? null,
            count: r.rating?.count ?? null,
          })),
          tagSuggestions: suggestFromMeta(best.meta),
          note: '仅包含客观元数据与标签建议；内容简介刻意不抓取，因为豆瓣简介常含剧透。',
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log('');
  console.log(color(`  ▸ 推荐版本（评价人数最多）`, C.bold));
  const m = best.meta;
  const rows = [
    ['豆瓣条目', `${best.candidate.url}`],
    ['书名', m.title || best.candidate.title],
    ['原作名', m.originalTitle || '—'],
    ['作者', m.author || best.candidate.author],
    ['译者', m.translator || '—'],
    ['出版社', m.publisher || '—'],
    ['出版年', m.publishedAt || best.candidate.year || '—'],
    ['页数', m.pages || '—'],
    ['ISBN', m.isbn || '—'],
    ['丛书', m.series || '—'],
    ['豆瓣评分', best.rating ? `${best.rating.score}（${best.rating.count ?? '?'} 人评价）` : '未解析到'],
  ];
  for (const [k, v] of rows) console.log(`    ${k.padEnd(8, '　')} ${v}`);

  if (results.length > 1) {
    console.log('');
    console.log(color(`  ▸ 其他版本（共比较 ${results.length} 个）`, C.dim));
    for (const r of results) {
      if (r === best) continue;
      console.log(
        color(
          `    ${(r.meta.title || r.candidate.title).padEnd(24)} ${String(r.meta.publishedAt || r.candidate.year).padEnd(10)} ` +
            `${String(r.rating?.score ?? '?').padStart(4)} 分  ${String(r.rating?.count ?? '?').padStart(7)} 人`,
          C.dim,
        ),
      );
    }
  }

  /* ---------------- 标签建议 ---------------- */
  const suggestions = suggestFromMeta(best.meta);
  console.log('');
  console.log(color('  ▸ 标签建议（系统只能从书名/关键词推断，务必人工核对）', C.bold));
  if (!suggestions.length) {
    console.log(color('    书名里没有可推断的标签线索，请到「添加小说」页手动选择。', C.dim));
  } else {
    for (const cat of TAG_CATEGORIES) {
      const items = suggestions.filter((s) => s.category === cat.id);
      if (!items.length) continue;
      console.log(`    ${cat.label}：${items.map((s) => `${s.label}(${s.level === 'high' ? '明确' : '可能'})`).join('  ')}`);
    }
  }

  /* ---------------- 可粘贴的数据骨架 ---------------- */
  console.log('');
  console.log(color('  ▸ 可直接粘贴进 data/books/ 的条目骨架', C.bold));
  const authorCn = (m.author || best.candidate.author || '').replace(/^\[[^\]]*\]\s*/, '');
  const tags = suggestions.map((s) => s.id);
  const skeleton = {
    id: '替换为唯一-id-001',
    title: m.title || best.candidate.title,
    originalTitle: m.originalTitle || '',
    author: authorCn,
    authorEn: '',
    genre: '本格推理',
    firstPublished: (m.publishedAt || best.candidate.year || '').match(/\d{4}/)?.[0] ?? '',
    series: m.series || '',
    detective: '',
    country: '',
    tags: tags.length ? tags : ['替换为标签 id'],
    safeSummary: '【必须由人撰写：只写设定与悬念，不写凶手、手法、结局，≤100 字】',
    recommendationReason: '',
    ratings: {
      douban: {
        score: best.rating?.score ?? null,
        count: best.rating?.count ?? null,
        scale: '10 分制',
        source: '豆瓣读书（实时抓取）',
        sourceUrl: best.candidate.url,
        subjectId: best.candidate.id,
        edition: `${m.title || best.candidate.title}${m.publishedAt ? ` ${m.publishedAt}` : ''}`,
        fetchedAt: new Date().toISOString(),
        asOf: new Date().toISOString().slice(0, 7),
        summary: '【补写一句去剧透评价摘要，或写「暂无数据」】',
      },
      hupu: { score: null, count: null, source: '虎扑', asOf: null, summary: '暂无数据' },
      goodreads: { score: null, count: null, source: 'Goodreads', asOf: null, summary: '暂无数据' },
    },
    readingTips: {
      suitableFor: ['【读者类型，如：喜欢封闭空间群像案件的读者】'],
      watchFor: ['【观察维度，只写「留意什么」，不写答案】'],
      warning: '',
    },
    vault: { culprit: '', coreTrick: '', ending: '', notes: '' },
    origin: 'seed',
    verification: { verified: true, verifiedAt: new Date().toISOString().slice(0, 10), source: '脚本从豆瓣补全元数据，梗概与标签经人工核对' },
  };
  console.log(JSON.stringify(skeleton, null, 2).split('\n').map((l) => `  ${l}`).join('\n'));

  console.log('');
  console.log(color('  提示：', C.bold));
  console.log('    · 本工具**不抓取内容简介**——豆瓣简介常含剧透，无剧透梗概必须由人撰写');
  console.log('    · 骨架里的 safeSummary / summary / readingTips 都需要人工填写');
  console.log('    · 填好后运行 npm run gen:seed && npm run check 验证');
  console.log('');
}

main().catch((error) => {
  console.error(color(`\n✗ 查询异常：${error.stack ?? error.message}\n`, C.red));
  process.exit(1);
});
