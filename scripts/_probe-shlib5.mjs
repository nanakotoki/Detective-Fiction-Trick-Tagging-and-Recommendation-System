/**
 * 探针 8：`fullrecord` 的真实字符编码（分隔符到底是哪些控制字符）
 * ==========================================================
 * 打印片段里看不到字段分隔符与子字段分隔符，但内容齐全（「推理小说」「I313.45」
 * 「湖南文艺出版社」「2012」都在）。CNMARC 的分隔符应是 0x1E（字段）与 0x1F（子字段）。
 * 也可能是别的可打印字符（有些系统用 `‡`、`$`、`|`）。
 */
const BASE = 'https://vufind.library.sh.cn';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const res = await fetch(
  `${BASE}/api/v1/search?lookfor=${encodeURIComponent('折原一')}&type=Author&limit=3&field[]=rawData&field[]=title`,
  { headers: { 'user-agent': UA, accept: 'application/json' } },
);
const j = JSON.parse(await res.text());
const r = j.records.find((x) => x.title === '冤罪者') || j.records[0];
const marc = r.rawData.fullrecord;

console.log('题名：', r.title, '长度', marc.length);
console.log('\n=== 出现的非常见字符（码位 < 32 或 > 126）===');
const counts = new Map();
for (const ch of marc) {
  const c = ch.codePointAt(0);
  if (c < 32 || c > 126) counts.set(c, (counts.get(c) || 0) + 1);
}
for (const [c, n] of [...counts.entries()].sort((a, b) => a[0] - b[0])) {
  console.log(`  码位 ${String(c).padStart(5)} (0x${c.toString(16).padStart(2, '0')}) × ${n}  ${c >= 32 ? JSON.stringify(String.fromCodePoint(c)) : ''}`);
}

console.log('\n=== 按 0x1E 切分（CNMARC 字段分隔符）===');
const parts = marc.split('\u001e');
console.log(`  切成 ${parts.length} 段`);
for (const p of parts.slice(0, 12)) {
  console.log(`  [${JSON.stringify(p.slice(0, 70))}]`);
}

console.log('\n=== 若没有 0x1E，就按「三位数字标签 + 内容」找 690/606 ===');
for (const tag of ['606', '690', '210']) {
  const idx = marc.indexOf(tag);
  console.log(`  ${tag} 首次出现于 ${idx}：${JSON.stringify(marc.slice(Math.max(0, idx - 10), idx + 60))}`);
}

console.log('\n=== 原始前 400 字符（逐字符转义）===');
console.log(JSON.stringify(marc.slice(0, 400)));
