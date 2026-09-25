// 一次性：修正《一先令蜡烛》被写错的原题名，并解除它跟《歌唱的沙》的错误绑定
// 依据：现代推理馆「约瑟芬·铁伊」那套书的部次为
//   博莱特·法拉1 / 法兰柴思事件2 / 歌唱的沙3 / 排队的人4 / 萍小姐的主意5 /
//   时间的女儿6 / 一先令蜡烛7 / 一张俊美的脸8
// 即《歌唱的沙》与《一先令蜡烛》是**两个不同的卷次、两部不同的作品**：
//   一先令蜡烛 = A Shilling for Candles (1936)
//   歌唱的沙   = The Singing Sands      (1952)
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';

for (const f of readdirSync('data/books').filter((x) => x.endsWith('.json'))) {
  const p = `data/books/${f}`;
  const arr = JSON.parse(readFileSync(p, 'utf8'));
  let dirty = false;
  for (const b of arr) {
    if (b.title !== '一先令蜡烛') continue;
    const before = `${b.originalTitle} / ${b.firstPublished} / alt=${(b.alternateTitles || []).join('、')}`;
    b.originalTitle = 'A Shilling for Candles';
    b.firstPublished = '1936';
    b.alternateTitles = (b.alternateTitles || []).filter((t) => t !== '歌唱的沙');
    if (!Array.isArray(b.alternateTitles) || b.alternateTitles.length === 0) delete b.alternateTitles;
    b.verification = b.verification || {};
    b.verification.source = `${b.verification.source ? b.verification.source + ' ' : ''}【2026-09 修正】本条原先的原题名写作 *The Singing Sands*（1952）并把《歌唱的沙》登记为异名——**那是把铁伊的两部不同作品并成了一部**。据对外经贸大学图书馆 OPAC 著录的「现代推理馆·约瑟芬·铁伊」书系部次（博莱特·法拉1／法兰柴思事件2／**歌唱的沙3**／排队的人4／萍小姐的主意5／时间的女儿6／**一先令蜡烛7**／一张俊美的脸8），两书**各自是独立卷次**：一先令蜡烛 = *A Shilling for Candles*（1936），歌唱的沙 = *The Singing Sands*（1952）。已改正原题名与首版年，并**撤销错误的异名绑定**；《歌唱的沙》另立条目。`;
    dirty = true;
    console.log(`✓ 修正《一先令蜡烛》：${before}\n     → A Shilling for Candles / 1936 / alt=（已清空）`);
  }
  if (dirty) writeFileSync(p, JSON.stringify(arr, null, 2) + '\n', 'utf8');
}
