#!/usr/bin/env node
/**
 * 视图层回归测试
 * ==============
 * 在没有浏览器的环境里，用最小 DOM 实现真实跑一遍应用：
 *   1. bootstrap 能完成，不抛异常
 *   2. **每一条路由**都能渲染出内容，且不出现「页面加载失败」
 *   3. 视图里用到的每个 querySelector 都能命中真实元素
 *      （这条最关键：之前 app.js 把 ROUTES[route.name].load 误写成 route.load，
 *       以及视图选了不存在的节点，都会只在浏览器里才暴露）
 *   4. 关键交互（切换输入模式、生成报告、切页、hash 变化）不报错
 *
 * 运行：node scripts/test-views.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { installDom } from './lib/minidom.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

const REAL_INDEX_HTML = fs.readFileSync(path.join(ROOT, 'web', 'index.html'), 'utf8');

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ${color('✓', C.green)} ${name}${detail ? color(`  ${detail}`, C.dim) : ''}`);
  } else {
    failed += 1;
    console.log(`  ${color('✗', C.red)} ${name}${detail ? `  ${detail}` : ''}`);
  }
}

/** 捕获 console.error，用于判断视图是否报错 */
const errors = [];
const originalError = console.error;
console.error = (...args) => {
  const text = args
    .map((a) => (a instanceof Error ? (a.stack ?? a.message) : String(a)))
    .join(' ');
  errors.push(text);
};

process.on('unhandledRejection', (error) => {
  errors.push(`未处理的 Promise 异常: ${error?.stack ?? error}`);
});

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

const dom = installDom({
  hash: '#/analyze',
  url: 'http://127.0.0.1:8787/',
  html: REAL_INDEX_HTML,
});

console.log('');
console.log(color('  视图层回归测试（真实执行前端视图）', C.bold));
console.log(color('  ────────────────────────────────────────────', C.dim));

let app;
try {
  app = await import('../web/js/app.js');
} catch (error) {
  console.error = originalError;
  console.log(color(`  ✗ app.js 导入失败：${error.message}`, C.red));
  process.exit(1);
}

await dom.settle(80);

const main = dom.document.querySelector('#main');
const bodyText = () => String(main?.innerHTML ?? '');

/* ------------------------------------------------------------------ */
/* 1. 首屏                                                             */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [1] 首屏启动', C.dim));

const fatal = errors.filter((e) => e.includes('视图渲染失败') || e.includes('bootstrap'));
check('bootstrap 无致命异常', fatal.length === 0, fatal[0]?.slice(0, 160) ?? '');
check('首屏渲染出了内容', bodyText().length > 800, `${bodyText().length} 字节`);
check('未出现「页面加载失败」', !bodyText().includes('页面加载失败'));

/* ------------------------------------------------------------------ */
/* 2. 逐条路由                                                          */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [2] 逐条路由渲染', C.dim));

const ROUTES = [
  { hash: '#/analyze', name: '诡计分析', expect: '推理小说诡计标签分析' },
  { hash: '#/library', name: '知识库', expect: '知识库' },
  { hash: '#/tags', name: '标签体系', expect: '标签体系' },
  { hash: '#/compare', name: '作品对比', expect: '作品对比' },
  { hash: '#/manage', name: '添加小说', expect: '添加' },
  { hash: '#/about', name: '关于本系统', expect: '关于本系统' },
  { hash: '#/book/western-001', name: '书籍档案', expect: '无人生还' },
  { hash: '#/analyze?id=western-001', name: '分析（带 id）', expect: '诡计标签' },
  { hash: '#/library?tag=locked-room', name: '知识库（带筛选）', expect: '知识库' },
  { hash: '#/library?q=密室', name: '知识库（带搜索）', expect: '知识库' },
];

for (const route of ROUTES) {
  const before = errors.length;
  // 通过真实的 hash 变化驱动路由
  dom.window.location.hash = route.hash;
  dom.window.dispatchEvent({ type: 'hashchange' });
  await dom.settle(120);

  const html = bodyText();
  const newErrors = errors.slice(before);
  const crashed = html.includes('页面加载失败');
  check(
    `渲染 ${route.name}`,
    !crashed && newErrors.length === 0 && html.length > 500,
    crashed ? `报错：${html.match(/<p>([^<]*)<\/p>/)?.[1] ?? ''}` : newErrors[0]?.slice(0, 120) ?? `${html.length} 字节`,
  );
  if (route.expect && !crashed) {
    check(`  └ 内容匹配「${route.expect}」`, html.includes(route.expect));
  }
  // 渲染产物里不允许出现未展开的对象或**被转义的 HTML 标签**。
  // 后者是真实事故：对模板数组调用 .join('') 会让 SafeHtml 退化成普通字符串，
  // 再插值进 html`` 就被转义，页面上直接显示 <div class="…"> 这样的源码。
  check(`  └ 无 [object Object] 残留`, !html.includes('[object Object]'));
  const escapedMarkup = (html.match(/&lt;(div|span|label|button|a|ul|li|table|tr|td|th|p)\s/gi) ?? []).length;
  check(`  └ 无被转义的 HTML 标签`, escapedMarkup === 0, escapedMarkup ? `${escapedMarkup} 处` : '');
}

/* ------------------------------------------------------------------ */
/* 3. 视图内的选择器都能命中                                            */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [3] 未知路由与边界', C.dim));

dom.window.location.hash = '#/nonexistent-route';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(120);
check('未知路由回退到首页且不崩', !bodyText().includes('页面加载失败'));

dom.window.location.hash = '#/book/does-not-exist';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(120);
const notFoundHtml = bodyText();
check('不存在的书籍显示友好提示', notFoundHtml.includes('未找到该作品') || notFoundHtml.includes('没有 id 为'), '');
check('不存在的书籍不显示崩溃页', !notFoundHtml.includes('页面加载失败'));

/* ------------------------------------------------------------------ */
/* 4. 关键交互                                                          */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [4] 关键交互', C.dim));

// 回到分析页
dom.window.location.hash = '#/analyze';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(200);

// 视图重绘可能尚未落定，重新取一次元素引用
const modeButtons = dom.document.querySelectorAll('[data-mode]');
check('分析页渲染出输入方式切换按钮', modeButtons.length >= 2, `${modeButtons.length} 个`);

const customBtn = modeButtons.find((b) => b.dataset.mode === 'custom');
if (customBtn) {
  const before = errors.length;
  customBtn.dispatchEvent({ type: 'click' });
  await dom.settle(60);
  check('切换到「输入新作品」不报错', errors.length === before, errors.slice(before)[0]?.slice(0, 120) ?? '');
  const customPanel = dom.document.querySelector('[data-panel="custom"]');
  check('自定义输入面板存在且被显示', customPanel !== null && !customPanel.classList.contains('hidden'));
}

// 书籍列表点击 → 生成报告
let resultItems = dom.document.querySelectorAll('.result-item');
check('书籍列表渲染出条目', resultItems.length > 0, `${resultItems.length} 条`);
if (resultItems.length) {
  const before = errors.length;
  resultItems[0].dispatchEvent({ type: 'click' });
  await dom.settle(220);
  const html = bodyText();
  const reportBody = dom.document.querySelector('#report-body');
  const freshArea = dom.document.querySelector('#report-area');

  // 临时插桩：对比 App 引用的节点与文档中的节点
  const allAreas = [];
  const collect = (node) => {
    for (const c of node.childNodes ?? []) {
      if (c.nodeType !== 3 && c.id === 'report-area') allAreas.push(c);
      if (c.childNodes) collect(c);
    }
  };
  collect(dom.document.body);
  const liveMain = dom.document.querySelector('#main');
  check(
    '点击书籍后生成报告',
    html.includes('report-body') || html.includes('安全自检'),
    `${html.length} 字节；#report-body ${reportBody ? `存在(${reportBody.innerHTML.length})` : '不存在'}；` +
      `测试引用 === 文档节点: ${main === liveMain}；` +
      `文档 #main 长度=${liveMain?.innerHTML.length}；#report-area 长度=${allAreas.map((a) => a.innerHTML.length).join('/')}`,
  );
  check('生成报告不报错', errors.length === before, errors.slice(before)[0]?.slice(0, 160) ?? '');
  check('报告包含六个章节标题', html.includes('一、小说基础信息') && html.includes('六、给用户的阅读提示'));
  check('报告未包含剧透警告横幅', !html.includes('反剧透自检未通过'));
  check('报告区无 [object Object] 残留', !html.includes('[object Object]'));
  const reportEscaped = (html.match(/&lt;(div|span|label|button|table|tr|td|th|ul|li)\s/gi) ?? []).length;
  check('报告区无被转义的 HTML 标签', reportEscaped === 0, reportEscaped ? `${reportEscaped} 处` : '');
}

// 作品对比：切换下拉框
dom.window.location.hash = '#/compare';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(150);
const selectA = dom.document.querySelector('#cmp-a');
if (selectA) {
  const before = errors.length;
  selectA.value = 'western-001';
  selectA.dispatchEvent({ type: 'change' });
  await dom.settle(80);
  const html = bodyText();
  check('作品对比切换作品不报错', errors.length === before, errors.slice(before)[0]?.slice(0, 120) ?? '');
  check('作品对比显示相似度结论', html.includes('相似度') || html.includes('标签级差异'));
}

/* ------------------------------------------------------------------ */
/* 5. 数据源探测                                                        */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [5] 存储降级', C.dim));

const { store } = await import('../web/js/core/store.js');
check('fetch 探测失败时降级为本地模式', store.mode === 'local', `mode=${store.mode}`);
check('本地模式加载了种子知识库', store.all().length >= 70, `${store.all().length} 部`);
check('知识库包含带来源链接的实时评分', store.all().some((b) => b.ratings?.douban?.sourceUrl));

/* ------------------------------------------------------------------ */
/* 6. 敏感模式                                                          */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [6] 敏感模式（连标签都不显示）', C.dim));

const { setSensitive, isSensitive } = await import('../web/js/core/sensitive.js');

/**
 * 页面上是否残留任何标签痕迹。
 *
 * 判定方式是**扫 HTML 元素本身**，而不是扫纯文本：
 * 有些标签名与流派名/常识词重合（「社会派」「列车」「孤岛」「日常之谜」），
 * 纯文本扫描会误报——例如无剧透简介里出现「列车」是正常的。
 * 真正的泄露长这样（真实发生过）：
 *   - 元素带 badge-trick / badge-school / tag-chip 等类名
 *   - 文案含「核心诡计同属 `…`」这类把标签名包进反引号的匹配依据
 */
function sensitiveLeaks(html) {
  const leaks = [];

  // 1. 标签类元素（按类名精确匹配，避免误伤普通文本）
  for (const cls of [
    'badge-trick',
    'badge-school',
    'badge-narrative',
    'badge-scene',
    'badge-motive',
    'badge-theme',
    'tag-chip',
    'tag-picker',
    'tag-cloud',
  ]) {
    if (new RegExp(`class="[^"]*\\b${cls}\\b`).test(html)) leaks.push(`元素 .${cls}`);
  }

  // 2. data-tag / data-suggest / data-manual / data-quick 等标签相关的数据属性
  for (const attr of ['data-tag', 'data-suggest', 'data-manual', 'data-quick']) {
    if (new RegExp(`${attr}=`).test(html)) leaks.push(`属性 ${attr}`);
  }

  // 3. 把标签名包进反引号的匹配依据文案
  for (const phrase of ['核心诡计同属', '共享标签', '核心标签', '同属 `', '匹配明细（为什么是这几本）']) {
    if (html.includes(phrase)) leaks.push(`文案「${phrase}」`);
  }

  return leaks;
}

check('初始状态为普通模式', isSensitive() === false);

setSensitive(true);
await dom.settle(60);
check('开启后 isSensitive() 为 true', isSensitive() === true);
check('html[data-sensitive] 已置为 on', dom.document.documentElement.dataset.sensitive === 'on');

const SENSITIVE_ROUTES = [
  ['#/analyze', '诡计分析'],
  ['#/library', '知识库'],
  ['#/book/western-001', '书籍档案'],
  ['#/about', '关于本系统'],
];

for (const [hash, name] of SENSITIVE_ROUTES) {
  dom.window.location.hash = hash;
  dom.window.dispatchEvent({ type: 'hashchange' });
  await dom.settle(150);

  const html = bodyText();
  const leaks = sensitiveLeaks(html);

  check(`敏感模式 · ${name} 渲染成功`, html.length > 500 && !html.includes('页面加载失败'), `${html.length} 字节`);
  check(`敏感模式 · ${name} 无标签泄露`, leaks.length === 0, leaks.slice(0, 4).join('；'));
  if (name === '诡计分析') {
    check('  └ 分析页提示处于敏感模式', html.includes('敏感模式'));
  }
  if (name === '书籍档案') {
    check('  └ 第二部分被替换为隐藏说明', html.includes('本节已按你的设置隐藏'));
  }
}

// 分析报告在敏感模式下的完整产物
dom.window.location.hash = '#/analyze?id=western-001';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(200);
const sensitiveReport = bodyText();
const reportLeaks = sensitiveLeaks(sensitiveReport);
check(
  '敏感模式 · 报告仍包含需求文档的六个章节',
  sensitiveReport.includes('一、小说基础信息') && sensitiveReport.includes('六、给用户的阅读提示'),
);
check('敏感模式 · 报告第二章节说明已隐藏', sensitiveReport.includes('本节已按你的设置隐藏'));
check('敏感模式 · 报告无标签泄露', reportLeaks.length === 0, reportLeaks.slice(0, 3).join('；'));
check(
  '敏感模式 · 报告保留无剧透简介与平台评价',
  sensitiveReport.includes('三、无剧透简介') && sensitiveReport.includes('五、平台评价参考'),
);
check(
  '敏感模式 · 推荐理由换为中性文案',
  /阅读体验与本书相近|整体气质与本书接近|感受层面与本书相似/.test(sensitiveReport),
);

// 切回普通模式
setSensitive(false);
await dom.settle(60);
dom.window.location.hash = '#/analyze?id=western-001';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(200);
const normalReport = bodyText();
check('切回普通模式后标签恢复显示', normalReport.includes('badge-trick') || normalReport.includes('密室'));
check('切回普通模式后 data-sensitive 为 off', dom.document.documentElement.dataset.sensitive === 'off');

/* ------------------------------------------------------------------ */
/* 7. 编辑表单的流派维度                                                */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [7] 添加/编辑表单的流派维度', C.dim));

// 回归测试：流派存在 schoolTags 字段，表单曾经只回填 tags，
// 导致编辑既有作品时流派复选框全是未勾选、一保存就把流派标注抹掉。
const editTarget = store.all().find((b) => (b.schoolTags ?? []).length > 0 && (b.tags ?? []).length > 0);
check('知识库中存在带流派标注的作品', Boolean(editTarget), editTarget?.title ?? '无');

if (editTarget) {
  dom.window.location.hash = `#/manage?id=${editTarget.id}`;
  dom.window.dispatchEvent({ type: 'hashchange' });
  await dom.settle(200);

  const formHtml = bodyText();
  check('编辑表单渲染成功', !formHtml.includes('页面加载失败'));

  // 该作品的所有流派都必须是勾选状态
  const uncheckedSchool = (editTarget.schoolTags ?? []).filter((id) => {
    const re = new RegExp(`data-tag="${id}"(?![^>]*checked)`);
    return re.test(formHtml.replace(/\s+/g, ' '));
  });
  check(
    `编辑时流派已回填勾选（${editTarget.title}）`,
    uncheckedSchool.length === 0,
    uncheckedSchool.join('、'),
  );

  // 流派在表单里的收录数不能恒为 0（曾经只统计 tags 字段）
  const schoolCountZero = (editTarget.schoolTags ?? []).filter((id) =>
    new RegExp(`data-tag="${id}"[\\s\\S]{0,220}?<span class="count">0</span>`).test(formHtml),
  );
  check('流派标签的收录数非 0', schoolCountZero.length === 0, schoolCountZero.join('、'));

  // 表单渲染出的标签里，流派类不应混入诡计类的勾选集合
  check('编辑表单保留流派分类标题', formHtml.includes('流派'), '');
}

// 触发保存，确认两个维度分开落库
if (editTarget) {
  const before = errors.length;
  const form = dom.document.querySelector('#book-form');
  // 先改一处显式可见的字段，用来证明「提交-保存」这条链路真的跑通了；
  // 否则 saved 仍等于 editTarget，下面的断言会无条件通过（假绿）。
  const SENTINEL = `${editTarget.title}·流派回归`;
  const titleEl = dom.document.querySelector('#f-title');
  if (titleEl) titleEl.value = SENTINEL;

  form?.dispatchEvent({ type: 'submit', preventDefault() {}, target: form });
  await dom.settle(300);

  const saved = store.get(editTarget.id);
  check('保存未报错', errors.length === before, errors.slice(before)[0]?.slice(0, 140) ?? '');
  check('提交确实触发了保存', saved?.title === SENTINEL, `实际标题：${saved?.title ?? '(未找到)'}`);
  check(
    '保存后流派仍在 schoolTags 中',
    (saved?.schoolTags ?? []).length === (editTarget.schoolTags ?? []).length,
    `期望 ${editTarget.schoolTags?.length ?? 0} 个，实际 ${saved?.schoolTags?.length ?? 0} 个`,
  );
  check(
    '保存后 tags 中不混入流派 id',
    !(saved?.tags ?? []).some((id) => (editTarget.schoolTags ?? []).includes(id)),
    (saved?.tags ?? []).filter((id) => (editTarget.schoolTags ?? []).includes(id)).join('、'),
  );
  check(
    '保存后 tags 内容未被破坏',
    JSON.stringify([...(saved?.tags ?? [])].sort()) === JSON.stringify([...(editTarget.tags ?? [])].sort()),
  );
}

/* ------------------------------------------------------------------ */
/* 8. 评分排名（与标签筛选正交）                                        */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [8] 评分排名', C.dim));

/** 读出当前结果网格里的卡片（含名次角标与评分文本） */
function readCards() {
  return [...dom.document.querySelectorAll('.book-card')].map((el) => ({
    rank: el.querySelector('.rank')?.textContent?.trim() ?? null,
    rating: el.querySelector('.rating')?.textContent?.trim() ?? '',
    title: el.querySelector('h3')?.textContent?.trim() ?? '',
  }));
}

/** 打开知识库页并按给定方式排序 */
async function openLibrarySorted(sort, extra = '') {
  dom.window.location.hash = `#/library?sort=${sort}${extra}`;
  dom.window.dispatchEvent({ type: 'hashchange' });
  await dom.settle(220);
}

/**
 * 「这本不是一个人写的」徽章在视图层真的渲染出来了吗？
 * 没有浏览器可用，DOM 级断言是唯一的证据，所以单独立一条用例。
 */
async function openLibrarySearch(q) {
  dom.window.location.hash = `#/library?q=${encodeURIComponent(q)}`;
  dom.window.dispatchEvent({ type: 'hashchange' });
  await dom.settle(220);
}

function collabBadges() {
  return [...dom.document.querySelectorAll('.badge-collab')].map((el) => ({
    text: el.textContent.replace(/\s+/g, ' ').trim(),
    title: el.getAttribute('title') ?? '',
    cls: el.className,
  }));
}

/** 结果总数（渲染是分页的，卡片数会停在 PAGE_SIZE，不能用它比较收窄） */
function resultCount() {
  const el = dom.document.querySelector('#lib-count');
  return Number(String(el?.textContent ?? '').replace(/\D/g, '')) || 0;
}

/* ---- 多人协作徽章（合著 / 合集）---- */
await openLibrarySearch('失踪的消防车');
{
  const badges = collabBadges();
  check(
    '合著作品在卡片上渲染「合著」徽章',
    badges.some((b) => b.text.includes('合著') && b.cls.includes('badge-collab-coauthor')),
    badges.map((b) => b.text).join(' / ') || '（没有徽章）',
  );
  check(
    '合著徽章带 title 说明是哪几位',
    badges.some((b) => /共同创作/.test(b.title)),
    badges[0]?.title ?? '（无）',
  );
}
await openLibrarySearch('马普尔小姐历险记');
{
  const badges = collabBadges();
  check(
    '合集在卡片上渲染「合集」徽章',
    badges.some((b) => b.text.includes('合集') && b.cls.includes('badge-collab-anthology')),
    badges.map((b) => b.text).join(' / ') || '（没有徽章）',
  );
  check(
    '合集徽章说明作者名单只登记了一部分',
    badges.some((b) => /领衔作者/.test(b.title)),
    badges[0]?.title ?? '（无）',
  );
}

/* ---- 用「次要合著者」也要搜得到 ----
   回归测试：搜索 haystack 起初只放了 `author`（展示标签），
   于是「佩尔·瓦勒」查不到《失踪的消防车》——读者按作者找书会直接扑空。 */
{
  const hits = await searchLibrary('佩尔');
  check('用次要合著者「佩尔」能搜到《失踪的消防车》', hits.includes('失踪的消防车'), hits.join(' / ') || '（无结果）');
  const hits2 = await searchLibrary('佩尔·瓦勒');
  check('用全名「佩尔·瓦勒」也能搜到', hits2.includes('失踪的消防车'), hits2.join(' / ') || '（无结果）');
  const hits3 = await searchLibrary('舍瓦尔');
  check('用第一署名人「舍瓦尔」同样搜得到', hits3.includes('失踪的消防车'), hits3.join(' / ') || '（无结果）');
  const hits4 = await searchLibrary('今野敏');
  check('用合集里第三位作者「今野敏」能搜到《关闭之殇》', hits4.includes('关闭之殇'), hits4.join(' / ') || '（无结果）');
  // 间隔号很难打对：读者更常打成「佩尔瓦勒」或「佩尔 瓦勒」，
  // 这两种写法如果搜不到，读者只会以为库里没有这本书
  const hits5 = await searchLibrary('佩尔瓦勒');
  check('不打间隔号的「佩尔瓦勒」也搜得到（分隔符不敏感）', hits5.includes('失踪的消防车'), hits5.join(' / ') || '（无结果）');
  const hits6 = await searchLibrary('佩尔 瓦勒');
  check('用空格分隔的「佩尔 瓦勒」也搜得到', hits6.includes('失踪的消防车'), hits6.join(' / ') || '（无结果）');
}
await openLibrarySearch('阿加莎·克里斯蒂');
{
  // 单作者作品绝不能出现徽章——否则标签就失去意义了
  const solo = readCards().filter((c) => !/等|编/.test(c.title));
  const badges = collabBadges();
  check(
    '单作者作品不渲染协作徽章',
    solo.length > 0 && badges.length === 0,
    `${solo.length} 张卡片，${badges.length} 个徽章`,
  );
}

/* ---- 搜索框与 URL 的一致性（第 123 轮修的真实反馈）----
   反馈原话：「每次刷新之后，知识库的搜索框都是佩尔」。
   根因有两条，测试各盯一条：
     ① 只在「点排序按钮」时写 URL，改完搜索词却不写——于是 URL 里留着一个过期的
        `q`，读者清掉搜索框、点「清空筛选」之后，一刷新又被 `route.params` 填回来；
     ② 浏览器的表单状态恢复也会把上一次在这个框里输入过的词填回来，故搜索框必须
        `autocomplete="off"`。
   这里用「改完筛选 → 再派发一次 hashchange（等价于刷新后的重新路由）」
   来复现：如果 URL 没同步干净，重新路由就会把旧关键词装回输入框。 */
{
  await openLibrarySearch('佩尔');
  const box = dom.document.querySelector('#lib-search');
  check('带 q 打开知识库时搜索框回填该词', box.value === '佩尔', box.value || '（空）');
  check('搜索框禁用浏览器自动填充', box.getAttribute('autocomplete') === 'off', box.getAttribute('autocomplete') ?? '（无该属性）');

  // ① 清空搜索框：URL 里的 q 必须一起消失
  box.value = '';
  box.dispatchEvent({ type: 'input' });
  await dom.settle(120);
  check('清空搜索框后 URL 不再带 q', !/q=/.test(dom.window.location.hash), dom.window.location.hash);

  // ② 点「清空筛选」：URL 必须整个清干净，且重新路由后搜索框仍是空的
  await openLibrarySearch('佩尔');
  dom.document.querySelector('#lib-reset').click();
  await dom.settle(120);
  check('「清空筛选」后 URL 里没有任何筛选参数', dom.window.location.hash === '#/library', dom.window.location.hash);

  dom.window.dispatchEvent({ type: 'hashchange' }); // 等价于刷新后的重新路由
  await dom.settle(220);
  const after = dom.document.querySelector('#lib-search');
  check('重新路由（刷新）后搜索框不再出现旧关键词', (after?.value ?? '') === '', after?.value || '（空）');

  // ③ 输入关键词后 URL 也要立刻跟上（否则下一次刷新会退回上一个词）
  after.value = '密室';
  after.dispatchEvent({ type: 'input' });
  await dom.settle(120);
  check('输入关键词后 URL 同步为当前词', /q=%E5%AF%86%E5%AE%A4|q=密室/.test(dom.window.location.hash), dom.window.location.hash);
}

await openLibrarySorted('rating');
const totalCount = resultCount();let cards = readCards();
check('按评分排名时渲染出卡片', cards.length > 0, `${cards.length} 张`);
check(
  '按评分排名时每张卡片带名次角标',
  cards.length > 0 && cards.every((c) => /^#\d+$/.test(c.rank ?? '')),
  cards[0]?.rank ?? '（无）',
);
check('名次从 #1 连续递增', cards.every((c, i) => c.rank === `#${i + 1}`), cards.map((c) => c.rank).slice(0, 5).join(' '));
check(
  '评分一律附带评价人数（否则无法判断分数可靠性）',
  // ⚠️ 不能用 filter(...).every(...)：若一张卡都没有 .rating，
  // filter 结果为空数组，every 会「空真」通过——这条断言曾经因此
  // 漏掉了「榜单头部全是无评分卡片」的真实故障。
  cards.length > 0 && cards.every((c) => /（.+人）/.test(c.rating)),
  `${cards.filter((c) => c.rating).length}/${cards.length} 张带评分；` +
    `缺评分：${cards
      .filter((c) => !c.rating)
      .slice(0, 3)
      .map((c) => c.title)
      .join('、')}`,
);

// 榜单头部必须是有评分的作品：无评分条目应沉底，不能占据前几名
check(
  '榜单前 10 名全部有评分',
  cards.slice(0, 10).every((c) => c.rating),
  cards
    .slice(0, 10)
    .filter((c) => !c.rating)
    .map((c) => c.title)
    .join('、'),
);

// 加权排名：样本极少的条目不应凭偶然高分占据榜首
const topTitles = cards.slice(0, 10).map((c) => c.title);
const thinBook = store
  .all()
  .filter((b) => typeof b.ratings?.douban?.count === 'number' && b.ratings.douban.count < 200 && b.ratings.douban.score >= 8)
  .map((b) => b.title);
const thinInTop = topTitles.filter((t) => thinBook.includes(t));
check(
  '低样本条目未因偶然高分挤进前 10',
  thinInTop.length === 0,
  thinInTop.join('、'),
);

// 排序是独立维度：加了标签筛选之后仍按评分排
await openLibrarySorted('rating', '&tag=locked-room');
const filtered = readCards();
const filteredCount = resultCount();
check('带标签筛选时仍能渲染结果', filtered.length > 0, `${filtered.length} 张`);
check(
  '标签筛选 + 评分排名：名次重新从 #1 开始',
  filtered.length > 0 && filtered[0].rank === '#1',
  filtered[0]?.rank ?? '（无）',
);
check(
  '标签筛选 + 评分排名：结果确实被标签收窄',
  filteredCount > 0 && filteredCount < totalCount,
  `筛选后 ${filteredCount} 部 < 全部 ${totalCount} 部`,
);

// 原始评分排序不应出现名次角标之外的排序模式（按年份排不需要名次）
await openLibrarySorted('year');
const yearCards = readCards();
check('按年份排序时不显示名次角标', yearCards.every((c) => c.rank === null), yearCards[0]?.rank ?? '');

/* --- 可发现性：排序必须是「看得见的按钮」，不能藏在下拉框里 --- */

// 回归测试：排序原本是一个没有可见标签的 <select>，不点开就看不到
// 「评分排名」这个选项，真实反馈过「找不到排名按钮在哪里」。
await openLibrarySorted('year');
const chips = [...dom.document.querySelectorAll('#lib-sort .sort-chip')];
check('排序选项以按钮形式直接可见', chips.length >= 5, `${chips.length} 个按钮`);
check('排序控件不再是下拉框', dom.document.querySelector('#lib-sort')?.tagName !== 'SELECT');
check(
  '「评分排名」按钮存在且文字可读',
  chips.some((c) => /评分排名/.test(c.textContent ?? '')),
  chips.map((c) => c.textContent?.trim()).join(' / '),
);
check(
  '存在可见的「排序」标签（下拉框时代完全没有标签）',
  dom.document.querySelector('.sort-label')?.textContent?.includes('排序') === true,
);

// 点击按钮即可切换排序，且选中态同步
const yearChip = chips.find((c) => c.dataset.sort === 'year');
const ratingChip = chips.find((c) => c.dataset.sort === 'rating');
check('按钮初始选中态与当前排序一致', yearChip?.getAttribute('aria-pressed') === 'true');

const beforeClick = errors.length;
ratingChip?.dispatchEvent({ type: 'click' });
await dom.settle(200);
check('点击「评分排名」按钮不报错', errors.length === beforeClick, errors.slice(beforeClick)[0]?.slice(0, 120) ?? '');
check('点击后切换为评分排名', readCards()[0]?.rank === '#1', readCards()[0]?.rank ?? '（无）');
const ratingChipAfter = dom.document.querySelector('#lib-sort .sort-chip[data-sort="rating"]');
const allChipsAfter = [...dom.document.querySelectorAll('#lib-sort .sort-chip')];
const compoundMatch = [...dom.document.querySelectorAll('.sort-chip[data-sort="rating"]')];
check(
  '点击后按钮选中态已同步',
  allChipsAfter.find((c) => c.dataset.sort === 'rating')?.getAttribute('aria-pressed') === 'true',
  `rating=${JSON.stringify(ratingChipAfter?.getAttribute('aria-pressed'))} | 复合选择器命中 ${compoundMatch.length} 个 | 全部=${allChipsAfter
    .map((c) => `${c.dataset.sort}:${c.getAttribute('aria-pressed')}`)
    .join(' ')} | hash=${dom.window.location.hash}`,
);
check(
  '复合选择器不应命中多个同名按钮（选择器引擎自检）',
  compoundMatch.length <= 1,
  `命中 ${compoundMatch.length} 个`,
);

// 默认排序：一进知识库就落在评分排名上
dom.window.location.hash = '#/library';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(220);
check(
  '默认排序即为评分排名（进页面就能看到榜单）',
  readCards()[0]?.rank === '#1',
  readCards()[0]?.rank ?? '（无）',
);

/* ------------------------------------------------------------------ */
/* 9. 敏感模式下的检索能力（回归）                                      */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [9] 敏感模式下的搜索与筛选', C.dim));

/** 在知识库页按关键词搜索，返回命中的书名 */
async function searchLibrary(keyword) {
  dom.window.location.hash = '#/library';
  dom.window.dispatchEvent({ type: 'hashchange' });
  await dom.settle(220);
  const input = dom.document.querySelector('#lib-search');
  input.value = keyword;
  input.dispatchEvent({ type: 'input' });
  await dom.settle(200);
  return readCards().map((c) => c.title);
}

const SAMPLE = '首无';
const normalHits = await searchLibrary(SAMPLE);
check(
  '普通模式下能搜到《首无作祟之物》',
  normalHits.some((t) => t.includes('首无')),
  `命中 ${normalHits.length} 条：${normalHits.slice(0, 3).join('、')}`,
);

// 回归测试：敏感模式隐藏的是「标签」，不是「检索能力」。
// 标签筛选块在敏感模式下整块不渲染，但关键词搜索必须照常工作，
// 否则用户会以为知识库里根本没有这本书。
setSensitive(true);
await dom.settle(120);
const sensitiveHits = await searchLibrary(SAMPLE);
check(
  '敏感模式下仍能搜到同一本书',
  sensitiveHits.some((t) => t.includes('首无')),
  `命中 ${sensitiveHits.length} 条：${sensitiveHits.slice(0, 3).join('、')}`,
);
check(
  '两种模式的搜索结果一致',
  JSON.stringify(normalHits) === JSON.stringify(sensitiveHits),
  `普通 ${normalHits.length} 条 / 敏感 ${sensitiveHits.length} 条`,
);

// 敏感模式下标签筛选器即使有容器，也不得包含任何标签名
// （占位说明文字是允许的；要求的是「没有标签元素」，不是「没有容器」）
const sensitiveTagsEl = dom.document.querySelector('#lib-tags');
const leakedTagEls = sensitiveTagsEl
  ? sensitiveTagsEl.querySelectorAll('.tag-chip, .tag-option, [data-tag]').length
  : 0;
check(
  '敏感模式下标签筛选器不含任何标签元素',
  leakedTagEls === 0,
  leakedTagEls ? `检出 ${leakedTagEls} 个标签元素` : '',
);
check(
  '敏感模式下搜索框仍然可用',
  dom.document.querySelector('#lib-search') !== null,
);

// 敏感模式下按评分排名仍可用
const sensitiveRank = readCards()[0]?.rank ?? null;
check('敏感模式下仍显示评分排名', sensitiveRank === null || /^#\d+$/.test(sensitiveRank), String(sensitiveRank));

setSensitive(false);
await dom.settle(120);

/* --- 用户实际操作顺序：先按标签筛选 → 再切敏感模式 → 再搜索 --- */

dom.window.location.hash = '#/library?tag=locked-room';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(220);
const filteredTotal = resultCount();
check('按「密室」标签筛选后结果被收窄', filteredTotal > 0 && filteredTotal < 494, `${filteredTotal} 部`);

setSensitive(true);
await dom.settle(200);
const afterSwitchTotal = resultCount();
check(
  '切到敏感模式后，标签筛选仍然生效（但界面已隐藏）',
  afterSwitchTotal === filteredTotal,
  `切换前 ${filteredTotal} 部 / 切换后 ${afterSwitchTotal} 部`,
);

// 这是用户报告的场景：在敏感模式下搜索被筛过的书
const hitInput = dom.document.querySelector('#lib-search');
hitInput.value = '首无';
hitInput.dispatchEvent({ type: 'input' });
await dom.settle(200);
const hitsAfterFilter = readCards().map((c) => c.title);
check(
  '敏感模式 + 标签筛选下仍能搜到目标书',
  hitsAfterFilter.some((t) => t.includes('首无')),
  `命中 ${hitsAfterFilter.length} 条：${hitsAfterFilter.join('、') || '（空）'}；当前筛选结果 ${resultCount()} 部`,
);

// 界面必须明确告知「筛选仍在生效但看不清」，否则用户会以为书丢了
const filterNotice = dom.document.querySelector('#lib-filter-notice');
check(
  '敏感模式下有可见提示说明筛选仍在生效',
  filterNotice !== null,
  filterNotice ? '' : '缺少 #lib-filter-notice 提示',
);

setSensitive(false);
await dom.settle(120);

/* ------------------------------------------------------------------ */
/* 10. 书籍档案的两栏布局                                              */
/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [10] 书籍档案布局', C.dim));

dom.window.location.hash = '#/book/western-001';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(220);

const profileLayout = dom.document.querySelector('.profile-layout');
check('档案页使用 profile-layout 布局', profileLayout !== null);
check(
  '档案页不再套用分析页的 report-layout',
  dom.document.querySelector('.report-layout') === null,
  '两页列序相反，复用会导致内容被压进窄列',
);

if (profileLayout) {
  const kids = [...profileLayout.children];
  check('档案页只有两栏', kids.length === 2, `${kids.length} 栏`);
  check('第一栏是内容区（宽列）', kids[0]?.classList.contains('profile-main') === true);
  check('第二栏是侧栏（窄列）', kids[1]?.classList.contains('side-panel') === true);

  // 内容卡片必须都在第一栏内，侧栏只放体检与导航
  const mainCards = kids[0]?.querySelectorAll('.card').length ?? 0;
  const sideCards = kids[1]?.querySelectorAll('.card').length ?? 0;
  check(
    '内容卡片集中在第一栏',
    mainCards >= 5 && mainCards > sideCards,
    `内容栏 ${mainCards} 张 / 侧栏 ${sideCards} 张`,
  );
  // 注意：侧栏里的折叠「完整 Markdown 报告」本身含推荐章节的**文本**，
  // 所以不能按文字判断，要按推荐区块元素判断
  check(
    '侧栏不含推荐区块（推荐属于内容栏）',
    (kids[1]?.querySelectorAll('.match-detail').length ?? 0) === 0,
    `侧栏检出 ${kids[1]?.querySelectorAll('.match-detail').length ?? 0} 个推荐区块`,
  );
}

// 静态检查：CSS 里 profile-layout 必须是「宽列在前」，与 report-layout 相反
const cssText = await readFile(new URL('../web/css/styles.css', import.meta.url), 'utf8');
const profileRule = cssText.match(/\.profile-layout\s*\{[^}]*grid-template-columns\s*:\s*([^;]+);/);
const reportRule = cssText.match(/\.report-layout\s*\{[^}]*grid-template-columns\s*:\s*([^;]+);/);
check(
  'profile-layout 的宽度列在前（1fr 在前、窄列在后）',
  Boolean(profileRule) && profileRule[1].trim().startsWith('minmax(0, 1fr)'),
  profileRule ? profileRule[1].trim() : '未找到规则',
);
check(
  'report-layout 保持窄列在前（分析页需要，不要被一起改掉）',
  Boolean(reportRule) && reportRule[1].trim().startsWith('clamp('),
  reportRule ? reportRule[1].trim() : '未找到规则',
);

/* ------------------------------------------------------------------ */

console.log('');
console.log(color('  [11] 无诡计类标签的作品仍能拿到推荐（放宽闸门）', C.dim));

// global-001《污血之玷》是冰岛刑侦小说，按"只标注确凿成立的标签"原则没有诡计类标签。
// 若引擎仍硬性要求"诡计机制高度相似"，这类作品会永远 0 推荐，
// 与"让任何小众读者都能找到书"的目标冲突。放宽必须发生，且必须**如实告知**。
dom.window.location.hash = '#/book/global-001';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(220);

const untaggedCards = [...dom.document.querySelectorAll('.match-detail')];
check(
  '没有诡计类标签的作品也能拿到推荐',
  untaggedCards.length > 0,
  `推荐区块 ${untaggedCards.length} 个`,
);
check(
  '页面明确告知本次推荐不含诡计维度',
  dom.document.body.textContent.includes('无法进行诡计机制比对'),
  '缺少 trickGate 提示，读者会误以为做过诡计比对',
);
check(
  '放宽只发生在无诡计标签的书上，不是全局关掉约束',
  dom.document.body.textContent.includes('本书未标注任何「诡计类」标签'),
);

// 对照组：有诡计类标签的书不应出现这条提示
dom.window.location.hash = '#/book/western-001';
dom.window.dispatchEvent({ type: 'hashchange' });
await dom.settle(220);
check(
  '有诡计类标签的作品不出现放宽提示',
  !dom.document.body.textContent.includes('无法进行诡计机制比对'),
);

/* ------------------------------------------------------------------ */

console.error = originalError;

console.log('');
console.log(color('  ────────────────────────────────────────────', C.dim));
console.log(`  通过 ${color(String(passed), C.green + C.bold)} 项，失败 ${failed ? color(String(failed), C.red + C.bold) : '0 项'}`);
if (errors.length) {
  console.log('');
  console.log(color(`  运行期捕获 ${errors.length} 条 console.error：`, C.dim));
  for (const e of errors.slice(0, 3)) {
    console.log(color(`    ────────────────────────────────`, C.dim));
    for (const line of e.split('\n').slice(0, 8)) console.log(color(`    ${line}`, C.dim));
  }
}
console.log('');

dom.uninstall();
process.exit(failed ? 1 : 0);
