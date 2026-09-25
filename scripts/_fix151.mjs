// 一次性：修 batch-151 的三项体检错误
import { readFileSync, writeFileSync } from 'node:fs';
const p = 'data/books/batch-151-clc.json';
const arr = JSON.parse(readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));

const fixes = [
  ['bd151-006', (b) => {
    b.safeSummary = '抗日战争全面爆发前的大半年里，北平的皇粮胡同围绕着神秘的紫姨和她的牌友俱乐部又出了几件事：名门女子大学的毕业生聚会时听到一位死去三年的同窗在冷月下朗诵诗歌；胡同里经营古玩拍卖的富商，两位太太竟死于儿女们的谋杀。';
  }],
  ['bd151-019', (b) => {
    b.safeSummary = b.safeSummary.replace('从而识破谎言、查明真相', '进而判断供述的真伪');
  }],
  ['bd151-023', (b) => {
    b.safeSummary = '以二〇〇一年恐怖袭击事件后的东京为舞台：一位现代派画家用榔头砸死怀孕的同居女友和邻居的男大学生，理由竟是为了消除嘈杂的声音——这究竟是艺术家的疯狂，还是现代的人性缺失？刑警和僧人各自求索答案。';
  }],
];
for (const [id, fn] of fixes) {
  const b = arr.find((x) => x.id === id);
  if (!b) { console.log(`✗ 找不到 ${id}`); continue; }
  fn(b);
  console.log(`✓ ${id}《${b.title}》→ ${[...b.safeSummary].length} 字`);
}
writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
