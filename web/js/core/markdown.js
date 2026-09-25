/**
 * Markdown 工具集
 * 目标：输出「干净整洁、可直接复制」的标准 Markdown（需求文档《排版要求》）
 */

/** 转义表格单元格中会破坏结构的字符 */
export function cell(value) {
  if (value === null || value === undefined || value === '') return '—';
  return String(value)
    .replace(/\|/g, '\\|')
    .replace(/\r?\n/g, '<br>')
    .trim();
}

/** 生成 Markdown 表格 */
export function table(headers, rows) {
  const head = `| ${headers.map(cell).join(' | ')} |`;
  const sep = `| ${headers.map(() => '------').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.map(cell).join(' | ')} |`).join('\n');
  return [head, sep, body].filter(Boolean).join('\n');
}

/**
 * 标签渲染：用反引号包裹。
 * 需求文档同时要求「标签用反引号包裹」，且《核心诡计标签》给出的是一串并列标签。
 * 为了让最外层仍是一个合法的 Markdown 代码段，多标签输出为 `诡计` `密室` `不在场证明`，
 * 再次复制该代码段即可还原。见 README《渲染约定》。
 */
export function tags(items) {
  const list = (items ?? []).filter(Boolean);
  if (!list.length) return '—';
  return list.map((t) => `\`${String(t).trim()}\``).join(' ');
}

/** 标题 */
export function h(level, text) {
  return `${'#'.repeat(level)} ${text}`;
}

/** 无序列表 */
export function ul(items, indent = 0) {
  const pad = ' '.repeat(indent);
  return (items ?? []).filter(Boolean).map((i) => `${pad}- ${i}`).join('\n');
}

/** 引用块 */
export function quote(text) {
  return String(text)
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n');
}

/** 分隔线 */
export const HR = '---';

/**
 * 平台评分展示：score=null 显示「暂无数据」
 * @param {{score:number|null, count:number|null}} entry
 */
export function ratingCell(entry) {
  if (!entry) return '暂无数据';
  const { score, count } = entry;
  if (score === null || score === undefined) return '暂无数据';
  const n = Number(score);
  const formatted = Number.isInteger(n) ? n.toFixed(1) : String(n);
  if (count === null || count === undefined || Number.isNaN(Number(count))) return formatted;
  return `${formatted}（${formatCount(Number(count))}人评价）`;
}

/** 评价人数的可读格式：170787 → 17.1 万；7418 → 7418 */
export function formatCount(count) {
  const n = Number(count);
  if (!Number.isFinite(n)) return '—';
  if (n >= 10000) return `${(n / 10000).toFixed(1)} 万`;
  return String(n);
}

/** 评分单位注解 */
export function scoreScale(entry) {
  if (!entry || entry.score === null || entry.score === undefined) return '';
  return entry.scale ?? '';
}

/** 去掉首尾空行、压缩多余空行 */
export function tidy(markdown) {
  return String(markdown)
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** 纯文本化（用于剪贴板摘要、搜索索引） */
export function plain(markdown) {
  return String(markdown)
    .replace(/```[\s\S]*?```/g, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*([^*]*)\*\*/g, '$1')
    .replace(/^\s*[-*]\s+/gm, '')
    .replace(/^\s*>\s?/gm, '')
    .replace(/\|/g, ' ')
    .replace(/\n{2,}/g, '\n')
    .trim();
}
