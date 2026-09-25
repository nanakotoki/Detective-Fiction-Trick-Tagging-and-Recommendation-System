/**
 * 当当商品标题的清洗（共享）
 * ==========================
 * 当当的标题是**营销文案**，不是书名：正条标题常写成
 *   「久月邸事件 日版原名吸血之家 日本推理名家二阶堂黎人推理代表作！蜘蛛文库系列」
 * 更糟的是商家堆砌关键词，把**别的书名**也塞进来：
 *   「【法庭游戏】 久月邸事件 日本第1届鲇川哲也奖佳作 日本推理名家 二阶堂黎人…」
 * 所以任何比对都必须先取「首个空格/括号之前」的片段当书名，否则会把
 * 交叉推销的条目误判成命中的另一本书（这个坑在《乱神馆记》上真实发生过）。
 */

/** 当当标题里常见的营销前缀（剥掉它们才看得见真书名） */
const MARKETING_PREFIX =
  /^(官方预售|官方正版|现货正版|正版书籍|正版图书|正版包邮|正版|预售|新华书店|限量亲签|亲签|赠[^\s，,]{0,8}|当当自营|自营)\s*/;

/**
 * 从堆砌标题里取真实书名。
 *
 * 当当的标题有三种脏法，都要处理：
 *   ① 关键词堆砌：`【法庭游戏 】 久月邸事件 日本第1届鲇川哲也奖佳作 …`（交叉推销别的书）
 *   ② 营销前缀：`现货正版】三口棺材`、`正版《命案目睹记》小说`、`赠书签】正版…`
 *   ③ 丛书/卖点后缀：`罗杰疑案 3版 阿加莎克里斯蒂作品02 午夜文库 当当自营`
 * 取法：先反复剥营销前缀与 `【…】` 标记，再取首个空格/括号之前，最后优先取 `《…》`。
 */
export function leadTitle(raw) {
  let s = String(raw).trim();
  for (let i = 0; i < 5; i++) {
    const before = s;
    s = s.replace(MARKETING_PREFIX, '');
    // `【…】` 或 `…】` 形式的标记（后者如「现货正版】三口棺材」）
    if (s.startsWith('【')) {
      const close = s.indexOf('】');
      if (close > 0 && close < 24) s = s.slice(close + 1).trim();
    } else {
      const close = s.indexOf('】');
      const sp = s.search(/[\s　]/);
      if (close > 0 && close < 24 && (sp < 0 || close < sp)) s = s.slice(close + 1).trim();
    }
    if (s === before) break;
  }
  // 书名号优先：`正版《命案目睹记》小说` → 命案目睹记
  const quoted = s.match(/《([^》]{1,40})》/);
  if (quoted) return quoted[1].trim();
  const cut = s.search(/[\s　（(\[|【]/);
  if (cut > 0) s = s.slice(0, cut);
  s = s.replace(/[】\]]+$/, '').trim();
  // 「重生指纹新星出版社9787513362481」这类没有分隔符的，去掉尾部出版社与 ISBN
  s = s.replace(/(新星出版社|人民文学出版社|浙江文艺出版社|台海出版社|北京时代华文书局).*$/, '');
  s = s.replace(/\d{9,13}.*$/, '');
  return s.trim();
}

/** 从「作者 /2010-02-01 /吉林出版集团」这类行抽作者（第一个 / 之前） */
export function authorOf(line) {
  const s = String(line)
    .replace(/加入购物车收藏.*$/, '')
    .replace(/收藏.*$/, '')
    .trim();
  return s.split(/\s*\/\s*/)[0].replace(/\s+/g, ' ').trim();
}

/** 从作者行抽出版日期与出版社 */
export function pubOf(line) {
  const s = String(line);
  const d = (s.match(/\d{4}-\d{2}-\d{2}/) || [])[0] || '';
  const parts = s.split(/\s*\/\s*/);
  const last = (parts[parts.length - 1] || '').replace(/加入购物车收藏.*$/, '').trim();
  return { date: d, publisher: /出版社|出版公司|书局|书店|集团/.test(last) ? last : '' };
}
