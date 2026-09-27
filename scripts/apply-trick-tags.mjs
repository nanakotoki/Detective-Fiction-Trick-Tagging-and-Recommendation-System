#!/usr/bin/env node
/**
 * 诡计类标签补标 · 落库 `apply-trick-tags`
 * ======================================
 * 依据 `scripts/suggest-trick-tags.mjs` 提取的候选，**逐条人工复核后**把标签写进数据。
 *
 * 复核原则（第 72 轮定下，写死在下面这张表里）：
 * ① **只认「交代了机制」的原文**——「构思密室小说」「没有不可能犯罪」这类命中一律剔除；
 * ② 证据与被标作品**必须是同一部书**（题名＋作者都对得上）；
 * ③ 每条都把**命中原文**抄进 `verification.source`，日后可逐条回查；
 * ④ 宁缺勿滥：本表只收人工确认过的条目，脚本**不自动批量套用**候选表。
 *
 * 用法：
 *   node scripts/apply-trick-tags.mjs            # 干跑，打印将要发生的变化
 *   node scripts/apply-trick-tags.mjs --apply    # 落盘
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

const APPLY = process.argv.includes('--apply');
const MARK = '**诡计类标签补充（第 72 轮）**';

/** id → { tags, src, quote, why } */
const PLAN = [
  {
    id: 'clc142-030',
    title: '草原布鲁斯',
    tags: ['faceless-corpse'],
    src: '上图编目提要',
    quote: '在草原上的一个矿坑里被猎人发现的，尸体已被狼啃得面目全非',
    why: '尸体辨认不能，是无面尸类诡计的成立条件',
  },
  {
    id: 'bd152-003',
    title: '诱饵搜查官.3：听觉',
    tags: ['locked-room'],
    src: '上图编目提要',
    quote: '诱饵搜查官带我们挑战「全世界最小的密室」之谜',
    why: '出版方提要直接以「密室之谜」为卖点',
  },
  {
    id: 'clc141-021',
    title: '打雪仗',
    tags: ['nursery-rhyme'],
    src: '本库梗概＋阅读提示',
    quote: '受害者腹部皆被剖开，据目击者说案发时有人哼唱神秘的儿歌',
    why: '儿歌贯穿作案现场，属童谣型',
  },
  {
    id: 'clc141-038',
    title: '待我有罪时.2',
    tags: ['swap-murder'],
    src: '本库梗概',
    quote: '一起已结案的交换杀人案另有隐情',
    why: '原文直书「交换杀人案」',
  },
  /**
   * 第 111 轮补的三条：出自「出版方简介」这条渠道的**扩样**（样本 14 → 55 条）。
   *
   * 这一轮把简介里的句子分成两类，只收前一类：
   *   · **讲案情的**（「要求引渡某位密室杀人案的嫌疑人」）——在描述故事里发生的事，可作依据；
   *   · **讲卖点的**（「国内第一部原创密室推理小说」）——在描述书的市场定位，一律剔除。
   * 扩样后 51 条核对通过的简介里只有 8 条含诡计类关键词，其中多数还是卖点式说法——
   * 这印证了 §105 的结论：这条渠道**只能用来发现待核对象**，所以本轮只补了下面三条有案情原文的。
   */
  {
    id: 'shlib192-013',
    title: '海贼岛事件',
    tags: ['locked-room'],
    round: 111,
    src: '豆瓣条目页出版方简介',
    quote: '要求引渡某位密室杀人案的嫌疑人',
    why: '简介在讲案情时点明这是一桩「密室杀人案」，属谜面层面而非卖点措辞',
  },
  {
    id: 'md198-001',
    title: '黑色笔记',
    tags: ['cipher'],
    round: 111,
    src: '豆瓣条目页出版方简介',
    quote: '烧焦饭店里的无名尸、脑袋塞进烤箱的受害者、遇袭警官身上的黑色笔记中的密码……似乎隐藏着许多不为人知的秘密',
    why: '简介点明「黑色笔记中的密码」是案件拼图的一环，属谜面层面的暗号密码',
  },
  {
    id: 'wk118-004',
    title: '玻璃天',
    tags: ['cipher'],
    round: 111,
    src: '豆瓣条目页出版方简介',
    quote: '以三部短篇小说构成：描绘人性恶意的《梦幻桥》、破解失踪者遗留密码的《想夫恋》以及标题作《玻璃天》',
    why: '简介写明其中一篇以「破解失踪者遗留密码」为主线；标签属全书层面，故在证据里点明只对应其中一篇',
  },
  {
    id: 'shlib166-005',
    title: '开往巴黎的杀人列车',
    tags: ['timetable'],
    src: '本库阅读提示',
    quote: '列车时刻与各站停靠',
    why: '车次与停靠站构成线索骨架，属时刻表型（西村京太郎「旅情」系的一贯做法）',
  },
  {
    id: 'spider108-004',
    title: '老虎残梦',
    tags: ['locked-room', 'multiple-solutions'],
    src: '上图编目提要',
    quote: '设定（如江湖门派、心法招式、门派比武）和日本推理孤岛密室、多重诡计等要素',
    why: '出版方提要把「孤岛密室」「多重诡计」列为本作要素',
  },
  {
    id: 'rampo-007',
    title: '女妖',
    tags: ['alibi', 'locked-room'],
    src: '上图编目提要',
    quote: '后是村越在密闭的房间中被枪杀……所有人都有完美的不在场证明',
    why: '密闭房间＋全员不在场证明，两个机制都由提要写明',
  },
  {
    id: 'facet138-013',
    title: '入骨相思：女法医勘查手记',
    tags: ['alibi'],
    src: '本库梗概',
    quote: '游戏厅机箱里惊现腐尸而嫌疑人都有不在场证明',
    why: '不在场证明是本案的核心障碍',
  },
  {
    id: 'jpaudit78-004',
    title: '深夜市长',
    tags: ['cipher'],
    src: '上图编目提要',
    quote: '本书内容包括：活着的肠子、暗号唱片事件、失踪的金块、骷髅馆、楼梯、恐怖的守灵、深夜',
    why: '收录篇目中直接有「暗号唱片事件」',
  },
  {
    id: 'clc144-006',
    title: '神苦乐岛',
    tags: ['closed-circle'],
    src: '本库阅读提示',
    quote: '岛上与外界隔绝的环境',
    why: '孤岛断绝交通，是典型的封闭空间格局',
  },
  {
    id: 'facet125-006',
    title: '死亡邮递',
    tags: ['timetable'],
    src: '上图编目提要',
    quote: '一切的答案似乎都早已写在列车时刻表中',
    why: '提要明说答案在列车时刻表里——时刻表型的确证',
  },
  {
    id: 'gap119-001',
    title: '限时医院',
    tags: ['closed-circle'],
    src: '上图编目提要',
    quote: '这些人开始尝试解开医院内的谜团，逃出这个密室',
    why: '整座医院被封为「密室」，属封闭空间（非单间密室，故记 closed-circle 而非 locked-room）',
  },
];

/** 已剔除的候选，留档说明为什么不标 */
const REJECTED = [
  ['middepth56-015', '小生物语', 'dual-role', '命中处是「冒充大学生去大学社团报名」，是随笔里的玩笑，不是作品机制'],
  ['middepth56-015', '小生物语', 'locked-room', '命中处是「在水床上构思密室小说」，说的是写作，不是说本书有密室'],
  ['global-013', '雾之旗', 'locked-room', '命中处是「没有名侦探与不可能犯罪」——**否定句**，已给提取脚本加否定词护栏'],
  ['伽利略系列·嫌疑人X的献身', '嫌疑人X的献身', 'multiple-solutions', '同系列 7/8 部有该标签，但**这一部恰恰是例外**——它的力道在别处，不靠多重解答，故不按系列比例硬套'],
];

/**
 * **第二类依据：作者／系列层面的既有标注。**
 *
 * 逐条外部取证走不通时（豆瓣 403、日文维基在本机网络下不可达、馆藏提要多不写机制），
 * 还有一类**可审计**的依据：**库内同一位作者、或同一套系列的既有标注高度一致**。
 * 例如梅森探案系列的 26/27 部都标了 `multiple-solutions`——那正是该系列的结构
 * （每部都在法庭上翻出另一套解答）；《少年侦探团》系列 6/7 部标了 `dual-role`——
 * 怪盗二十面相每部都在易容。
 *
 * 取用规则（写死在这里，避免日后被当成「随便套比例」）：
 *   ① 组内样本 ≥5 部，且该标签覆盖率 ≥85%；
 *   ② 只取**有实义**的标签（`red-herring` 这类几乎人人皆有的不取，免得稀释权重）；
 *   ③ 覆盖率**不是 100%** 时，逐条再看一眼——**例外的那一部往往正是不能标的**
 *      （《嫌疑人X的献身》就是这么被剔除的，见 REJECTED）。
 */
const MARK2 = '**诡计类标签补充·作者/系列层面（第 76 轮）**';
const PLAN2 = [
  { id: null, title: '苍海馆事件', author: '阿津川辰海', tags: ['multiple-solutions'], basis: '作者既有 6/7 部标有 `multiple-solutions`' },
  { id: null, title: '名侦探原田亘', author: '白井智之', tags: ['multiple-solutions'], basis: '作者既有 8/9 部标有 `multiple-solutions`' },
  { id: null, title: '彩虹村的秘密', author: '有栖川有栖', tags: ['multiple-solutions'], basis: '作者既有 19/22 部标有 `multiple-solutions`' },
  { id: null, title: '生首是闻', author: '法月纶太郎', tags: ['multiple-solutions'], basis: '作者既有 6/7 部标有 `multiple-solutions`' },
  { id: null, title: '马来铁道之谜', author: '有栖川有栖', tags: ['multiple-solutions'], basis: '作者既有 19/22 部标有 `multiple-solutions`' },
  { id: null, title: '幻坂', author: '有栖川有栖', tags: ['multiple-solutions'], basis: '作者既有 19/22 部标有 `multiple-solutions`' },
  { id: null, title: '梅森探案集', author: '厄尔·斯坦利·加德纳', tags: ['multiple-solutions'], basis: '「梅森探案系列」26/26 部标有 `multiple-solutions`——法庭上翻出另一套解答正是该系列的固定结构' },
  { id: null, title: '四魔头', author: '阿加莎·克里斯蒂', tags: ['multiple-solutions'], basis: '「波洛系列」20/21 部标有 `multiple-solutions`' },
  { id: null, title: '妖怪博士', author: '江户川乱步', tags: ['cipher'], basis: '「少年侦探团系列」6/7 部标有 `cipher`' },
  { id: null, title: '少年侦探团', author: '江户川乱步', tags: ['dual-role'], basis: '「少年侦探团系列」6/7 部标有 `dual-role`——二十面相每部都在易容' },
  { id: null, title: '铁鼠之槛', author: '京极夏彦', tags: ['psychological-misdirection'], basis: '「京极堂系列」6/7 部标有 `psychological-misdirection`' },
];

const files = readdirSync('data/books').filter((x) => x.endsWith('.json') && !x.startsWith('_'));

/**
 * **一次性读入全部批次，最后统一写回。**
 *
 * 第一版是「每条计划各自去读文件、命中就记进 dirty」，结果同一批次被两条计划命中时，
 * 后一条会用**从磁盘重读的旧数组**覆盖前一条的修改——`clc141-021`（打雪仗）与
 * `clc141-038`（待我有罪时.2）同在 `batch-141-clc.json`，跑完只有前一条生效，
 * 而脚本还照旧打印了两行 ✓。改成一次性读入后，这类覆盖不可能再发生。
 */
const store = new Map(); // 文件名 → 数组
const where = new Map(); // id → 文件名
const byTitle = new Map(); // 题名 → [文件名, 条目]
for (const f of files) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  store.set(f, arr);
  for (const b of arr) {
    where.set(b.id, f);
    if (!byTitle.has(b.title)) byTitle.set(b.title, []);
    byTitle.get(b.title).push([f, b]);
  }
}

let changed = 0;
const touched = new Set();

/** 第一类依据：逐条外部取证（PLAN） */
for (const p of PLAN) {
  const file = where.get(p.id);
  if (!file) {
    console.log(`✗ 找不到 ${p.id}（${p.title}）`);
    continue;
  }
  const hit = store.get(file).find((b) => b.id === p.id);
  /** 条目可以自带 `round`（第 111 轮补的三条就是），标记里写对轮次，免得日后复核时张冠李戴 */
  const mark = p.round ? `**诡计类标签补充（第 ${p.round} 轮）**` : MARK;
  if (hit.verification?.source?.includes(mark)) {
    console.log(`· ${p.id} ${p.title} 已补过，跳过`);
    continue;
  }
  const add = p.tags.filter((t) => !(hit.tags || []).includes(t));
  if (!add.length) {
    console.log(`· ${p.id} ${p.title} 标签已齐，跳过`);
    continue;
  }
  hit.tags = [...(hit.tags || []), ...add];
  hit.verification.source += ` ${mark}：据${p.src}「${p.quote}」补标 ${add.join('、')}（${p.why}）。`;
  changed += 1;
  touched.add(file);
  console.log(`✓ ${p.id} ${p.title} → +${add.join('、')}`);
}

/** 第二类依据：作者／系列层面的既有标注（PLAN2） */
for (const p of PLAN2) {
  const cands = (byTitle.get(p.title) || []).filter(([, b]) => b.author === p.author);
  if (!cands.length) {
    console.log(`✗ 找不到《${p.title}》/${p.author}`);
    continue;
  }
  const [file, hit] = cands[0];
  if (hit.verification?.source?.includes(MARK2)) {
    console.log(`· 《${p.title}》已按作者/系列层面补过，跳过`);
    continue;
  }
  const add = p.tags.filter((t) => !(hit.tags || []).includes(t));
  if (!add.length) {
    console.log(`· 《${p.title}》标签已齐，跳过`);
    continue;
  }
  hit.tags = [...(hit.tags || []), ...add];
  hit.verification.source += ` ${MARK2}：${p.basis}，故对未标的《${p.title}》补标 ${add.join('、')}。`;
  changed += 1;
  touched.add(file);
  console.log(`✓ 《${p.title}》/${p.author} → +${add.join('、')}`);
}

console.log(`\n将补标 ${changed} 部${APPLY ? '' : '（干跑，未落盘；加 --apply 生效）'}`);
console.log(`已剔除的候选 ${REJECTED.length} 条：`);
for (const [id, title, tag, why] of REJECTED) console.log(`  ✗ ${id} ${title} ${tag} —— ${why}`);

if (APPLY && changed) {
  for (const f of touched) writeFileSync(`data/books/${f}`, JSON.stringify(store.get(f), null, 2) + '\n', 'utf8');
  console.log(`\n已写入 ${touched.size} 个数据文件`);
}
