#!/usr/bin/env node
/**
 * 生成种子数据清单
 * ================
 * `web/js/core/seed-files.js` 由本脚本自动生成，**不要手工编辑**。
 *
 * 为什么需要它：浏览器端必须用**静态** import 才能加载 JSON
 * （动态拼接路径无法被打包器与静态托管正确处理），因此新增数据文件后
 * 需要重新生成本清单。这样「往 data/books/ 放一个 batch-NN-*.json」
 * 就能自动生效，不需要手改代码。
 *
 * 运行：node scripts/gen-seed-manifest.mjs
 * 已集成到 npm run build 与 npm run check 之前（见 package.json）。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const OUT = path.join(ROOT, 'web', 'js', 'core', 'seed-files.js');

/** 从文件名推导分组名 */
const GROUP_HINTS = [
  // ⚠️ 顺序即优先级。下面三条必须排在通用模式之前，
  // 否则 jp-masters / jp-new-wave 会先被 /modern/ 之类吞掉。
  [/jp-authors-expand/, '日本推理名家别集'],
  [/thin-authors/, '名单补厚 · 只有 1 部的作者续收'],
  [/gap-fill/, '按名单补缺 · 甲贺三郎 · 拟南芥 · 迪弗 · 高罗佩等'],
  [/chinese-contemporary/, '华语当代 · 麦家 · 何家弘 · 陈渐等'],
  [/chinese-new/, '华语民国侦探与当代新作者'],
  [/jp-new/, '日本新补作者 · 加贺美雅之 · 舞城王太郎等'],
  [/western-new/, '欧美新补 · 丹·布朗 · 迪弗 · 福翠尔 · 米德 · 高罗佩'],
  [/mid-authors/, '中等作者补完 · 按作者收全'],
  [/authors-misc/, '有栖川有栖 · 麻耶雄嵩 · 西泽保彦等 · 按作者收全'],
  [/miyabe-kyogoku/, '宫部美雪 · 京极夏彦 · 按作者收全'],
  [/edogawa/, '江户川乱步 · 按作者收全'],
  [/yokomizo-matsumoto/, '横沟正史 · 松本清张 · 按作者收全'],
  [/mitsuda-shimada-queen/, '三津田信三 · 岛田庄司 · 奎因 · 按作者收全'],
  [/jp-fill/, '日本收口补完 · 绫辻行人馆系列等'],
  [/western-fill/, '欧美收口补完 · 钱德勒 · 铁伊 · 布洛克等'],
  [/thin-fill/, '名单薄作者补遗 · 加贺美雅之 · 中井英夫'],
  [/rampo-volumes/, '江户川乱步 · 侦探作品集全 19 卷'],
  [/jp-audit/, '名单作者逐人复核 · 日本补遗'],
  [/west-audit/, '名单作者逐人复核 · 欧美补遗'],
  [/higashino-christie/, '东野圭吾 · 克里斯蒂 · 收口补完'],
  [/mid-depth/, '中等作者深度补完 · 名单内外'],
  [/higashino-shimada/, '东野圭吾 · 岛田庄司 · 深度补完'],
  [/masters-depth/, '克里斯蒂 · 松本清张 · 京极夏彦 · 深度补完'],
  [/christie/, '阿加莎·克里斯蒂 · 按作者收全'],
  [/queen-carr-rampo/, '奎因 · 卡尔 · 江户川乱步 · 按作者收全'],
  [/higashino/, '东野圭吾 · 按作者收全'],
  [/chinese-modern/, '华语现代推理 · 大陆与港台原创'],
  [/jp-classic-more/, '日本古典推理 · 战前战后补遗'],
  [/jp-modern-more/, '日本现代推理 · 新作与新人'],
  [/nordic-crime/, '北欧犯罪 · 哈利·霍勒与千禧年系列'],
  [/nordic-forensic/, '北欧冷案 · 法医鉴识 · 法庭与间谍'],
  [/chinese-honkaku/, '华语新本格 · 本土原创'],
  [/shimada/, '岛田庄司 · 御手洗洁与吉敷竹史系列'],
  [/aosaki-yugo/, '青崎有吾作品集'],
  [/jp-new-wave/, '日本现代推理 · 新世代作家'],
  [/jp-masters/, '日本推理名家补完'],
  [/jp-honkaku-expand/, '日本本格 · 新本格扩充'],
  [/jp-masters-expand/, '日本推理名家扩充'],
  [/jp-modern-fill/, '日本现代推理 · 主力与新生代补充'],
  [/jp-modern/, '日本近现代推理 · 新作与新人'],
  [/jp-modern-expand/, '日本近现代推理 · 新作与新人'],
  [/western-classic2/, '欧美古典推理 · 先驱与黄金时代'],
  [/western-classic/, '欧美古典推理 · 先驱与黄金时代'],
  [/jp-classic/, '日本古典推理 · 战前先驱与怪奇谱系'],
  [/jp-contemporary/, '日本近现代推理 · 战后与当代'],
  // batch-16 之前一直落在「其他」，分组名失去意义，这里补上
  [/more-authors/, '补作者覆盖 · 冷门佳作'],
  [/golden-age/, '欧美黄金时代 / 古典本格（续）'],
  // ⚠️ 顺序即优先级，且**必须覆盖新增批次**：
  // 未被任何模式匹配的文件会落到「其他」，分组名就失去意义。
  // 批量新增批次后请回来看一眼 `npm run gen:seed` 的输出，确认分组名正确。
  [/honkaku-more/, '日本本格 / 新本格（续）'],
  [/japanese-more/, '日本推理 · 变格与硬汉（续）'],
  [/shinhonkaku/, '日本新本格 · 叙述诡计'],
  [/honkaku/, '日本本格 / 新本格'],
  [/western-more/, '欧美与世界推理（续）'],
  [/world-mystery/, '欧美本格与日常之谜（续）'],
  [/world-crime/, '韩国 · 欧洲大陆 · 俄罗斯推理'],
  [/western/, '欧美古典本格'],
  [/social-more/, '华语 · 社会派 · 犯罪（续）'],
  [/chinese-more/, '华语推理（续）'],
  [/social/, '社会派 / 硬汉派'],
  [/chinese/, '华语与亚洲推理'],
  [/modern-crime/, '当代犯罪 · 心理惊悚 · 间谍'],
  [/modern/, '当代欧美 / 特殊设定'],
  [/golden-age/, '欧美黄金时代 / 古典本格（续）'],
];

function groupOf(file) {
  for (const [re, label] of GROUP_HINTS) if (re.test(file)) return label;
  return '其他';
}

function main() {
  let files = [];
  try {
    files = fs
      .readdirSync(BOOKS_DIR)
      .filter((f) => f.endsWith('.json') && !f.startsWith('_'))
      /**
       * **按批次号数值排序**，不能用默认的字典序：批次号已经超过 99，
       * 字典序会把 `batch-100-…` 排在 `batch-10-…` 与 `batch-11-…` 之间，
       * 于是第 100 批会插到第 10 批后面，清单顺序错乱。
       */
      .sort((a, b) => {
        const na = Number((a.match(/^batch-(\d+)/) || [])[1] ?? 0);
        const nb = Number((b.match(/^batch-(\d+)/) || [])[1] ?? 0);
        return na - nb || a.localeCompare(b);
      });
  } catch {
    console.error(`✗ 找不到数据目录：${BOOKS_DIR}`);
    process.exit(1);
  }

  if (!files.length) {
    console.error('✗ data/books/ 下没有数据文件');
    process.exit(1);
  }

  const entries = files.map((file, index) => ({
    file,
    group: groupOf(file),
    varName: `batch${String(index + 1).padStart(2, '0')}`,
  }));

  // 统计每批数量，写进注释便于核对
  const counts = entries.map((e) => {
    try {
      const list = JSON.parse(fs.readFileSync(path.join(BOOKS_DIR, e.file), 'utf8'));
      return Array.isArray(list) ? list.length : 0;
    } catch {
      return -1;
    }
  });

  const lines = [];
  lines.push('/**');
  lines.push(' * 种子数据清单 —— **本文件由 scripts/gen-seed-manifest.mjs 自动生成，请勿手工编辑**');
  lines.push(' *');
  lines.push(' * 浏览器端必须静态 import 才能加载 JSON（动态拼接路径无法被静态托管正确处理），');
  lines.push(' * 因此新增 data/books/batch-*.json 后运行 `npm run gen:seed` 重新生成本清单即可生效。');
  lines.push(' *');
  lines.push(` * 生成时间：${new Date().toISOString()}`);
  lines.push(` * 数据文件：${files.length} 个`);
  lines.push(' */');
  lines.push('');
  for (const e of entries) {
    lines.push(`import ${e.varName} from '../../../data/books/${e.file}' with { type: 'json' };`);
  }
  lines.push('');
  lines.push('/** 全部种子数据文件 */');
  lines.push('export const SEED_FILES = [');
  for (const [i, e] of entries.entries()) {
    const count = counts[i];
    lines.push(`  // ${count >= 0 ? `${count} 部` : '解析失败'}`);
    lines.push(`  { file: '${e.file}', group: ${JSON.stringify(e.group)}, data: ${e.varName} },`);
  }
  lines.push('];');
  lines.push('');

  const content = lines.join('\n');
  const previous = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : null;

  // 忽略时间戳行做比较，避免每次都重写
  const strip = (s) => (s ? s.replace(/^ \* 生成时间：.*$/m, '') : null);
  if (strip(previous) === strip(content)) {
    console.log(`  = 种子清单无变化（${files.length} 个文件）`);
    return;
  }

  fs.writeFileSync(OUT, content, 'utf8');
  const total = counts.reduce((a, b) => a + Math.max(0, b), 0);
  console.log(`  ✓ 已生成 web/js/core/seed-files.js：${files.length} 个文件，共 ${total} 部作品`);
  for (const [i, e] of entries.entries()) {
    console.log(`      ${e.file.padEnd(38)} ${String(counts[i]).padStart(3)} 部  ${e.group}`);
  }
}

main();
