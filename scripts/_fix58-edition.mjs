/**
 * 一次性修补：`editionYear` 回填复核后的 5 处修正 + 2 条异名同书归并
 * ==============================================================
 * 依据 `scripts/audit-edition-year.mjs` 的复核结果（219 吻合 / 5 仅作者吻合）：
 *
 *  1. 《御手洗洁的问候》**填错了**——该馆只有《御手洗洁的旋律》(新星 2011.03)，
 *     回填按作者吻合把它当成了《问候》的著录。**清空** `editionYear` 并留下说明。
 *  2. 另外 4 条属「题名变体」：馆藏题名与库内题名略异（莫格街／莫尔格街、天帝之狐／天帝妖狐、
 *     大唐狄公案,广州案／广州案、柳园图奇案／柳园图）。年份本身没错，
 *     但来源文本里引的是**库内题名**，会让人误以为馆藏题名一模一样——
 *     全部改写成**馆藏原始题名**。
 *  3. 顺带把两处「异名同书」登记进 `alternateTitles`（复核对出来的硬证据）：
 *     《刀》←《刀锋》（同为奈斯博 *Kniv*，提要里出现「未婚夫」斯韦恩·芬内），
 *     《双轮马车的秘密》←《双轮马车谜案》（同为休姆 *The Mystery of a Hansom Cab*）。
 */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';

const DIR = 'data/books';
const files = readdirSync(DIR).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
const dirty = new Map();
const load = (f) => {
  if (!dirty.has(f)) dirty.set(f, JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8')));
  return dirty.get(f);
};
const find = (title, extra = () => true) => {
  for (const f of files) {
    const arr = JSON.parse(readFileSync(`${DIR}/${f}`, 'utf8'));
    if (!Array.isArray(arr)) continue;
    for (const b of arr) if (b.title === title && extra(b)) return { f, b };
  }
  return null;
};

const log = [];

// ── 1. 《御手洗洁的问候》：清空填错的 editionYear ──────────────────
{
  const hit = find('御手洗洁的问候', (b) => b.author === '岛田庄司');
  if (hit) {
    const b = load(hit.f).find((x) => x.id === hit.b.id);
    delete b.editionYear;
    delete b.verification.editionYearSource;
    b.verification.editionYearNote =
      '**曾误填 2011，已撤回（2026-09 复核）**：`backfill-edition-year.mjs` 依「作者吻合」判定同一本书，' +
      '而对外经贸大学图书馆的**题名检索实为宽松字面匹配**——《御手洗洁的问候》检索返回的作者吻合行其实是' +
      '**《御手洗洁的旋律》**（新星出版社 2011.03），两者是岛田庄司「御手洗洁系列」的**不同两本书**。' +
      '经 `audit-edition-year.mjs` 复核发现后清空；该馆未见《御手洗洁的问候》著录，故**留空**。';
    log.push(`清空 editionYear：${hit.b.title}（${hit.f}）`);
  }
}

// ── 2. 四条题名变体：来源文本改为引用馆藏原始题名 ────────────────
const VARIANTS = [
  {
    title: '莫尔格街凶杀案',
    author: '埃德加·爱伦·坡',
    catalogTitle: '莫格街凶杀案',
    note: '馆藏题名作「莫格街凶杀案」（无「尔」字），系同书异译名。',
  },
  {
    title: '天帝妖狐',
    author: '乙一',
    catalogTitle: '天帝之狐',
    note:
      '馆藏题名作「天帝之狐」。山西省图书馆 OPAC 的 MARC 记录显示该版（四川文艺出版社 2022，' +
      'ISBN 978-7-5411-6222-0）提要为「本书收录了《假面舞会》和《天帝妖狐》两部小说」——即**同一本书**，' +
      '馆藏题名与库内题名一字之差（之／妖）。',
  },
  {
    title: '广州案',
    author: '高罗佩',
    catalogTitle: '大唐狄公案,广州案',
    note: '馆藏以「大唐狄公案,广州案」为完整题名，即《大唐狄公案》中的《广州案》一卷。',
  },
  {
    title: '柳园图',
    author: '高罗佩',
    catalogTitle: '柳园图奇案',
    note: '馆藏题名作「柳园图奇案」（北岳文艺出版社 2018）。',
  },
];
for (const v of VARIANTS) {
  const hit = find(v.title, (b) => b.author === v.author);
  if (!hit) continue;
  const b = load(hit.f).find((x) => x.id === hit.b.id);
  const m = /：(.+?)（/.exec(b.verification.editionYearSource || '');
  const imprint = m ? m[1].replace(new RegExp(`（${v.title}／.*$`), '') : '';
  b.verification.editionYearSource =
    `**对外经贸大学图书馆 OPAC 著录**：${imprint}（馆藏题名「${v.catalogTitle}」／${v.author}著）。` +
    `${v.note}本条 \`editionYear\` 由 \`scripts/backfill-edition-year.mjs\` 按「作者吻合且该馆仅此一版」的规则回填，` +
    '并经 `scripts/audit-edition-year.mjs` 逐条复核（2026-09）。';
  log.push(`来源文本改用馆藏题名：${v.title} → 「${v.catalogTitle}」`);
}

// ── 3. 异名同书：登记 alternateTitles ──────────────────────────────
const ALIASES = [
  {
    title: '刀',
    author: '尤·奈斯博',
    alias: '刀锋',
    evidence:
      '《刀锋》（湖南文艺出版社 2022，ISBN 978-7-5726-0754-8 一系）经 `audit-edition-year.mjs` 复核：' +
      '馆藏提要出现「代号『未婚夫』的性侵犯斯韦恩·芬内」「哈利曾亲手将芬内逮捕」等情节，' +
      '与本条 *Kniv* 一致，判为**同一本书的另一中文题名**（2026-09）。',
  },
  {
    title: '双轮马车的秘密',
    author: '',
    alias: '双轮马车谜案',
    evidence:
      '《双轮马车谜案》（上海文艺出版社 2021，丛编「域外故事会」）与《双轮马车的秘密》同为休姆 *The Mystery of a Hansom Cab*，' +
      '经第 58 轮**中图法分类号整类枚举**候选比对时发现（2026-09）。',
  },
];
for (const a of ALIASES) {
  const hit = find(a.title, (b) => !a.author || String(b.author).includes(a.author));
  if (!hit) {
    log.push(`✗ 未找到《${a.title}》，异名未登记`);
    continue;
  }
  const b = load(hit.f).find((x) => x.id === hit.b.id);
  b.alternateTitles = [...new Set([...(b.alternateTitles || []), a.alias])];
  b.verification.alternateTitleNote = `${(b.verification.alternateTitleNote || '')}${b.verification.alternateTitleNote ? ' ' : ''}${a.evidence}`;
  log.push(`登记异名：《${a.title}》←「${a.alias}」`);
}

for (const [f, arr] of dirty) writeFileSync(`${DIR}/${f}`, JSON.stringify(arr, null, 2) + '\n', 'utf8');
console.log(log.join('\n'));
console.log(`\n写入 ${dirty.size} 个文件`);
