import { readFileSync } from 'node:fs';

const rows = readFileSync('_dd/clc-nosubj-detail.tsv', 'utf8').split(/\r?\n/).filter(Boolean).map((l) => l.split('\t'));
// clc, bookId, title, author, imprint, 中图, subjects, series, titleNote, abstract, mysteryY/N
const DANGER = /盗墓|鬼吹灯|摸金|倒斗|墓室|古墓|陵墓|阴兵|僵尸|尸变|诈尸|还魂|灵异|鬼话|凶宅|冥婚|阴婚|蛊|巫术|赶尸|怪谈|惊悚|恐怖|惊魂|幽灵|亡魂|厉鬼|怨灵/;
const INCLUDE = /侦探|推理|探案|命案|凶杀|谋杀|密室|凶手|作案|警方|刑警|法医|侦查|破案|嫌疑人|罪案|悬案|不在场|绑架|失踪/;

const buckets = { 明显排除: [], 明显可用: [], 待判: [] };
for (const r of rows) {
  const [clc, bookId, title, author, imprint, clcCode, subjects, series, titleNote, abstract, isMystery] = r;
  const text = `${title} ${series} ${abstract}`;
  const rec = { clc, title, author, imprint, series, abstract: (abstract || '').slice(0, 80) };
  if (DANGER.test(text)) buckets.明显排除.push(rec);
  else if (INCLUDE.test(text)) buckets.明显可用.push(rec);
  else buckets.待判.push(rec);
}
console.log(`共 ${rows.length} 条：明显排除 ${buckets.明显排除.length} / 明显可用 ${buckets.明显可用.length} / 待判 ${buckets.待判.length}\n`);
for (const [k, v] of Object.entries(buckets)) {
  console.log(`\n===== ${k}（${v.length}）=====`);
  for (const r of v) console.log(`[${r.clc}] ${r.title} | ${r.author} | ${r.imprint} | 丛编:${r.series || '-'} | ${r.abstract}`);
}
