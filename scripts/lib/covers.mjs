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

/**
 * 解析豆瓣 **works 页**（「这本书的其他版本」，`book.douban.com/works/<id>`）。
 *
 * 为什么要它：`j/subject_suggest` 只回一两个版本，而「版本择优」需要**全部版本**才能挑出最新的那一版。
 * works 页正是同一部作品所有版本的清单，加 `?order=time` 就是**按出版时间**排的（新的在前），
 * 每条带条目 id、封面图、出版社与出版年——挑完可以直接下图，不用再开条目页。
 *
 * 返回：[{ subjectId, title, year, publisher, pic }]
 */
export function parseWorksEditions(html) {
  const src = String(html || '');
  const out = [];
  const strip = (s) => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  for (const chunk of src.split('<div class="bkses').slice(1)) {
    const subjectId = (chunk.match(/href="https:\/\/book\.douban\.com\/subject\/(\d+)\//) || [])[1];
    if (!subjectId || out.some((e) => e.subjectId === subjectId)) continue;
    const pic = (chunk.match(/<img src="(https:\/\/img\d\.doubanio\.com\/view\/subject\/[^"]+)"/) || [])[1] || '';
    const title = strip((chunk.match(/class="pl2"[^>]*>([\s\S]{0,160}?)<\/a>/) || [])[1]);
    const publisher = strip((chunk.match(/出版社:\s*<\/span>\s*([\s\S]{0,80}?)<br/) || [])[1]);
    const translator = strip((chunk.match(/译者:\s*<\/span>\s*([\s\S]{0,80}?)<br/) || [])[1]);
    const year = ((chunk.match(/出版年:\s*<\/span>\s*([\d]{4}(?:-\d{1,2})?(?:-\d{1,2})?)/) || [])[1] || '').trim();
    out.push({ subjectId, title, year, publisher, translator, pic });
  }
  return out;
}

/**
 * 从条目页里找 works 页地址（`这本书的其他版本 ( 全部12 )` 那个链接）
 */
export function parseWorksLink(html) {
  const m = String(html || '').match(/href="https:\/\/book\.douban\.com\/works\/(\d+)"/);
  return m ? m[1] : '';
}

/* ------------------------------------------------------------------ */
/* 微信读书（第 170 轮：豆瓣 HTML 被限流时的第二条封面通道）             */
/* ------------------------------------------------------------------ */

/**
 * 解析微信读书的检索接口回执（`/web/search/global?keyword=…`）。
 *
 * 为什么用它：豆瓣的条目页／works 页会**整站限流**（返回 3KB 壳页），而微信读书这个接口是
 * JSON、不封、还**带出版社与译者**；它的封面 CDN **允许直接外链**（实测无 referer 也 200），
 * 所以「其他版本」的封面可以只存链接、按需加载，不必把几百 MB 塞进仓库。
 *
 * 返回：[{ bookId, title, author, translator, publisher, cover, rating, ratingCount }]
 */
export function parseWereadSearch(json) {
  const books = json?.books || json?.data?.books || [];
  const out = [];
  for (const item of books) {
    const b = item?.bookInfo || item || {};
    if (!b.bookId || !b.title) continue;
    out.push({
      bookId: String(b.bookId),
      title: String(b.title),
      author: String(b.author || ''),
      translator: String(b.translator || ''),
      publisher: String(b.publisher || ''),
      cover: String(b.cover || ''),
      rating: typeof b.newRating === 'number' ? b.newRating : null,
      ratingCount: typeof b.newRatingCount === 'number' ? b.newRatingCount : null,
    });
  }
  return out;
}

/**
 * 微信读书封面按档取图：URL 里的 `s_` 是缩略档，换成 `tN_` 可以得到更大的图。
 * 实测（同一张图）：`s_` 70×104 ｜ `t3_` 143×212 ｜ `t5_` 214×317 ｜ `t6_` 250×370 ｜ `t9_` 428×634。
 * 本库用 `t3_` 存/显示小图（体积与豆瓣 s 档接近），灯箱再按需取 `t9_`。
 */
export function wereadCoverAt(url, tier = 't3') {
  const src = String(url || '');
  if (!src) return '';
  return /\/[st]\d*_[^/]*$/.test(src) ? src.replace(/\/[st]\d*_/, `/${tier}_`) : src;
}

/**
 * 从微信读书的检索结果里挑「与库内这本书对得上」的版本。
 *
 * 判据比豆瓣那边更宽一点：题名完全一致最好；否则允许**题名包含**（微信读书上常见
 * 「金田一探案集03：狱门岛」这类带丛编前缀的写法），但**作者必须吻合**——
 * 同名不同书的坑在哪儿都一样。
 */
export function pickWereadEditions(book, list, { limit = 3 } = {}) {
  const want = normTitle(book.title);
  const scored = [];
  for (const c of list || []) {
    const n = normTitle(c.title);
    if (!n) continue;
    const exact = n === want;
    const contains = n.includes(want) || want.includes(n);
    if (!exact && !contains) continue;
    if (c.author && !authorMatches(book.author, c.author)) continue;
    scored.push({ ...c, exact });
  }
  scored.sort((a, b) => Number(b.exact) - Number(a.exact) || (b.ratingCount || 0) - (a.ratingCount || 0));
  return scored.slice(0, Math.max(0, limit));
}

/**
 * 这一页是不是豆瓣的**限流拦截页**。
 *
 * 豆瓣对高频访问会返回一个 3KB 上下的空壳（`<title>豆瓣</title>`，没有正文）。
 * 必须把它与「这页真的没有 works 块」区分开：否则会把整库都记成
 * 「这部作品没有其他版本」——那是**静默的数据损坏**，比抓不到更糟。
 */
export function isBlockPage(html, status = 200) {
  const src = String(html || '');
  if (status === 403 || status === 418) return true;
  if (!src) return false;
  return src.length < 8000 && !src.includes('id="mainpic"') && !src.includes('class="bkses');
}

/** 从任意写法里取四位年份（「2013-02」「2009年10月」都要能取出来） */
export function yearOf(value) {
  return String(value || '').match(/\d{4}/)?.[0] || '';
}

/**
 * 作者是否吻合（豆瓣的 `author_name` 写作「[日] 青崎有吾」「Alfred Hitchcock (ed.)」这类）。
 *
 * 用途：题名相同但作者不同的书**极多**（《狗之死》／《豺狗之死》就是一对），
 * 凡是要靠「题名前缀」「最新版本」这类**松判据**挑候选时，必须拿作者再核一道。
 */
export function authorMatches(bookAuthor, candAuthor) {
  const norm = (s) =>
    String(s || '')
      .replace(/[\[\]【】()（）\s·・.,，。、:：\-—]/g, '')
      .toLowerCase();
  const a = norm(bookAuthor);
  const b = norm(candAuthor);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

/**
 * 同一部作品的两个候选里，哪个**版本更新**（用于「新版封面优先」）。
 * 无年份的一方视为更旧——年份未知就没法证明它更新。
 */
export function newerCandidate(a, b) {
  const ay = yearOf(a?.year);
  const by = yearOf(b?.year);
  if (!ay) return b || null;
  if (!by) return a || null;
  return Number(by) > Number(ay) ? b : a;
}

/**
 * **版本择优**（第 168 轮，用户要求「选更新版本的封面，而不是用老的」）。
 *
 * 规则：
 *   1. 有候选与本库 `editionYear` **同年** → 用它（既是新版，又与所收版本一致）；
 *   2. 否则取**年份最新**的那一条；
 *   3. 挑「最新」时只认**题名完全一致**的候选——这一条是防「繁版顶掉简版」：
 *      台版《獄门島》与简体《狱门岛》归一之后并不相等，于是它不会因为「年份更新」而被选中。
 *
 * 作者也必须吻合（题名相同而作者不同的书极多，《狗之死》／《豺狗之死》就是一对）。
 * 候选来自两处：题名检索，以及 works 页（同一部作品的全部版本，最新在前）。
 */
export function pickNewestEdition(book, cands) {
  const want = normTitle(book.title);
  const bookYear = yearOf(book.editionYear);
  const titleHit = (c, allowPrefix) => {
    const n = normTitle(c?.title);
    if (!n) return false;
    if (n === want) return true;
    return Boolean(allowPrefix) && n.length >= 3 && (want.startsWith(n) || n.startsWith(want));
  };
  const usable = (cands || []).filter(
    (c) => titleHit(c, true) && (!c.author_name || authorMatches(book.author, c.author_name)),
  );
  const sameYear = bookYear ? usable.find((c) => yearOf(c.year) === bookYear) : null;
  if (sameYear) return { cand: sameYear, how: 'edition-year+title' };
  const dated = usable.filter((c) => yearOf(c.year) && c.pic && titleHit(c, false));
  if (!dated.length) return { cand: null, how: '' };
  dated.sort((a, b) => Number(yearOf(b.year)) - Number(yearOf(a.year)));
  return { cand: dated[0], how: 'newest+title' };
}

/**
 * 从条目页 HTML 里取主图（`#mainpic` 那张）
 */
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
 * 封面判据代码（前端详情页「封面来源」那一行用）。
 * ============================================
 * 台账里的 `matched` 是**抓取过程**的判据名，写得很细（`subject-id-miss+prefix+author` 之类），
 * 前端只需要一个字母表达「这张图的来历可信到什么程度」。这张表是两者的唯一映射。
 *
 * 注意 `editions+works` / `editions+weread` 这两个：它们是**版本一览那一轮**写下的
 * ——主图取自该作品的版本列表（works 页／微信读书的搜索结果），挑选规则是
 * 「先取与库内所收版本同年的一版，否则取最新的一版」。所以它落到的其实是
 * **Y（同年）或 N（最新）**，而不是弱链接。
 *
 * 这一条 2026-10-03 才补上：此前这两个判据名不在表里，会被兜底成 `W`＝「仅题名吻合（弱链接）」，
 * 于是全库 **2485 部**书的档案页都把自己的强判据写成了「弱链接」——**自己把自己的取证说轻了**。
 * 同一天还做了第二件事：那 2485 条里有 **2010 条的图其实一直是原来那条条目的图**
 * （与版本一览跑之前的快照比，`file` 与 `subjectId` 都没动），判据按快照恢复成原值；
 * 只有确实重挑过版本的 475 条才保留 Y／N。见 `scripts/restore-cover-evidence.mjs`。
 */
export const COVER_MATCH_CODE = {
  'subject-id': 'S',
  'subject-id+page': 'P',
  isbn: 'I',
  'shlib-isbn': 'B',
  weread: 'R',
  'edition-year+title': 'Y',
  'newest+title': 'N',
  'title+year': 'T',
  'title': 'W',
  'prefix+author': 'A',
  'subject-id-miss+title+year': 'T',
  'subject-id-miss+title': 'W',
  'subject-id-miss+prefix+author': 'A',
};

/** 台账记录 → 前端判据代码（认不出来的一律按最弱的 W 处理，不假装更强） */
export function coverCodeOf(rec) {
  if (!rec) return 'W';
  const known = COVER_MATCH_CODE[rec.matched];
  if (known) return known;
  if (rec.matched === 'editions+works' || rec.matched === 'editions+weread') {
    return rec.yearMatch === true ? 'Y' : 'N';
  }
  return 'W';
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
