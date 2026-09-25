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
for (const f of files) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  store.set(f, arr);
  for (const b of arr) where.set(b.id, f);
}

let changed = 0;
const touched = new Set();

for (const p of PLAN) {
  const file = where.get(p.id);
  if (!file) {
    console.log(`✗ 找不到 ${p.id}（${p.title}）`);
    continue;
  }
  const hit = store.get(file).find((b) => b.id === p.id);
  if (hit.verification?.source?.includes(MARK)) {
    console.log(`· ${p.id} ${p.title} 已补过，跳过`);
    continue;
  }
  const add = p.tags.filter((t) => !(hit.tags || []).includes(t));
  if (!add.length) {
    console.log(`· ${p.id} ${p.title} 标签已齐，跳过`);
    continue;
  }
  hit.tags = [...(hit.tags || []), ...add];
  hit.verification.source += ` ${MARK}：据${p.src}「${p.quote}」补标 ${add.join('、')}（${p.why}）。`;
  changed += 1;
  touched.add(file);
  console.log(`✓ ${p.id} ${p.title} → +${add.join('、')}`);
}

console.log(`\n将补标 ${changed} 部${APPLY ? '' : '（干跑，未落盘；加 --apply 生效）'}`);
console.log(`已剔除的候选 ${REJECTED.length} 条：`);
for (const [id, title, tag, why] of REJECTED) console.log(`  ✗ ${id} ${title} ${tag} —— ${why}`);

if (APPLY && changed) {
  for (const f of touched) writeFileSync(`data/books/${f}`, JSON.stringify(store.get(f), null, 2) + '\n', 'utf8');
  console.log(`\n已写入 ${touched.size} 个数据文件`);
}
