/**
 * 判重规则（共享模块）
 * ==================
 * `find-duplicates.mjs`（闸门）与 `merge-dups.mjs`（修复工具）**必须用同一套判定**。
 *
 * 为什么要把规则抽出来：这两者一旦不一致，闸门就会长期报出一堆
 * 「工具修不了的重复」，久而久之没人再看它的输出——本轮排查发现库里
 * 积了 24 组真重复，正是因为闸门的 34 组里混着 10 组系列各卷的误报，
 * 报告失去可信度后被整体忽略了。
 *
 * 判定规则（两者共用）：
 *   A. 两边 originalTitle 都非空、归一化后**完全相等**，且作者可视为同一人。
 *      这条负责「异名同书」：同一个原作名被译成两个中文书名。
 *   B. 归一化书名完全相等，且作者可视为同一人（用于原书名缺失的情况）。
 *
 * 故意**不使用**「原书名互为包含」：那会把同一系列的相邻各卷
 * （《巷说百物语》/《后巷说百物语》、《思考机器探案集之幽灵汽车》/
 * 《…微笑的上帝》、《连续"杀人鬼"青蛙男》/《…噩梦再临》、《天久鹰央的
 * 推理病历表》/《…II》）误判成重复。系列各卷是独立作品。
 */

import { TRADITIONAL_MAP } from '../refresh-ratings.mjs';

/**
 * 繁简对照表**直接复用 refresh-ratings.mjs 的那一份**，不在这里另立。
 *
 * 踩过的坑：这里原本手写了一份只有五十几对的对照表，覆盖不到「煙」「貓」「蹤」
 * 这类字。于是《煙、土或食物》归一成「煙土或食物」、库里的《烟、土或食物》
 * 归一成「烟土或食物」，两者对不上——`check-new` 报「库中没有」，重复条目
 * 就这样进了库，最后靠判重闸门兜住。同一件事有两套实现，迟早会分叉。
 */
export const TRAD = TRADITIONAL_MAP;

const NOISE = /[\s\u3000《》〈〉·・:：,，.。、\-—－_/\\|()（）[\]【】「」『』!！?？"'“”‘’]/g;

export function normText(s) {
  return [...String(s ?? '')]
    .map((c) => TRAD[c] ?? c)
    .join('')
    .replace(NOISE, '')
    .toLowerCase();
}

/** 作者异名归一：同一作者的不同译名/署名 */
export const AUTHOR_ALIASES = {
  罗伯特范古利克: '高罗佩',
  罗伯范古利克: '高罗佩',
  法医秦明: '秦明',
  杰弗里迪弗: '杰夫里迪弗',
  孙沁文鸡丁: '孙沁文',
};

export const normAuthor = (s) => AUTHOR_ALIASES[normText(s)] || normText(s);

/**
 * 作者是否可视为同一人。
 * 不做严格相等：《莫尔格街凶杀案》两条分别署名「埃德加·爱伦·坡」与「爱伦·坡」，
 * 严格相等会漏合并；放得太宽（只比前两字）又会把《赎罪》这类重名书的不同作者
 * 混在一起，所以取「互相包含」。
 */
export function authorsCompatible(a, b) {
  const na = normAuthor(a);
  const nb = normAuthor(b);
  if (!na || !nb) return true;
  return na === nb || na.includes(nb) || nb.includes(na);
}

/**
 * 两个条目是否为同一部作品。
 * @returns {null | { rule: 'originalTitle' | 'title', detail: string }}
 */
export function duplicateReason(a, b) {
  if (!authorsCompatible(a.author, b.author)) return null;

  const ao = normText(a.originalTitle);
  const bo = normText(b.originalTitle);
  if (ao && bo && ao === bo) {
    return { rule: 'originalTitle', detail: `原书名相同（${a.originalTitle}）` };
  }

  const at = normText(a.title);
  const bt = normText(b.title);
  if (at && bt && at === bt) {
    return { rule: 'title', detail: `书名相同（${a.title}）` };
  }

  return null;
}

/** 选集名守卫：同一原作名被 3 条以上记录共用、且各条中文书名全不同 → 疑似选集名 */
export function looksLikeCollectionName(books) {
  if (books.length < 3) return false;
  return new Set(books.map((b) => b.title)).size === books.length;
}
