#!/usr/bin/env node
/**
 * 诡计类标签补标 · 候选提取 `suggest-trick-tags`
 * ============================================
 * 全库有 700 余条**没有任何「诡计类」标签**（`check-data.mjs` 会逐条警告），
 * 这直接拉低推荐质量——推荐权重里诡计类是 3.0，最高。
 *
 * 但**不能凭题名猜**。反例就在库里：batch-172 的《玻璃密室》题名带「密室」，
 * 馆藏却没有任何提要能证明它是本格意义上的密室杀人，当时就**故意没标** `locked-room`。
 *
 * 所以本脚本只认**文本里明确写出机制**的情形，并且**把命中原文一并打印出来**，
 * 供人工逐条核对；脚本本身**只输出建议，不改数据**。
 *
 * 用法：
 *   node scripts/suggest-trick-tags.mjs                 # 打印统计 + 写 _dd/trick-suggest.tsv
 *   node scripts/suggest-trick-tags.mjs --min 2         # 只看命中 ≥2 个标签的
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';

const argv = process.argv.slice(2);
const MIN = Number(argv[argv.indexOf('--min') + 1]) || 1;

/** 诡计类 14 个标签（与 `_dd/_status.mjs`、`check-data.mjs` 的口径一致） */
const TRICK_TAGS = [
  'locked-room',
  'alibi',
  'narrative-trick',
  'timetable',
  'faceless-corpse',
  'vanished-weapon',
  'closed-circle',
  'multiple-solutions',
  'psychological-misdirection',
  'red-herring',
  'swap-murder',
  'nursery-rhyme',
  'cipher',
  'dual-role',
];

/**
 * 高精度触发词。**只收「说了机制是什么」的说法**，
 * 不收「密室」「孤岛」这类光有名词、可能是场景描写的词。
 */
const RULES = [
  ['locked-room', /密室(?:杀人|命案|案|诡计|手法|推理|讲义)|不可能犯罪|从内部(?:反锁|上锁)|门窗(?:反锁|从里面锁)|密闭空间(?:里|中)?的(?:尸体|命案)/],
  ['alibi', /不在场证明|不在现场证明|不在场証/],
  ['narrative-trick', /叙述(?:性)?诡计|人称诡计|叙述(?:者|层面)的诡计|被骗的是读者/],
  ['timetable', /时刻表(?:诡计|推理|作案)|列车时刻|行车时刻/],
  ['faceless-corpse', /无面尸|无脸尸|面部被毁|脸部被毁|毁容(?:的)?尸体|认不出(?:身份|面目)的尸体/],
  ['vanished-weapon', /凶器(?:消失|不见了|凭空)|消失的凶器/],
  ['closed-circle', /暴风(?:雨)?雪山庄|封闭(?:的)?(?:山庄|宅邸|空间)|与外界(?:完全)?隔绝/],
  ['multiple-solutions', /多重解答|多重真相|数种解答/],
  ['psychological-misdirection', /心理(?:误导|盲点|陷阱)|先入(?:为主)?的观念/],
  ['red-herring', /红鲱鱼|误导(?:性)?线索|假线索/],
  ['swap-murder', /交换杀人|互换杀人|替身杀人|交换(?:的)?对象/],
  ['nursery-rhyme', /童谣|儿歌(?:杀人)?| nursery/],
  ['cipher', /密码(?:信|本|表)?(?:被|的)?(?:破解|解开|暗号)|暗号|密码学| cipher/],
  ['dual-role', /一人分饰|双胞胎(?:诡计|调换)|变装|易容|冒充(?:某人|身份)/],
];

/**
 * **外部证据专用**的宽松判据。
 *
 * 编目提要是**图书馆写的**，没有本库的无剧透约束，写明「密室」「不在场证明」
 * 就是在交代这本书的机制，因此**出现机制名词即可**，不要求后面紧跟机制词。
 * 自库文本仍用上面那套严格判据（因为本库梗概按规范**故意不写机制**）。
 */
const EXT_RULES = [
  ['locked-room', /密室|不可能犯罪|从内部反锁|门窗反锁/],
  ['alibi', /不在场(?:证明|场证明)|不在现场证明/],
  ['narrative-trick', /叙述(?:性)?诡计|人称诡计/],
  ['timetable', /时刻表|列车时刻|行车时刻/],
  ['faceless-corpse', /无面尸|无脸尸|毁容|面目全非/],
  ['vanished-weapon', /凶器(?:消失|不见|凭空)/],
  ['closed-circle', /暴风(?:雨)?雪山庄|封闭(?:的)?(?:山庄|宅邸)|与外界隔绝/],
  ['multiple-solutions', /多重解答|多重真相|数种解答/],
  ['psychological-misdirection', /心理(?:误导|盲点|陷阱)|先入为主/],
  ['red-herring', /红鲱鱼|误导(?:性)?线索|假线索/],
  ['swap-murder', /交换杀人|互换杀人|替身杀人/],
  ['nursery-rhyme', /童谣|儿歌/],
  ['cipher', /暗号|密码信|密码本|密码表/],
  ['dual-role', /一人分饰|双胞胎|变装|易容|冒充/],
];

const files = readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'));

/**
 * **否定词护栏**。第一版把《雾之旗》标成 `locked-room`——命中的是我们自己写的
 * 「社会派作品，重动机与人物处境，**没有**名侦探与不可能犯罪」。
 * 命中处前面 6 个字里出现否定词就丢弃。
 */
const NEGATED = (text, index) => /(没有|無|无|并非|并非|不是|谈不上|算不上|缺少|罕见)/.test(text.slice(Math.max(0, index - 6), index));
const all = [];
for (const f of files) {
  for (const b of JSON.parse(readFileSync(`data/books/${f}`, 'utf8'))) all.push({ ...b, __f: f });
}

/**
 * **外部证据**：馆藏编目提要（上图扫描 TSV 的第 13 列、两馆并查核实过的提要）。
 * 本库自己的 `safeSummary` 按无剧透规范**故意不写机制**，所以「文本里说了机制」的条目
 * 上一版只挖出 6 条；真正能当判据的是**编目提要**——它是图书馆写的，没有无剧透约束。
 * 键取（题名归一），命中时**必须作者也对得上**（沿用 shlib-blurb2 的教训）。
 */
const norm = (s) =>
  String(s || '')
    .replace(/[\s:：·・,，.。()（）[\]【】\-—_/、；;！!？?「」『』"']/g, '')
    .toLowerCase();
const normAuthor = (s) =>
  norm(s)
    .replace(/[（(][^）)]*[）)]/g, '')
    .replace(/[，,、；;。.]/g, '')
    .replace(/(编著|主编|著|编|译|绘|等)/g, '');
const authorOk = (want, got) => {
  const a = normAuthor(want);
  const b = normAuthor(got);
  if (!a || !b) return false;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  return short.length >= 2 && long.includes(short);
};

/** 编目提要索引：题名归一 → [{abs, author}] */
const ext = new Map();
const addExt = (title, who, abs) => {
  if (!title || !abs || abs.length < 40) return;
  const k = norm(title);
  if (!ext.has(k)) ext.set(k, []);
  ext.get(k).push({ abs, who });
};
for (const p of ['_dd/shlib-author.tsv', '_dd/shlib-author2.tsv']) {
  if (!existsSync(p)) continue;
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    if (!l.trim()) continue;
    const c = l.split('\t');
    if (c[1] === '__DONE__') continue;
    addExt(c[1], c[0], c[12] || '');
  }
}
if (existsSync('_dd/blurbs-verified.tsv')) {
  for (const l of readFileSync('_dd/blurbs-verified.tsv', 'utf8').split(/\r?\n/).slice(1)) {
    if (!l.trim()) continue;
    const c = l.split('\t');
    addExt(c[0], c[1], c[9] || '');
  }
}

/** 取该书的编目提要（题名 + 别名 + 原题，作者须吻合） */
const externalAbsOf = (b) => {
  const names = [b.title, ...(b.alternateTitles || []), b.originalTitle].filter(Boolean);
  const out = [];
  for (const n of names) {
    for (const e of ext.get(norm(n)) || []) if (authorOk(b.author, e.who)) out.push(e.abs);
  }
  /**
   * **包含匹配兜底**：库内题名与馆藏写法常差一个卷次数字或标点
   * （库内《心理罪·画像》对上馆藏《心理罪 2 画像》，《柳园图》对上《柳园图奇案》），
   * 只按完全相等取提要会白白丢掉证据。短边 ≥4 字时才做包含判断，仍然要求作者吻合。
   */
  if (!out.length) {
    for (const [k, list] of ext) {
      for (const n of names) {
        const a = norm(n);
        if (a.length < 4) continue;
        const [short, long] = a.length <= k.length ? [a, k] : [k, a];
        if (short.length >= 4 && long.includes(short)) {
          for (const e of list) if (authorOk(b.author, e.who)) out.push(e.abs);
        }
      }
    }
  }
  return out;
};

const noTrick = all.filter((b) => !(b.tags || []).some((t) => TRICK_TAGS.includes(t)));
const rows = [];
for (const b of noTrick) {
  // 只扫**公开可读**的字段：梗概、阅读提示、原题、系列、已有的非诡计标签；外加编目提要
  const own = [
    b.safeSummary || '',
    ...(b.readingTips?.watchFor || []),
    b.readingTips?.warning || '',
    b.originalTitle || '',
    b.series || '',
    ...(b.tags || []),
  ].join(' ｜ ');
  const exts = externalAbsOf(b);
  const extText = exts.join(' ｜ ');
  const hits = [];
  for (const [tag, re] of RULES) {
    const m = own.match(re);
    if (!m || NEGATED(own, m.index)) continue;
    hits.push({ tag, src: '自库', quote: own.slice(Math.max(0, m.index - 26), m.index + m[0].length + 26) });
  }
  for (const [tag, re] of EXT_RULES) {
    const m = extText.match(re);
    if (!m || NEGATED(extText, m.index)) continue;
    if (hits.some((h) => h.tag === tag)) continue;
    hits.push({
      tag,
      src: '编目提要',
      quote: extText.slice(Math.max(0, m.index - 26), m.index + m[0].length + 26),
    });
  }
  if (hits.length >= MIN) rows.push({ b, hits, hasExt: exts.length > 0 });
}

rows.sort((x, y) => y.hits.length - x.hits.length || x.b.title.localeCompare(y.b.title));

const out = ['文件\tid\t题名\t作者\t建议标签\t命中原文'];
for (const r of rows) {
  out.push(
    [
      r.b.__f,
      r.b.id,
      r.b.title,
      r.b.author,
      r.hits.map((h) => h.tag).join(','),
      r.hits.map((h) => `〈${h.tag}/${h.src}〉…${h.quote}…`).join('  '),
    ].join('\t'),
  );
}
writeFileSync('_dd/trick-suggest.tsv', out.join('\n') + '\n', 'utf8');

const byTag = new Map();
for (const r of rows) for (const h of r.hits) byTag.set(h.tag, (byTag.get(h.tag) || 0) + 1);
const bySrc = new Map();
for (const r of rows) for (const h of r.hits) bySrc.set(h.src, (bySrc.get(h.src) || 0) + 1);

console.log(`没有任何「诡计类」标签的条目：${noTrick.length} 条（全库 ${all.length}）`);
console.log(`编目提要索引：${ext.size} 个题名键`);
console.log(`其中**文本里明确写出机制**的：${rows.length} 条（建议标签 ${rows.reduce((s, r) => s + r.hits.length, 0)} 个）\n`);
console.log('判据来源：' + [...bySrc.entries()].map(([k, v]) => `${k} ${v}`).join('　'));
console.log('按标签分布：');
for (const [t, n] of [...byTag.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${t}  ${n}`);
console.log('\n明细 → _dd/trick-suggest.tsv');
