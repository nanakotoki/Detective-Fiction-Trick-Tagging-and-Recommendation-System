import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

/**
 * 把「同书异名核查」查出来的别名登记进库内条目，并在证据串里留下记录。
 *
 * 本批（batch-176）：候选《凶镇》（化学工业出版社 2013）经上图 CNMARC 的
 * **统一／并列题名**字段定为 `Calamity town`，即**库内已有的《灾难之城》**，
 * 因此不再另收一条，而是把「凶镇」登记为别名——否则下一轮扫描还会把它当新书报上来。
 */
/**
 * **系列名归一**（第 87 轮）。
 *
 * 由 `scripts/audit-series-names.mjs` 扫出 24 组「去尾词后同干」的系列名。
 * **不是全部都要合**——先分两类：
 *   · **要合的**：同一系列被写成两种名字，差别只在尾词或同义尾词
 *     （「大唐狄公案」/「大唐狄公案系列」；「霍桑探案集」/「霍桑探案系列」；「亚森·罗平探案集」/「亚森·罗平系列」）；
 *   · **不动的**：带括号副题的写法是**刻意**的，括号里标的是「短篇集／中篇集／终章／全六部」
 *     这类**体裁或批次信息**（如「赫尔克里·波洛系列（短篇集）」）。
 *     还有「大唐悬疑录」这种**同一系列名下其实是两组不同主角**（裴玄静／狄仁杰、袁从英）
 *     的情况——那是**该拆不该合**，留给日后处理。
 */
const RENAME_SERIES = [
  { from: '大唐狄公案', to: '大唐狄公案系列' },
  { from: '大唐悬疑录', to: '大唐悬疑录系列' },
  { from: '霍桑探案集', to: '霍桑探案系列' },
  { from: '亚森·罗平探案集', to: '亚森·罗平系列' },
  // 第 89 轮：同一系列的两种音译（Merlini）与三种写法（Harry Hole）
  { from: '梅里尼系列', to: '马里尼系列' },
  { from: '哈利·霍尔系列', to: '哈利·霍勒警探系列' },
  { from: '哈利·霍勒系列', to: '哈利·霍勒警探系列' },
];

/**
 * **主角名归一**（第 87 轮）。同一个系列里同一个人物写成两种名字，会让「同系列」的聚合与展示出错。
 * 只合**一个是另一个的前缀／明显同人**的情形，**不碰**「同一系列下的不同主角」。
 */
const RENAME_DETECTIVE = [
  // 福尔摩斯两种音译并存（歇洛克／夏洛克），取多数写法
  { from: '歇洛克·福尔摩斯', to: '夏洛克·福尔摩斯' },
  // 括号里是补充说明，不是另一个人
  { from: '菲利普·马洛（私家侦探）', to: '菲利普·马洛' },
  { from: '霍桑（叙述者包朗）', to: '霍桑、包朗' },
  // 第 89 轮：Merlini 的两种音译、Harry Hole 的两种音译
  { from: '梅里尼', to: '马里尼' },
  { from: '马里尼（The Great Merlini）', to: '马里尼' },
  { from: '哈利·霍尔', to: '哈利·霍勒' },
];

const MARK_OF = (round) => `**同书异名登记（第 ${round} 轮）**`;
/** 旧条目沿用第 76 轮的标记文本；新条目在 PLAN 里写 `round` 指定轮次 */
const MARK = MARK_OF(76);
const PLAN = [
  {
    title: '灾难之城',
    author: '埃勒里·奎因',
    alias: '凶镇',
    why:
      '上图 CNMARC 统一／并列题名字段给出 `Calamity town`；候选《凶镇》（化学工业出版社 2013，ISBN 978-7-122-17071-2）与之同作，故不另立条目。',
  },
  {
    title: '古画之谜',
    author: '何家弘',
    alias: '人生怪圈 神秘的古画',
    why:
      '中国人民大学出版社 2007 年「人生××」重版书中的《人生怪圈 神秘的古画》与原书同作（换题重版），故不另立条目。',
  },
  {
    title: '黑蝙蝠之谜',
    author: '何家弘',
    alias: '人生狭路 黑蝙蝠·白蝙蝠',
    why:
      '中国人民大学出版社 2007 年「人生××」重版书中的《人生狭路 黑蝙蝠·白蝙蝠》与原书同作（换题重版），故不另立条目。',
  },
  {
    title: '人间蒸发的女孩',
    author: '丹尼斯·勒翰',
    alias: '再见宝贝，再见',
    why:
      '上图 CNMARC 统一／并列题名字段给出 `Gone, baby, gone`；候选《再见宝贝，再见》（文化艺术出版社 2010，ISBN 978-7-5039-4197-9）与之同作，故不另立条目。',
  },

  /**
   * 第 97 轮的 10 条：都来自**候选池与库内条目的交叉比对**。
   *
   * 这一轮的教训是：`find-duplicates.mjs` 要求**作者与题名（或原题）同时对得上**，
   * 所以「同一部作品换了个中文译名、而原题一栏是空的」这类重复它**一条都拦不住**。
   * 上面这 10 组正是这样：题名互不包含、原题空缺，只有靠人把候选与库内条目逐条对读才发现。
   * 登记成别名有两个作用：读者用任一译名都能搜到；日后采集时不会被当成新书再收一遍。
   */
  {
    title: '奇想，天动',
    author: '岛田庄司',
    alias: '奇想·天劫',
    round: 97,
    why:
      '候选《奇想·天劫》（新星出版社 2010，ISBN 978-7-80225-992-8）与库内本条**同为新星版、译者同为林敏生、页数同为 300 页**，且 2013 版在 CNMARC `205` 字段明确著录为**「2 版」**——即换题重版，故不另立条目。两版 `606` 主题词一作「推理小说 小说集」、一作「侦探小说」，是编目差异，不影响定案。',
  },
  {
    title: '第46号密室',
    author: '有栖川有栖',
    alias: '第四十六号密室',
    round: 97,
    why:
      '候选《第四十六号密室》（珠海出版社 2003，ISBN 7-80689-008-4，丛编「日本优秀侦探小说丛书」）与库内本条同作（原作名 `46番目の密室`），仅数字写法不同，故不另立条目。',
  },
  {
    title: '不连续杀人事件',
    author: '坂口安吾',
    alias: '非连续杀人事件',
    round: 97,
    why:
      '候选《非连续杀人事件》（群众出版社 1999，ISBN 7-5014-1892-6，丛编「日本推理小说文库」）与库内本条同作（原作名 `不連続殺人事件`），「不连续／非连续」是同一日语词的不同译法，故不另立条目。',
  },
  {
    title: '明治开化安吾捕物帖',
    author: '坂口安吾',
    alias: '明治开化安吾捕物贴',
    round: 97,
    why:
      '候选《明治开化安吾捕物贴》上下册（重庆出版社 2015，两册共用 ISBN 978-7-6006-6107-7）与库内本条同为安吾捕物帖的上下两卷（「贴」是馆藏著录的错字），本库已有 2009 年吉林版两卷，故不另立条目。',
  },
  {
    title: '恶魔的彩球歌',
    author: '横沟正史',
    alias: '罪恶的拍球歌',
    round: 97,
    why:
      '候选《罪恶的拍球歌》（珠海出版社 2003，ISBN 7-80689-048-3，丛编「金田一探案四集」）与库内本条同作（原作名 `悪魔の手毬唄`）——「拍球歌」即「手毬唄」，故不另立条目。',
  },
  {
    title: '女王蜂',
    author: '横沟正史',
    alias: '金田一探案集 女王峰',
    round: 97,
    why:
      '候选《金田一探案集 女王峰》（珠海出版社 1999，ISBN 7-80607-545-3）与库内本条同作（原作名 `女王蜂`）——「峰」是馆藏著录的错字，故不另立条目。',
  },
  {
    title: '首席女法医2',
    author: '帕特里夏·康薇尔',
    alias: '肉体证据',
    round: 97,
    why:
      '候选《肉体证据》（南海出版公司 2003，ISBN 7-5442-2364-7，丛编「女法医探案集」）即本条原作 `Body of Evidence` 的另一译本，故不另立条目。',
  },
  {
    title: '首席女法医3',
    author: '帕特里夏·康薇尔',
    alias: '残骸线索',
    round: 97,
    why:
      '候选《残骸线索》（南海出版公司 2003，ISBN 7-5442-2367-1，丛编「女法医探案集」）即本条原作 `All That Remains` 的另一译本，故不另立条目。',
  },
  {
    title: '首席女法医：死亡的理由',
    author: '帕特里夏·康薇尔',
    alias: '死因',
    round: 97,
    why:
      '候选《死因》（北京联合出版公司 2026，ISBN 978-7-5596-9129-3，丛编「首席女法医」）即本条原作 `Cause of Death` 的另一译本，故不另立条目。',
  },
  {
    title: '护士学院杀人事件',
    author: 'P. D. 詹姆斯',
    alias: '夜莺的尸衣',
    round: 97,
    why:
      '候选《夜莺的尸衣》（新星出版社 2009，ISBN 978-7-80225-663-7）的馆藏并列题名为 `Shroud for a nightingale`，与库内本条原作名 `Shroud for a Nightingale` 完全一致，是同一部作品的另一译名，故不另立条目。',
  },
  {
    title: '王妃的遇难船',
    author: '有栖川有栖',
    alias: '沉船的王妃',
    round: 97,
    why:
      '候选《沉船的王妃》（独步文化 2013，ISBN 978-986-6043-67-3，丛编「日本推理名家杰作选 46」）与库内本条（新星出版社 2012，ISBN 978-7-5133-0797-0）**两条馆藏著录都没有原题名**，判为同作的依据是：同为有栖川有栖单行本、同为 `推理小说` 主题、年份相邻（2012／2013），且「沉船的王妃」与「王妃的遇难船」互为同一日文题名的两种译法。**这是判断而非直证**——若日后取到原题证实是两部作品，把本条别名撤掉、另立条目即可。',
  },
];

/**
 * **作者名归一**。
 *
 * 起因：库内 P. D. 詹姆斯的条目有两种写法——「P. D. 詹姆斯」4 条、「P.D.詹姆斯」1 条
 * （《教堂里的谋杀》）。同一位作者被拆成两个名字，作者页与「按作者收全」的统计都会错。
 * 这类问题 `check-data.mjs` 不查（它只看单条的结构与泄底），只能靠人发现。
 */
const RENAME_AUTHOR = [
  { title: '教堂里的谋杀', from: 'P.D.詹姆斯', to: 'P. D. 詹姆斯' },
  // 多萝西·塞耶斯在库内也是两种写法：多数作「多萝西·L·塞耶斯」（10 条），少数作「多萝西·塞耶斯」（2 条）
  { title: '贝罗那俱乐部的不快事件', from: '多萝西·塞耶斯', to: '多萝西·L·塞耶斯' },
  { title: '杀人广告', from: '多萝西·塞耶斯', to: '多萝西·L·塞耶斯' },
  /**
   * 第 86 轮：`audit-author-names.mjs` 扫出的四组真异写（另有三组是「詹姆斯」这类共同片段造成的假阳性）。
   * **归一后必须紧接着跑 `find-duplicates.mjs --strict`**——米尔恩那一组当场钓出了重复条目（见 §86.2）。
   */
  { title: '班森谋杀案', from: '范达因', to: 'S·S·范·达因' },
  { title: '红屋之谜', from: 'A·A·米尔恩', to: 'A. A. 米尔恩' },
  { title: '爱伦·坡短篇小说集', from: '爱伦·坡', to: '埃德加·爱伦·坡' },
  { title: '31号纽因客栈迷案', from: '理查德·奥斯汀·弗里曼', to: 'R·奥斯汀·弗里曼' },
];

const APPLY = process.argv.includes('--apply');
const files = readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'));
const store = new Map();
for (const f of files) store.set(f, JSON.parse(readFileSync(`data/books/${f}`, 'utf8')));

let changed = 0;
const touched = new Set();
for (const p of PLAN) {
  let hit = null;
  let file = null;
  for (const [f, arr] of store) {
    const b = arr.find((x) => x.title === p.title && x.author === p.author);
    if (b) {
      hit = b;
      file = f;
      break;
    }
  }
  if (!hit) {
    console.log(`✗ 找不到《${p.title}》/${p.author}`);
    continue;
  }
  if ((hit.alternateTitles || []).includes(p.alias)) {
    console.log(`· 《${p.title}》已有别名「${p.alias}」，跳过`);
    continue;
  }
  hit.alternateTitles = [...(hit.alternateTitles || []), p.alias];
  const mark = MARK_OF(p.round || 76);
  if (!hit.verification.source.includes(mark)) hit.verification.source += ` ${mark}：${p.why}`;
  touched.add(file);
  changed += 1;
  console.log(`✓ 《${p.title}》(${file}) → 别名 +「${p.alias}」`);
}

console.log(`\n将登记 ${changed} 条别名${APPLY ? '' : '（干跑，未落盘）'}`);

/** 作者名归一 */
let renamed = 0;
for (const r of RENAME_AUTHOR) {
  for (const [f, arr] of store) {
    const b = arr.find((x) => x.title === r.title && x.author === r.from);
    if (!b) continue;
    b.author = r.to;
    if (Array.isArray(b.authors)) b.authors = b.authors.map((n) => (n === r.from ? r.to : n));
    b.verification.source +=
      ` **作者名归一（第 80 轮）**：本条原记作者为「${r.from}」，与库内其余条目写法（「${r.to}」）不一致，已统一；` +
      '否则同一位作者会在作者页上被拆成两个人。';
    touched.add(f);
    renamed += 1;
    console.log(`✓ 《${r.title}》作者「${r.from}」→「${r.to}」`);
  }
}
console.log(`将归一 ${renamed} 条作者名`);

/** 系列名归一 */
let rs = 0;
for (const r of RENAME_SERIES) {
  for (const [f, arr] of store) {
    for (const b of arr) {
      if (b.series !== r.from) continue;
      b.series = r.to;
      b.verification.source +=
        ` **系列名归一（第 87 轮）**：本条原记系列为「${r.from}」，与库内同一系列的多数写法（「${r.to}」）不一致，已统一；` +
        '否则同一位侦探的作品会被算成两个系列。';
      touched.add(f);
      rs += 1;
    }
  }
}
console.log(`将归一 ${rs} 条系列名`);

/** 主角名归一 */
let rd = 0;
for (const r of RENAME_DETECTIVE) {
  for (const [f, arr] of store) {
    for (const b of arr) {
      if (b.detective !== r.from) continue;
      b.detective = r.to;
      b.verification.source +=
        ` **主角名归一（第 87 轮）**：本条原记主角为「${r.from}」，与库内同一人物的多数写法（「${r.to}」）不一致，已统一。`;
      touched.add(f);
      rd += 1;
    }
  }
}
console.log(`将归一 ${rd} 条主角名`);

if (APPLY && (changed || renamed || rs || rd)) {
  for (const f of touched) writeFileSync(`data/books/${f}`, JSON.stringify(store.get(f), null, 2) + '\n', 'utf8');
  console.log(`已写入 ${touched.size} 个文件`);
}
