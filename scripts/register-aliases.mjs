import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

/**
 * 把「同书异名核查」查出来的别名登记进库内条目，并在证据串里留下记录。
 *
 * 本批（batch-176）：候选《凶镇》（化学工业出版社 2013）经上图 CNMARC 的
 * **统一／并列题名**字段定为 `Calamity town`，即**库内已有的《灾难之城》**，
 * 因此不再另收一条，而是把「凶镇」登记为别名——否则下一轮扫描还会把它当新书报上来。
 */
const MARK = '**同书异名登记（第 76 轮）**';
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
];

/**
 * **作者名归一**。
 *
 * 起因：库内 P. D. 詹姆斯的条目有两种写法——「P. D. 詹姆斯」4 条、「P.D.詹姆斯」1 条
 * （《教堂里的谋杀》）。同一位作者被拆成两个名字，作者页与「按作者收全」的统计都会错。
 * 这类问题 `check-data.mjs` 不查（它只看单条的结构与泄底），只能靠人发现。
 */
const RENAME_AUTHOR = [{ title: '教堂里的谋杀', from: 'P.D.詹姆斯', to: 'P. D. 詹姆斯' }];

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
  if (!hit.verification.source.includes(MARK)) hit.verification.source += ` ${MARK}：${p.why}`;
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

if (APPLY && (changed || renamed)) {
  for (const f of touched) writeFileSync(`data/books/${f}`, JSON.stringify(store.get(f), null, 2) + '\n', 'utf8');
  console.log(`已写入 ${touched.size} 个文件`);
}
