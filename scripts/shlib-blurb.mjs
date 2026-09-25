/**
 * 给上图找到的候选补**提要**（第一馆详情页）
 * ======================================
 * 上图 CNMARC 的 330（提要）经常是空的，而本库的 `safeSummary` 必须自己写、
 * 且要写得住。第一馆的详情页有 提要文摘（编目员摘要）——题名检索虽不可用于**发现**，
 * 但用于**验证已知书名**是可靠的（§58.2 的结论）。
 *
 * 本工具只做一件事：把一批已知书名送去第一馆，取回提要／丛编／中图法／出版项，
 * 写成 TSV 供人工改写无剧透梗概。**不写数据**。
 *
 * 用法：node scripts/shlib-blurb.mjs "盲兽" "法国粉末之谜" --out _dd/blurbs.tsv
 */
import { writeFileSync, appendFileSync, existsSync, readFileSync } from 'node:fs';
import { search, detail, subjectVerdict } from './lib/uibe.mjs';

const argv = process.argv.slice(2);
const outIdx = argv.indexOf('--out');
const OUT = outIdx >= 0 ? argv[outIdx + 1] : '_dd/blurbs.tsv';
const titles = argv.filter((a, i) => !a.startsWith('--') && i !== outIdx + 1);

const done = new Set();
if (existsSync(OUT)) {
  for (const l of readFileSync(OUT, 'utf8').split(/\r?\n/)) if (l.trim()) done.add(l.split('\t')[0]);
}

const norm = (s) => String(s || '').replace(/[\s:：·・,，.。()（）[\]【】\-—_/、；;]/g, '');
for (const title of titles) {
  if (done.has(title)) continue;
  let rec = [title, '', '', '', '', '', '未找到'];
  try {
    const res = await search(title, { site: 'uibe' });
    const exact = res.rows.filter((r) => {
      const a = norm(r.title);
      const b = norm(title);
      return a === b || (b.length >= 4 && a.includes(b)) || (a.length >= 4 && b.includes(a));
    });
    const pick = exact[0] || null;
    if (!pick) {
      rec = [title, '', '', '', '', '', `题名未命中（返回 ${res.rows.length} 行，示例：${res.rows[0]?.title ?? '无'}）`];
    } else {
      await new Promise((r) => setTimeout(r, 800));
      const d = await detail(pick.bookId, { site: 'uibe' });
      const v = subjectVerdict(d.subjects);
      rec = [
        title,
        pick.title,
        pick.author,
        d.imprint || '',
        d.clc || '',
        (d.subjects || '').replace(/&nbsp;/g, ' ').trim(),
        (d.abstract || d.summary || '').replace(/\s+/g, ' ').trim(),
        d.series || '',
        v.mystery ? '推理判据Y' : '推理判据N',
      ];
    }
  } catch (e) {
    rec = [title, '', '', '', '', '', `检索失败：${e.message}`];
  }
  appendFileSync(OUT, rec.join('\t') + '\n', 'utf8');
  console.log(`◆ ${title} → ${rec[6].slice(0, 120)}`);
  await new Promise((r) => setTimeout(r, 800));
}
console.log(`\n写入 ${OUT}`);
