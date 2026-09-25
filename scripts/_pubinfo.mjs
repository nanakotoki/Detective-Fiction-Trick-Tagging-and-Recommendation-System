#!/usr/bin/env node
/**
 * 豆瓣条目出版信息速查（整理者核对版本年与「同书异译」用）
 * ======================================================
 * 输出六列：条目号 / 书名 / **原作名** / 出版社 / 出版年 / 页数 / ISBN。
 *
 * **为什么必须带「原作名」这一列**：判断两本书是不是同一部作品，唯一可靠的依据是
 * 原作名，不是中译名。实际踩到的例子：
 *   · 库内《莱文沃思案》与丛书页上的《利文沃兹案》都是 The Leavenworth Case；
 *   · 丛书页上的《星降山庄杀人事件》与库内《星降山庄谜案》都是 星降り山荘の殺人；
 *   · 库内《废游乐园的杀人》与丛书页上的《废乐园事件》都是 廃遊園地の殺人。
 * 三例的中译名都不同，`check-new` 按书名查全部报「库中没有同名条目」。
 * 把原作名并排打出来，一眼就能看出该并成一条还是各收一条。
 *
 * 用法：node scripts/_pubinfo.mjs <subjectId> [subjectId...]
 * 输出仅供整理者核对，**不进入知识库**。
 */
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

const ids = process.argv.slice(2);
if (!ids.length) {
  console.error('用法: node scripts/_pubinfo.mjs <subjectId> [subjectId...]');
  process.exit(1);
}

const strip = (s) =>
  String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

for (const id of ids) {
  const url = `https://book.douban.com/subject/${id}/`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
      console.log(`${id}\tHTTP ${res.status}`);
      continue;
    }
    const html = await res.text();
    const info = html.match(/<div id="info"[^>]*>([\s\S]*?)<\/div>/);
    if (!info) {
      console.log(`${id}\t（未取到 info 区，可能被限流或页面结构变化）`);
      continue;
    }
    const text = info[1].replace(/<br\s*\/?>/g, '\u0001');
    const fields = {};
    for (const raw of text.split('\u0001')) {
      const t = strip(raw);
      if (!t) continue;
      const m = t.match(/^([^:：]{2,10})[:：]\s*(.*)$/);
      if (m) fields[m[1]] = m[2];
    }
    const title = strip((html.match(/<span property="v:itemreviewed">([\s\S]*?)<\/span>/) || [, ''])[1]);
    console.log(
      [
        id,
        title,
        fields['原作名'] || '—',
        fields['出版社'] || '?',
        fields['出版年'] || '?',
        `${fields['页数'] || '?'}页`,
        fields['ISBN'] || '?',
      ].join('\t')
    );
  } catch (e) {
    console.log(`${id}\t抓取失败：${e.message}`);
  }
}
