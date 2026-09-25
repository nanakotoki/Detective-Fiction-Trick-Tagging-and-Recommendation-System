// 严格复检：把「无主题词」桶已入库的条目逐条按证据强度分级
// 依据是**馆藏提要本身**：提要是否给出了体裁或案件内核。
import { readFileSync } from 'node:fs';

const detail = readFileSync('_dd/clc-nosubj-detail.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
const norm = (s) => String(s || '').replace(/[\s:：·・,，.。()（）[\]【】\-—_=]/g, '');
const byTitle = new Map();
for (const r of detail) byTitle.set(norm(r[2]), r);

// 提要里能证明「这是推理/侦查故事」的词
const GENRE = /推理|侦探|探案|破案|刑侦|命案|谋杀|凶手|法医|嫌疑人|悬案|罪案|侦查|侦察|调查|案件|缉凶|连环杀/;
const SCENE_ONLY = /^本书讲述了：?[^。]{0,40}$/;

const FILES = ['batch-146-clc.json', 'batch-147-clc.json', 'batch-148-clc.json', 'batch-149-clc.json'];
const buckets = { 提要明确: [], 提要含案件词: [], 提要仅场景或为空: [], 未匹配: [] };
for (const f of FILES) {
  const arr = JSON.parse(readFileSync(`data/books/${f}`, 'utf8'));
  for (const b of arr) {
    const n = norm(b.title);
    let r = byTitle.get(n);
    if (!r) {
      for (const [k, v] of byTitle) {
        if (k.startsWith(n.slice(0, 5)) || n.startsWith(k.slice(0, 5))) {
          r = v;
          break;
        }
      }
    }
    if (!r) {
      buckets.未匹配.push({ f, id: b.id, title: b.title });
      continue;
    }
    const abs = (r[9] || '').trim();
    const rec = { f, id: b.id, title: b.title, author: b.author, series: r[7] || '', abs };
    if (/推理|侦探|探案|破案|刑侦/.test(abs)) buckets.提要明确.push(rec);
    else if (GENRE.test(abs)) buckets.提要含案件词.push(rec);
    else buckets.提要仅场景或为空.push(rec);
  }
}
for (const [k, v] of Object.entries(buckets)) {
  console.log(`\n===== ${k}：${v.length} 条 =====`);
  for (const r of v) console.log(`[${r.f.replace('batch-', '').replace('-clc.json', '')}] ${r.id} 《${r.title}》 | ${r.author} | 丛编:${r.series || '-'}\n      提要：${(r.abs || ').slice(0, 110) || '（空）'}`);
}
