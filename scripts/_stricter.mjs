// 严格化收口：把「无主题词」桶里**判不了体裁**的条目撤出库
//
// 判定标准（用户 2026-09 指示「严格一点，不能判断的就不加了」）：
// 一条候选要留下，必须能从**馆藏记录本身**看出它是推理/侦查故事，即满足任一条——
//   ① 提要里出现体裁词（推理/侦探/探案/悬疑小说…）；或
//   ② 丛编项是推理专门书系（推理文库、侦探小说系列、推理奖项书系…）；或
//   ③ 提要给出了案件或侦查内核（命案/凶手/绑架/刑警调查…）。
// **只有分类号 + 氛围描写**的，一律撤出。
import { readFileSync, writeFileSync } from 'node:fs';

const DROP = {
  'ns148-009': '《金三角之谜》：提要只有一段人物出场描写（警报、手枪），无体裁词、无案件、丛编「张宝瑞作品」也不是推理书系 —— 仅凭分类号无法判断',
  'ns148-010': '《泣血梅花》：提要只有什刹海夜景的抒情描写，无体裁词、无案件 —— 仅凭分类号无法判断',
  'ns149-012': '《相声神探》：提要只有少年在街上的外貌描写，无体裁词、无案件 —— 仅标题含「神探」不足以判断',
  'ns148-017': '《朱雀堂》：馆藏**未著录责任者**，提要只截到一句对白，除分类号外没有可核的依据 —— 作者与体裁都无法确认',
};

for (const f of ['batch-148-clc.json', 'batch-149-clc.json']) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  const kept = arr.filter((b) => !DROP[b.id]);
  for (const b of arr) {
    if (DROP[b.id]) console.log(`− 撤出 ${b.id} 《${b.title}》\n    理由：${DROP[b.id]}`);
  }
  writeFileSync(p, JSON.stringify(kept, null, 2) + '\n', 'utf8');
  console.log(`   ${f}：${arr.length} → ${kept.length} 条`);
}
