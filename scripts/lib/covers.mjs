/**
 * 封面处理的纯函数（第 166 轮）
 * ============================
 * 这些函数原先长在 `scripts/fetch-covers.mjs` 里，但它们**没有副作用**（不联网、不写盘），
 * 抽出来单独放，好处是能进 `test-core.mjs` 的单元测试——抓取脚本本身没法 import
 * （顶层就会跑起来并联网），抽出来之后**规则就能被断言**：
 * 书号折算、题名褪层、豆瓣默认占位图识别、图片宽高解析，这几处错了都会静默出错结果。
 */

/** 题名归一：去空白与标点，便于比较 */
export function normTitle(s) {
  return String(s || '')
    .replace(/[\s\u3000《》〈〉·・:：,，.。、\-—－_/\\|()（）[\]【】«»「」『』!！?？"'“”‘’]/g, '')
    .toLowerCase();
}

/**
 * 把题名拆成「可以拿去检索的几种写法」。
 *
 * 豆瓣的 `j/subject_suggest` 不是全文检索，是**题名建议**：带卷次／副题／丛编前缀的
 * 完整著录常常一条都不回（实测《水族馆之谜》有回执，而《天使之刃》这种也照回空）。
 * 所以命中不了时褪一层再试：去掉副题、去掉卷次、去掉丛编前缀。
 */
export function titleQueries(title) {
  const raw = String(title || '').trim();
  const out = [raw];
  const push = (s) => {
    const t = String(s || '').trim();
    if (t.length >= 2 && !out.includes(t)) out.push(t);
  };
  push(raw.split(/[:：]/)[0]);
  push(raw.replace(/\s*[（(]?\s*(第?\s*[0-9０-９一二三四五六七八九十上中下IVX]+)\s*[)）]?\s*$/i, ''));
  push(raw.replace(/[·・]\s*[^·・]*$/, ''));
  push(raw.replace(/\s*[:：].*$/, '').replace(/\s*[（(].*$/, ''));
  return out.slice(0, 3);
}

/** 从条目页 HTML 里取主图（`#mainpic` 那张） */
export function parseMainPic(html) {
  const src = String(html || '');
  const m =
    src.match(/id="mainpic"[\s\S]{0,600}?<img[^>]+src="([^"]+)"/i) ||
    src.match(/<img[^>]+src="([^"]*\/view\/subject\/[^"]*)"[^>]*rel="v:photo"/i);
  return m ? m[1] : '';
}

/**
 * 豆瓣自己那张「暂无封面」占位图。
 *
 * 遇到它等于这条目**没有封面**——不能拿它当封面存进库里，
 * 否则页面上会出现一行「豆瓣默认灰图」，比我们自己的占位图还糟。
 */
export function isDefaultPic(url) {
  return /book-default|(^|\/)tic\/pics\//.test(String(url || ''));
}

/** 条目页 info 块里的几个字段（同版核对用） */
export function parseInfoLite(html) {
  const src = String(html || '');
  const grab = (label) => {
    const re = new RegExp(`<span class="pl">\\s*${label}[:：]?\\s*</span>\\s*([\\s\\S]{0,200}?)(?:<br|</div)`, 'i');
    const m = src.match(re);
    return m
      ? m[1]
          .replace(/<[^>]+>/g, '')
          .replace(/&nbsp;/g, ' ')
          .replace(/\s+/g, ' ')
          .trim()
      : '';
  };
  const titleM = src.match(/<span[^>]*property="v:itemreviewed"[^>]*>([\s\S]*?)<\/span>/i);
  return {
    title: titleM ? titleM[1].replace(/<[^>]+>/g, '').trim() : '',
    author: grab('作者'),
    publisher: grab('出版社'),
    year: grab('出版年'),
    isbn: grab('ISBN').replace(/[^\dXx]/g, ''),
    pages: grab('页数'),
  };
}

/**
 * 从 `verification.source` 里抠出 ISBN。
 *
 * 为什么要走 ISBN：豆瓣的 `j/subject_suggest` **不是全量索引**（§166 又碰到一例），
 * 而 `book.douban.com/isbn/<isbn>/` 会**直接跳到该 ISBN 的条目页**。
 * 本库的 `verification.source` 逐条记着馆藏著录的 ISBN，这正好是一条**精确定位那一版**的路子，
 * 而且比题名检索更强：它认的是书号，不是书名。
 */
export function isbnsOf(book) {
  const text = String(book?.verification?.source || '');
  const out = [];
  for (const m of text.matchAll(/ISBN[^\dXx]{0,8}((?:97[89][-\s]?)?[\dXx][-\s\d]{7,17}[\dXx])/g)) {
    const digits = m[1].replace(/[^\dXx]/g, '');
    if ((digits.length === 13 || digits.length === 10) && !out.includes(digits)) out.push(digits);
  }
  return out;
}

/**
 * 把 10 位书号折算成 13 位，用于**同一性比较**。
 *
 * 踩过的坑：馆藏著录里 1980–90 年代的书常用 10 位书号（`7501435642`），
 * 而豆瓣条目页写的是 13 位（`9787501435647`）——**是同一个书号**，
 * 若直接比字符串就会误判成「不是同一版」而白白放弃一本有封面的书。
 */
export function toIsbn13(isbn) {
  const s = String(isbn || '')
    .replace(/[^\dXx]/g, '')
    .toUpperCase();
  if (s.length !== 10) return s;
  const body = `978${s.slice(0, 9)}`;
  let sum = 0;
  for (let i = 0; i < 12; i += 1) sum += Number(body[i]) * (i % 2 ? 3 : 1);
  return `${body}${(10 - (sum % 10)) % 10}`;
}

/**
 * 把豆瓣的 s 档图片地址换成同图的 webp 档。
 *
 * 实测 CDN 支持**按扩展名换格式**（`…/s9102105.jpg` → `…/s9102105.webp`，同一张图小约 25%），
 * 所以全库封面都以 webp 存档；该图没有 webp 档时抓取端会退回 jpg。
 */
export function toWebp(url) {
  return String(url || '').replace(/\.jpg$/i, '.webp');
}

/**
 * 图片宽高（webp / jpeg 各解析一小段头，够用即可）。
 * 用途有两个：记进封面台账（便于日后核对），以及**校验下载到的确实是图片**。
 */
export function imageSize(buf) {
  if (!buf || buf.length < 24) return { format: '', width: 0, height: 0 };
  // JPEG
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i += 1;
        continue;
      }
      const marker = buf[i + 1];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return { format: 'jpeg', height: buf.readUInt16BE(i + 5), width: buf.readUInt16BE(i + 7) };
      }
      i += 2 + buf.readUInt16BE(i + 2);
    }
    return { format: 'jpeg', width: 0, height: 0 };
  }
  // WebP（RIFF....WEBP）
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') {
    const fourcc = buf.subarray(12, 16).toString('ascii');
    if (fourcc === 'VP8X') {
      const w = 1 + (buf[24] | (buf[25] << 8) | (buf[26] << 16));
      const h = 1 + (buf[27] | (buf[28] << 8) | (buf[29] << 16));
      return { format: 'webp', width: w, height: h };
    }
    if (fourcc === 'VP8 ') {
      return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
    }
    if (fourcc === 'VP8L') {
      const bits = buf.readUInt32LE(21);
      return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
    }
    return { format: 'webp', width: 0, height: 0 };
  }
  return { format: 'unknown', width: 0, height: 0 };
}
