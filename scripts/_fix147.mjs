// 一次性：撤掉重复的《无尽长夜》，并在库内《长夜》上登记异名；同时改写泄底的简介
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

// 1) 从 batch-147 删掉 ns147-009《无尽长夜》，并修掉 ns147-021 的泄底句
const p = 'data/books/batch-147-clc.json';
const arr = JSON.parse(readFileSync(p, 'utf8'));
const kept = arr.filter((b) => b.id !== 'ns147-009');
console.log('− 删除 ns147-009《无尽长夜》（库内已有 christie-005《长夜》，同原书名 Endless Night）');
const victim = kept.find((b) => b.id === 'ns147-021');
if (victim) {
  const before = victim.safeSummary;
  victim.safeSummary = victim.safeSummary.replace(
    '她并不相信初审判决的凶手就是杀害妹妹的人。',
    '她始终认为当年那场初审的结论站不住脚。',
  );
  console.log(`✓ 改写《妹妹的坟墓》泄底句：\n    旧：${before.slice(-24)}\n    新：${victim.safeSummary.slice(-24)}`);
}
writeFileSync(p, JSON.stringify(kept, null, 2) + '\n', 'utf8');

// 2) 在《长夜》上登记异名
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const q = `data/books/${f}`;
  const list = JSON.parse(readFileSync(q, 'utf8'));
  let dirty = false;
  for (const b of list) {
    if (b.title !== '长夜' || b.originalTitle !== 'Endless Night') continue;
    b.alternateTitles = b.alternateTitles || [];
    if (!b.alternateTitles.includes('无尽长夜')) {
      b.alternateTitles.push('无尽长夜');
      dirty = true;
      console.log(`+ 《${b.title}》(${b.id}) ← 又名「无尽长夜」`);
    }
  }
  if (dirty) writeFileSync(q, JSON.stringify(list, null, 2) + '\n', 'utf8');
}
console.log('\nbatch-147 现', kept.length, '条');
