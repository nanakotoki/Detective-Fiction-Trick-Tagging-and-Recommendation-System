// 一次性：给「多人合集」条目打 anthology 标记（纯展示用，不改变统计口径）
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
const ANTHOLOGY = new Set([
  // batch-133
  'multiauth133-007', 'multiauth133-008', 'multiauth133-009',
  // batch-134
  'coll134-001', 'coll134-002', 'coll134-003', 'coll134-004', 'coll134-005',
  'coll134-006', 'coll134-008', 'coll134-009', 'coll134-010', 'coll134-011',
  // batch-135
  'coll135-006', 'coll135-007', 'coll135-008', 'coll135-009', 'coll135-010',
  'coll135-011', 'coll135-012', 'coll135-016',
]);
let n = 0;
for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    if (!ANTHOLOGY.has(b.id)) continue;
    if (b.anthology === true) continue;
    // 插到 authors 之后，保持字段顺序稳定
    const next = {};
    for (const [k, v] of Object.entries(b)) {
      next[k] = v;
      if (k === 'authors') next.anthology = true;
    }
    if (!('anthology' in next)) next.anthology = true;
    Object.assign(b, next);
    dirty = true;
    n++;
    console.log(`+ ${b.id} 《${b.title}》标记为合集`);
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
console.log(`共标记 ${n} 部`);
