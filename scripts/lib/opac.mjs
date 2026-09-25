/**
 * 扬州市图书馆 OPAC 的抓取与解析（**共享实现**）
 * ==============================================
 * 为什么抽成模块：这套解析现在有**两个**使用方——
 *   · `scripts/opac-verify.mjs`：按书名／按 marc 核题材与首版年；
 *   · `scripts/opac-author.mjs`：按责任者枚举某位作者的全部馆藏（不依赖豆瓣）。
 * 两边若各写一份解析，豆瓣／馆藏页面一改版就会出现「一处修好、另一处仍坏」的假象。
 * 项目在 `scripts/lib/dup-rules.mjs` 上已经吃过一次这个亏，这里不重蹈。
 */

export const BASE = 'http://opac.yzlib.cn:8080/opac';
export const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/** 剥标签 + 还原数字实体（馆藏页把汉字写成 &#x..;，不还原就是一堆乱码） */
export const strip = (s) =>
  String(s)
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/\s+/g, ' ')
    .trim();

/**
 * 连续失败计数：用于**熔断**。
 *
 * 为什么要它：本项目的馆藏枚举一旦连续抓几百上千次，站点会开始整站拒连
 * （实测 `--all` 扫描 324 位作者时把 opac.yzlib.cn 打到 `fetch failed`，
 * 连普通的条目页也一起取不到了）。没有熔断的话，脚本只会一路空转到底、
 * 期间持续加压，把限流拖得更久。计数交给调用方，达到阈值就停手。
 */
let consecutiveFailures = 0;
let inFlightOk = 0;
export const opacHealth = {
  get failures() {
    return consecutiveFailures;
  },
  get ok() {
    return inFlightOk;
  },
  reset() {
    consecutiveFailures = 0;
    inFlightOk = 0;
  },
};

/** OPAC 在连续请求下会偶发 500／超时，重试三次再说失败，避免把「取不到」误判成「没有」 */
export async function get(url, { retries = 3 } = {}) {
  let last;
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } });
      if (res.ok) {
        inFlightOk += 1;
        consecutiveFailures = 0;
        return await res.text();
      }
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    }
    await new Promise((r) => setTimeout(r, 600 * (i + 1)));
  }
  consecutiveFailures += 1;
  throw last;
}

/** MARC 展示区里的字段名，用于界定某个字段值的结束位置 */
export const MARC_LABELS = [
  '题名/责任者',
  '出版发行项',
  'ISBN及定价',
  '载体形态项',
  '其它题名',
  '并列正题名',
  '个人责任者',
  '个人次要责任者',
  '团体责任者',
  '学科主题',
  '论题主题',
  '地名主题',
  '中图法分类号',
  '一般附注',
  '内容附注',
  '丛编项',
  '丛编附注',
  '提要文摘附注',
  '摘要附注',
  '电子资源',
  '豆瓣相关资源',
];

/** 取一个字段的值：从字段名后开始，截到下一个**已知字段名**为止，再剥标签 */
export function field(html, label) {
  const i = html.indexOf(label);
  if (i < 0) return '';
  const tail = html.slice(i + label.length, i + label.length + 800);
  let end = tail.length;
  for (const s of MARC_LABELS) {
    const j = tail.indexOf(s);
    if (j >= 0 && j < end) end = j;
  }
  return strip(tail.slice(0, end)).replace(/^[:：]\s*/, '');
}

/** 同名多值字段（如「学科主题」会出现多次） */
export function fields(html, label) {
  const out = [];
  let from = 0;
  for (;;) {
    const i = html.indexOf(label, from);
    if (i < 0) break;
    const v = field(html.slice(i), label);
    if (v) out.push(v);
    from = i + label.length;
  }
  return out;
}

/** 解析检索结果列表页：每本书的 marc_no、题名、责任者、出版社、出版年、索书号 */
export function parseList(html) {
  const out = [];
  // 真实结构是 <li class="book_list_info"> ... </li>，标题里的汉字被写成 &#x..; 实体
  const liRe = /<li class="book_list_info">([\s\S]*?)<\/li>/g;
  let m;
  while ((m = liRe.exec(html))) {
    const li = m[1];
    const marc = (li.match(/item\.php\?marc_no=(\d+)/) || [])[1];
    if (!marc) continue;
    const h3 = (li.match(/<h3>([\s\S]*?)<\/h3>/) || [, ''])[1];
    const nameRaw = (h3.match(/<a href="item\.php\?marc_no=\d+[^"]*"\s*>([\s\S]*?)<\/a>/) || [, ''])[1];
    const name = strip(nameRaw).replace(/^\d+\./, '');
    const callno = strip(h3.replace(/<a[\s\S]*?<\/a>/, ''));
    // 出版项形如：新星出版社&nbsp;2011.04
    const pubM = li.match(/([\u4e00-\u9fa5A-Za-z（）()·．\.]{2,30}?)&nbsp;(\d{4}(?:\.\d{1,2})?)/);
    const author = strip((li.match(/可借复本：\d+<\/span>([\s\S]*?)<br/) || [, ''])[1]).replace(/著$/, '');
    out.push({
      marc,
      name,
      callno,
      author,
      pub: pubM ? strip(pubM[1]) : '',
      year: pubM ? pubM[2] : '',
    });
  }
  return out;
}

/** 取某条 marc 的完整书目详情 */
export async function detail(marc) {
  const html = await get(`${BASE}/item.php?marc_no=${marc}`);
  return {
    marc,
    titleRaw: field(html, '题名/责任者'),
    publine: field(html, '出版发行项'),
    isbn: field(html, 'ISBN及定价'),
    carrier: field(html, '载体形态项'),
    /**
     * **丛编项**是判「推理专门书系」的关键字段：它会写着「午夜文库·原创系列」
     * 「午夜文库·日系佳作」这类丛书名。少了它，「出版社是推理专门书系」
     * 这条判据就只能靠猜——而按第十节的规程，书系是五条判据里的一条。
     */
    series: field(html, '丛编项'),
    seriesNote: field(html, '丛编附注'),
    subjects: [...new Set(fields(html, '学科主题'))],
    clc: field(html, '中图法分类号'),
    abstract: field(html, '提要文摘附注'),
  };
}

/**
 * 中图法 I247.5x 各尾号的含义（用于把判读写得准确，不要笼统说成「长篇小说类」）
 * I247.5 新体长篇、中篇小说 → 尾号再分体裁
 */
export const CLC_I2475 = {
  'I247.5': '新体长篇、中篇小说（未再分体裁）',
  'I247.51': '革命斗争小说',
  'I247.52': '军事小说',
  'I247.53': '史传小说',
  'I247.54': '经济、政治建设小说',
  'I247.55': '**科学幻想小说**',
  'I247.56': '**侦探小说／推理小说**',
  'I247.57': '社会、言情小说（长篇通用类，**推理作品也可能被粗分到这里**）',
  'I247.58': '武侠小说',
  'I247.59': '其他题材小说',
};

/**
 * 中图法 + 学科主题 → 是否推理小说的判读
 *
 * ⚠️ **只认 `I247.56`，不能用 `I247.5` 前缀泛匹配**——`I247.57` 是长篇通用类、
 * `I247.55` 是科幻，前缀匹配会把非推理的通吃进来（《天使降临之塔》正是 I247.57，
 * 用前缀匹配就会被误判成推理）。
 */
export function clcVerdict(clc, subjects) {
  const cls = String(clc).trim();
  const subj = subjects.join(' ');
  const marks = [];
  if (cls.startsWith('I247.56')) marks.push('中图法 I247.56（中国当代侦探／推理小说）');
  if (/侦探小说|推理小说|侦探推理/.test(subj)) {
    marks.push(`主题词「${(subj.match(/侦探小说|推理小说|侦探推理/) || [])[0]}」`);
  }
  if (!marks.length && cls) {
    const tail = Object.keys(CLC_I2475)
      .filter((k) => cls.startsWith(k))
      .sort((a, b) => b.length - a.length)[0];
    marks.push(`⚠ 中图法 ${cls}${tail ? `（${CLC_I2475[tail]}）` : ''}——**未**归于推理类`);
  }
  return marks.length ? marks : ['（无分类号与主题词，需另行判定）'];
}
