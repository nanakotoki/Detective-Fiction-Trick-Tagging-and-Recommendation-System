#!/usr/bin/env node
/**
 * 实时评分抓取（豆瓣）
 * ====================
 * 抓取知识库中每本书在豆瓣的**真实**评分与评价人数，产出 `data/ratings-atlas.json`。
 * 抓取结果自带 `sourceUrl` 与 `fetchedAt`，可用 `verify-ratings.mjs` 复核。
 *
 * 流程：
 *   1. 用 `book.douban.com/j/subject_suggest` 按书名检索候选条目（JSON 接口，稳定）
 *   2. 对候选（默认取前 N 个不同版本）抓取详情页 HTML
 *   3. 用 core/ratings.js 解析评分与评价人数，**取评价人数最多的版本**作为该书代表
 *   4. 输出图谱文件，并打印与知识库中现有离线估计值的偏差
 *
 * 用法：
 *   node scripts/refresh-ratings.mjs                    全量抓取（约 5~8 分钟）
 *   node scripts/refresh-ratings.mjs --limit 5          只抓前 5 本
 *   node scripts/refresh-ratings.mjs --book western-001 只抓一本
 *   node scripts/refresh-ratings.mjs --candidates 5     每本书多比较几个版本
 *   node scripts/refresh-ratings.mjs --delay 800        调整请求间隔
 *
 * 增量补抓（新批次入库后用这条，不必重跑全库）：
 *   node scripts/refresh-ratings.mjs --missing --merge [--limit N]
 *     · `--missing` 只抓图谱里没有可追溯来源（`sourceUrl`）的书；
 *     · 其中**已知未命中**（图谱 `misses` 里记过的：检索无结果、只有外文原版条目、
 *       条目暂无评分…）**默认跳过**——它们的原因是内容层面的，重试每本要试 8 个关键词，
 *       实测比命中一本慢十倍以上。要重试请显式加 `--retry-misses`（第 109 轮）。
 *
 * ⚠️ 定向抓取（`--book` / `--limit`）会自动进入合并模式：只更新本次抓到的条目，
 *    图谱其余记录保持不变（否则一次补抓会把图谱改成几条，属于静默的数据丢失）。
 *
 * 合规说明：
 *   - 只读取评分(score)与评价人数(count)这类客观数值，**不抓取书评正文**，避免引入剧透
 *   - 默认 1.2 秒/次的请求间隔，单本最多抓 3 个候选版本，避免给豆瓣造成压力
 *   - 抓不到的条目保持原值并明确报告，**绝不编造**
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseDoubanSuggest, parseDoubanSubject, stampMonth } from '../web/js/core/ratings.js';
import { normalizeSeedBook } from '../web/js/core/seed.js';
import { withAliases } from '../data/search-aliases.mjs';
import { pinFor } from '../data/subject-pins.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BOOKS_DIR = path.join(ROOT, 'data', 'books');
const ATLAS = path.join(ROOT, 'data', 'ratings-atlas.json');

const C = {
  reset: '\u001b[0m',
  bold: '\u001b[1m',
  dim: '\u001b[2m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  cyan: '\u001b[36m',
};
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

/* ------------------------------------------------------------------ */
/* 参数                                                                */
/* ------------------------------------------------------------------ */

function parseArgs(argv) {
  const value = (flag, fallback) => {
    const i = argv.indexOf(flag);
    return i === -1 ? fallback : argv[i + 1];
  };
  return {
    limit: Number(value('--limit', 0)) || 0,
    bookId: value('--book', null),
    candidates: Math.max(1, Math.min(8, Number(value('--candidates', 4)) || 4)),
    delay: Math.max(200, Number(value('--delay', 1200)) || 1200),
    timeout: Number(value('--timeout', 15000)) || 15000,
    /**
     * 版本成熟度门槛：评价人数达到该值才视为"有统计意义的评分"。
     * 豆瓣上同一本书常有多个版本，冷门版本可能只有几十人评价（分数极易失真），
     * 用它作代表会污染数据，因此优先选择达到门槛且人数最多的版本。
     */
    minVotes: Math.max(0, Number(value('--min-votes', 200)) || 200),
    /** 合并模式：保留图谱中已有的记录，只更新这次抓到的（用于定向补抓） */
    merge: argv.includes('--merge'),
    /** 只抓图谱里还没有可追溯来源的书（新增批次后增量补抓，不必重跑全库） */
    missing: argv.includes('--missing'),
    /**
     * 连**已知未命中**的书也跳过（第 109 轮）。
     *
     * 起因：`--missing` 的判据是「图谱里没有 sourceUrl」，而上一轮记下的未命中
     * （`misses`：检索无结果、只有外文原版条目、条目暂无评分…）**同样没有 sourceUrl**，
     * 于是每轮补抓都会把它们从头再试一遍。这些书的未命中原因是**内容层面**的
     * （豆瓣确实没有中文版条目），不是网络层面的，重试只是白花请求时间——
     * 实测一本未命中要试 8 个关键词，比一本命中慢十倍以上。
     *
     * 所以给一个开关：**要重试已知未命中时显式传 `--retry-misses`**（例如豆瓣恢复了
     * 某类条目的索引，或有新的检索写法要试），默认跳过。
     */
    skipKnownMisses: argv.includes('--skip-known-misses') || !argv.includes('--retry-misses'),
    /** 允许用本轮结果整体替换图谱（默认下，记录数变少会被拦下） */
    rebuild: argv.includes('--rebuild'),
    quiet: argv.includes('--quiet'),
  };
}

const args = parseArgs(process.argv.slice(2));

/**
 * ⚠️ 定向抓取必须自动进入合并模式。
 *
 * `--book` / `--limit` 只探测一两本，若按非合并模式写出，图谱就从
 * 八百多条变成一条——这是**静默的全量数据丢失**：脚本不报错，
 * `verify-ratings` 也只在下次运行时才会发现覆盖范围变小。
 * 因此这里不等用户记得加 `--merge`，直接替他加上并说明原因。
 */
const isTargeted = Boolean(args.bookId) || args.limit > 0;
if (isTargeted && !args.merge) {
  args.merge = true;
  console.log('');
  console.log(
    '  ⓘ 检测到定向抓取（--book / --limit），已自动启用合并模式：' +
      '只更新本次抓到的条目，图谱中其余记录保持不变。'
  );
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

let requestCount = 0;

async function get(url, { json = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), args.timeout);
  requestCount += 1;
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': UA,
        accept: json ? 'application/json, text/plain, */*' : 'text/html,application/xhtml+xml',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        referer: 'https://book.douban.com/',
      },
    });
    if (!res.ok) return { ok: false, status: res.status, body: null };
    const text = await res.text();
    return { ok: true, status: res.status, body: json ? text : text };
  } catch (error) {
    return { ok: false, status: 0, body: null, error: error.message };
  } finally {
    clearTimeout(timer);
  }
}

/* ------------------------------------------------------------------ */
/* 数据加载                                                            */
/* ------------------------------------------------------------------ */

async function loadBooks() {
  const files = (await fs.readdir(BOOKS_DIR)).filter((f) => f.endsWith('.json') && !f.startsWith('_')).sort();
  const books = [];
  for (const file of files) {
    let list;
    try {
      list = JSON.parse(await fs.readFile(path.join(BOOKS_DIR, file), 'utf8'));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      const book = normalizeSeedBook(item, null, file);
      if (book) book.__file = file;
      if (book) books.push(book);
    }
  }
  return books;
}

/**
 * 在开始抓取**之前**读取既有图谱，供合并模式使用。
 *
 * 这个读取必须发生在写文件之前：早期版本在写出之后才读，
 * 读到的是刚写好的新内容，"保留旧记录"实际保留了空集，
 * 导致定向补抓时把其余记录全部丢掉（真实踩过的坑）。
 */
async function readExistingAtlas() {
  try {
    const raw = await fs.readFile(ATLAS, 'utf8');
    const parsed = JSON.parse(raw);
    const records = Array.isArray(parsed) ? parsed : (parsed.records ?? []);
    return Array.isArray(records) ? records : [];
  } catch {
    return [];
  }
}

/**
 * 读取上一轮图谱里记录的「未命中条目及其原因」。
 *
 * 定向补抓（`--book` / `--limit`）只探测少数几本，若不把上一轮的未命中原因
 * 带过来，写出的图谱里 `misses` 就会被整体清空——
 * 文档与排查都依赖这份分类（"条目暂无评分" vs "检索无结果" vs "解析失败"），
 * 不能因为补抓了一本就丢掉。
 */
async function readExistingMisses() {
  try {
    const raw = await fs.readFile(ATLAS, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed?.misses) ? parsed.misses : [];
  } catch {
    return [];
  }
}

/**
 * 作者名的**短式**（姓氏）。
 *
 * 豆瓣 suggest 对「尤·奈斯博」这类带中点的西文全名常常直接零结果，
 * 但换成「奈斯博」就能命中——真实踩过的坑：《蟑螂》《刀》两本因此抓不到评分，
 * 而同一个作者不带中点的写法（如「药丸岳」）却完全正常。
 * 所以额外准备一条只用姓氏的检索词兜底。
 */
export function shortAuthorName(author) {
  const name = String(author ?? '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .trim();
  if (!name) return '';
  const parts = name.split(/[·・.\s]+/).filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 1] : '';
}

/**
 * 生成多个检索关键词。
 *
 * 豆瓣的检索接口对书名写法相当敏感：「砂之器」搜不到，去掉「之」就能搜到；
 * 繁体/异体字（毬/掬、鞄…）与标点（·、《》）也会导致零结果。
 * 因此按"最精确优先"的顺序准备多个候选关键词，逐个尝试直到有结果。
 */
export function buildQueries(book) {
  const title = String(book.title ?? '').trim();
  const queries = [];

  const push = (q) => {
    const value = String(q ?? '').trim();
    if (value && !queries.includes(value)) queries.push(value);
  };

  push(title);
  // 去掉副标题与标点（保留主体）
  push(title.split(/[·:：,，\-—（(]/)[0]);
  // 去掉「之」这类容易导致零结果的连接字
  push(title.replace(/之/g, ''));
  // 繁体异体字的常见对应
  push(
    title
      .replace(/毬/g, '掬')
      .replace(/鞄/g, '包')
      .replace(/館/g, '馆')
      .replace(/殺/g, '杀')
      .replace(/惡/g, '恶'),
  );
  // 去掉括号补充说明
  push(title.replace(/[（(].*?[)）]/g, ''));
  /**
   * 原书名。
   *
   * 豆瓣上不少作品只有外文原版条目（《Strong Poison》《Faceless Killers》
   * 《天使のナイフ》《살인자의 기억법》…），只用中文书名检索必然零结果。
   * 原书名通常比中文译名更精确，因此排在中文变体之后、带作者之前。
   */
  push(book.originalTitle);
  // **最后**才带上作者：用于《知更鸟》这类重名书。
  // 必须排在其他关键词之后——若排前面，检索结果会只剩该作者的版本，
  // 反而把评价人数最多的通行版挤出候选（真实踩过的坑）。
  const author = book.author ? String(book.author).replace(/^\[[^\]]*\]\s*/, '') : '';
  if (author) push(`${title} ${author}`);
  // 原书名 + 作者：外文原版条目里同名书很多，这一步用来收敛
  if (book.originalTitle && author) push(`${String(book.originalTitle)} ${author}`);
  // 带中点的全名可能反而搜不到，用姓氏再兜一次底
  const short = shortAuthorName(book.author);
  if (short && short !== author) {
    push(`${title} ${short}`);
    if (book.originalTitle) push(`${String(book.originalTitle)} ${short}`);
  }
  /**
   * 繁体写法兜底。
   *
   * 有些作品**只有台版**（战前的甲贺三郎、木木高太郎等），
   * 库里按简体登记，而豆瓣上只有繁体条目——只搜简体必然零结果。
   * 放在最后：简繁通吃的书前面早就命中了，轮不到这一条。
   */
  const traditional = toTraditional(title);
  if (traditional && traditional !== title) push(traditional);

  return queries.slice(0, 12);
}

/* ------------------------------------------------------------------ */
/* 书名 / 作者比对                                                     */
/* ------------------------------------------------------------------ */

const NOISE_CHARS = /[\s《》〈〉·・:：,，.。、\-—－_/\\|()（）\[\]【】「」『』!！?？"'“”‘’]/g;

/**
 * 常见繁体 → 简体映射（只覆盖推理小说书名/作者名里高频出现的字）。
 *
 * 豆瓣上同一本书常有繁体条目，若不归一化就会判成"另一本书"。
 * Node 内置的 TextDecoder 只做编码解码，不做简繁转换，因此维护一张小表；
 * 表外的字交给「作者匹配 + 评分」逻辑兜底。
 */
/**
 * 繁简对照表（繁体 → 简体），**全项目唯一的对照表**。
 *
 * `scripts/lib/dup-rules.mjs` 会 import 它做判重归一化。此前判重那边自己维护了
 * 一份手写的小表（只有五十几对），结果「煙/烟」「貓/猫」「蹤/踪」这些字没有覆盖，
 * 于是《煙、土或食物》《三毛貓追蹤》被 `check-new` 判成「库中没有」而重复入库——
 * 最后由判重闸门兜住。**同一件事有两套实现，迟早会分叉**，所以这里导出，
 * 判重直接复用，不再另立一份。
 */
export const TRADITIONAL_MAP = {
  偵: '侦', 兇: '凶', 兒: '儿', 內: '内', 兩: '两', 冊: '册', 劃: '划', 劇: '剧', 劍: '剑', 動: '动', 勝: '胜', 匯: '汇',
  員: '员', 嚇: '吓', 圍: '围', 園: '园', 圓: '圆', 圖: '图', 團: '团', 執: '执', 場: '场', 壞: '坏', 學: '学', 實: '实',
  寫: '写', 寶: '宝', 將: '将', 專: '专', 尋: '寻', 對: '对', 導: '导', 屍: '尸', 層: '层', 屬: '属', 岡: '冈', 島: '岛',
  嶺: '岭', 巖: '岩', 帥: '帅', 帶: '带', 幫: '帮', 幹: '干', 幾: '几', 廟: '庙', 廢: '废', 廳: '厅', 張: '张', 彈: '弹',
  彙: '汇', 彥: '彦', 復: '复', 徹: '彻', 惡: '恶', 愛: '爱', 慘: '惨', 憶: '忆', 應: '应', 懷: '怀', 戰: '战', 戲: '戏',
  戶: '户', 揚: '扬', 撲: '扑', 擔: '担', 據: '据', 擠: '挤', 擺: '摆', 攝: '摄', 敗: '败', 敵: '敌', 數: '数', 斷: '断',
  於: '于', 昇: '升', 時: '时', 書: '书', 會: '会', 東: '东', 業: '业', 極: '极', 樂: '乐', 樓: '楼', 樹: '树', 橋: '桥',
  機: '机', 橫: '横', 檢: '检', 權: '权', 歡: '欢', 歲: '岁', 歷: '历', 殘: '残', 殺: '杀', 毀: '毁', 氣: '气', 決: '决',
  沒: '没', 測: '测', 湊: '凑', 準: '准', 溝: '沟', 滅: '灭', 滿: '满', 漢: '汉', 潑: '泼', 潔: '洁', 澀: '涩', 澤: '泽',
  灣: '湾', 災: '灾', 為: '为', 烏: '乌', 無: '无', 煙: '烟', 熱: '热', 燈: '灯', 燒: '烧', 營: '营', 爭: '争', 爺: '爷',
  爾: '尔', 牆: '墙', 獄: '狱', 獨: '独', 獲: '获', 獵: '猎', 現: '现', 環: '环', 產: '产', 畢: '毕', 畫: '画', 異: '异',
  當: '当', 疇: '畴', 痙: '痉', 瘋: '疯', 療: '疗', 發: '发', 皺: '皱', 盡: '尽', 監: '监', 盤: '盘', 眾: '众', 睜: '睁',
  矚: '瞩', 碼: '码', 礎: '础', 礙: '碍', 祿: '禄', 禍: '祸', 禮: '礼', 種: '种', 稱: '称', 積: '积', 穩: '稳', 窮: '穷',
  竊: '窃', 競: '竞', 筆: '笔', 節: '节', 範: '范', 簡: '简', 簽: '签', 籤: '签', 粵: '粤', 紀: '纪', 純: '纯', 紙: '纸',
  級: '级', 紛: '纷', 細: '细', 終: '终', 組: '组', 結: '结', 絕: '绝', 統: '统', 絲: '丝', 經: '经', 綠: '绿', 維: '维',
  綱: '纲', 網: '网', 綾: '绫', 緊: '紧', 線: '线', 練: '练', 縮: '缩', 總: '总', 織: '织', 繼: '继', 續: '续', 纏: '缠',
  罰: '罚', 罷: '罢', 羅: '罗', 義: '义', 習: '习', 聞: '闻', 聯: '联', 聽: '听', 肅: '肃', 腦: '脑', 腫: '肿', 臉: '脸',
  臨: '临', 與: '与', 舉: '举', 舊: '旧', 莊: '庄', 華: '华', 萬: '万', 葉: '叶', 蓋: '盖', 藥: '药', 處: '处', 號: '号',
  蟲: '虫', 術: '术', 衛: '卫', 衝: '冲', 補: '补', 裝: '装', 複: '复', 見: '见', 規: '规', 覺: '觉', 觀: '观', 觸: '触',
  訂: '订', 計: '计', 討: '讨', 訓: '训', 記: '记', 訪: '访', 設: '设', 許: '许', 訴: '诉', 診: '诊', 註: '注', 評: '评',
  詛: '诅', 詞: '词', 試: '试', 詩: '诗', 話: '话', 該: '该', 詳: '详', 誌: '志', 認: '认', 語: '语', 誠: '诚', 誤: '误',
  說: '说', 誰: '谁', 課: '课', 調: '调', 談: '谈', 請: '请', 論: '论', 諜: '谍', 諮: '咨', 諾: '诺', 謀: '谋', 謊: '谎',
  謎: '谜', 講: '讲', 謝: '谢', 證: '证', 識: '识', 譜: '谱', 譯: '译', 護: '护', 讀: '读', 變: '变', 讓: '让', 讚: '赞',
  貝: '贝', 負: '负', 財: '财', 貨: '货', 貫: '贯', 責: '责', 貴: '贵', 買: '买', 費: '费', 資: '资', 賊: '贼', 賓: '宾',
  賞: '赏', 賠: '赔', 賣: '卖', 質: '质', 賬: '账', 賽: '赛', 贈: '赠', 贏: '赢', 贖: '赎', 趕: '赶', 趙: '赵', 躍: '跃',
  車: '车', 軌: '轨', 軍: '军', 軟: '软', 較: '较', 載: '载', 輔: '辅', 輕: '轻', 輛: '辆', 輝: '辉', 輪: '轮', 輸: '输',
  轉: '转', 轟: '轰', 農: '农', 遊: '游', 運: '运', 過: '过', 遠: '远', 適: '适', 遲: '迟', 選: '选', 遺: '遗', 邊: '边',
  邏: '逻', 郵: '邮', 鄉: '乡', 鄰: '邻', 醜: '丑', 醫: '医', 釋: '释', 釘: '钉', 針: '针', 釣: '钓', 鈴: '铃', 銀: '银',
  銅: '铜', 銷: '销', 鋒: '锋', 鋪: '铺', 鋼: '钢', 錄: '录', 錢: '钱', 錯: '错', 錶: '表', 鍵: '键', 鍾: '钟', 鎖: '锁',
  鏡: '镜', 鐘: '钟', 鐵: '铁', 鑄: '铸', 長: '长', 門: '门', 閉: '闭', 開: '开', 間: '间', 閣: '阁', 闇: '暗', 關: '关',
  陣: '阵', 陰: '阴', 陳: '陈', 陸: '陆', 陽: '阳', 隊: '队', 階: '阶', 際: '际', 隨: '随', 險: '险', 隱: '隐', 雖: '虽',
  雙: '双', 雜: '杂', 雞: '鸡', 離: '离', 難: '难', 雲: '云', 電: '电', 霧: '雾', 靈: '灵', 靜: '静', 韓: '韩', 響: '响',
  頁: '页', 頂: '顶', 項: '项', 順: '顺', 須: '须', 預: '预', 領: '领', 頭: '头', 頸: '颈', 題: '题', 顏: '颜', 願: '愿',
  類: '类', 顧: '顾', 顯: '显', 風: '风', 飄: '飘', 飛: '飞', 飯: '饭', 飲: '饮', 飾: '饰', 養: '养', 館: '馆', 馬: '马',
  騎: '骑', 驅: '驱', 驗: '验', 驚: '惊', 體: '体', 鬥: '斗', 魯: '鲁', 鮮: '鲜', 鳥: '鸟', 鳴: '鸣', 鴉: '鸦', 鷹: '鹰',
  鹽: '盐', 麗: '丽', 麥: '麦', 麵: '面', 麼: '么', 黃: '黄', 點: '点', 黨: '党', 齊: '齐', 齒: '齿', 齡: '龄', 龍: '龙',
  龜: '龟',
  // 日文汉字 / 罕见繁体：豆瓣上日版与原版条目常用这些写法，
  // 缺字同样会导致「书名不匹配」而漏抓（《高瀬舟》《神州纐纈城》《三毛貓推理》踩过）
  瀬: '濑', 纈: '缬', 鴎: '鸥', 貓: '猫', 藪: '薮', 鷗: '鸥', 瀨: '濑',
  舖: '铺', 舘: '馆', 峯: '峰', 濱: '滨', 濶: '阔', 圍: '围', 鹽: '盐',
  薰: '熏', 號: '号', 狀: '状', 彌: '弥', 惡: '恶', 搖: '摇', 檢: '检',
  宮: '宫', 獻: '献', 鶴: '鹤', 鳳: '凤', 鵬: '鹏', 跡: '迹', 週: '周',
  給: '给', 結: '结', 絕: '绝', 統: '统', 經: '经', 維: '维', 綱: '纲',
  // 日文书名专用的助词与日文汉字：豆瓣上只有日文原版条目时，
  // 「法月綸太郎の冒険」这类写法要能与中文译名「法月纶太郎的冒险」对上
  の: '的', 険: '险', 點: '点', 劑: '剂', 醫: '医', 攝: '摄', 圖: '图',
  綸: '纶', 貫: '贯', 嶋: '岛', 藪: '薮', 鷲: '鹫', 鯨: '鲸', 鮎: '鲇',
  // 日文新字体（与繁体字形不同，缺失时日文原版条目会被判成「另一本书」）
  黒: '黑', 薬: '药', 沢: '泽', 恵: '惠', 徳: '德', 塩: '盐', 竜: '龙', 渋: '涩',
  稲: '稻', 縁: '缘', 顔: '颜', 検: '检', 験: '验', 権: '权', 歓: '欢', 観: '观',
  気: '气', 経: '经', 続: '续', 総: '总', 戦: '战', 単: '单', 団: '团', 対: '对',
  発: '发', 変: '变', 辺: '边', 歩: '步', 豊: '丰', 毎: '每', 亜: '亚', 圧: '压',
  囲: '围', 売: '卖', 覚: '觉', 楽: '乐', 壊: '坏', 拡: '扩', 挙: '举', 拠: '据',
  済: '济', 産: '产', 実: '实', 舎: '舍', 獣: '兽', 収: '收', 従: '从', 渉: '涉',
  焼: '烧', 畳: '叠', 縄: '绳', 壌: '壤', 嬢: '娘', 剰: '剩', 払: '拂', 抜: '拔',
  択: '择', 訳: '译', 釈: '释', 駅: '驿', 桜: '樱', 顕: '显', 県: '县', 剣: '剑',
  戀: '恋', 蠻: '蛮', 彎: '弯', 傑: '杰', 僅: '仅', 儲: '储', 優: '优', 傭: '佣',
  儉: '俭', 債: '债', 傾: '倾', 僑: '侨', 偽: '伪', 偉: '伟', 傳: '传', 傑: '杰',
  惱: '恼', 愛: '爱', 愴: '怆', 慣: '惯', 憊: '惫', 慘: '惨', 慚: '惭', 憫: '悯',
  憐: '怜', 憎: '憎', 懇: '恳', 應: '应', 懲: '惩', 懷: '怀', 懸: '悬', 懼: '惧',
  亂: '乱', 爭: '争', 龜: '龟', 齒: '齿', 齡: '龄', 龍: '龙', 龐: '庞', 龜: '龟',
  國: '国', 圖: '图', 團: '团', 園: '园', 圓: '圆', 場: '场', 壇: '坛',
  橫: '横', 歲: '岁', 產: '产', 詢: '询', 謠: '谣', 誘: '诱', 豎: '竖',
  /**
   * 补齐「简 -> 繁」反查所需的字。
   *
   * 下面这些字原本不在表里，而它们恰恰常出现在书名中：
   * 「甲賀三郎」的賀、「美術館」的館——缺了它们，
   * `toTraditional('日本侦探小说选Ⅲ：甲贺三郎作品集1')` 只能转出
   * 「日本偵探小說選Ⅲ：甲贺三郎作品集1」这种半繁半简的检索词，
   * 台版条目照样搜不到（真实踩过的坑）。
   */
  賀: '贺', 館: '馆', 書: '书', 讀: '读', 語: '语', 詩: '诗', 話: '话',
  記: '记', 紀: '纪', 誰: '谁', 論: '论', 議: '议', 謝: '谢', 證: '证',
  識: '识', 譯: '译', 護: '护', 評: '评', 訴: '诉', 診: '诊', 詳: '详',
  誌: '志', 認: '认', 誠: '诚', 談: '谈', 請: '请', 諸: '诸', 謀: '谋',
  謎: '谜', 講: '讲', 譜: '谱', 譽: '誉', 貝: '贝', 貞: '贞', 負: '负',
  貢: '贡', 貧: '贫', 貨: '货', 販: '贩', 貫: '贯', 責: '责', 買: '买',
  貸: '贷', 費: '费', 貼: '贴', 資: '资', 賊: '贼', 賓: '宾', 賞: '赏',
  賢: '贤', 賣: '卖', 質: '质', 賭: '赌', 購: '购', 賽: '赛', 贏: '赢',
  趨: '趋', 跡: '迹', 蹤: '踪', 軍: '军', 軒: '轩', 軟: '软', 載: '载',
  輕: '轻', 輛: '辆', 輝: '辉', 輩: '辈', 輪: '轮', 輸: '输', 轉: '转',
  辦: '办', 農: '农', 邏: '逻', 鋼: '钢', 銀: '银', 錢: '钱', 鎖: '锁',
  鏡: '镜', 鐘: '钟', 鑰: '钥', 長: '长', 門: '门', 閉: '闭', 開: '开',
  間: '间', 關: '关', 陰: '阴', 陽: '阳', 隨: '随', 隱: '隐', 雙: '双',
  難: '难', 靈: '灵', 靜: '静', 頁: '页', 頂: '顶', 順: '顺', 預: '预',
  領: '领', 頭: '头', 題: '题', 顏: '颜', 願: '愿', 類: '类', 風: '风',
  飛: '飞', 飯: '饭', 館: '馆', 馬: '马', 驅: '驱', 驗: '验', 體: '体',
  高: '高', 鬥: '斗', 魚: '鱼', 鳥: '鸟', 麗: '丽', 黃: '黄', 黨: '党',
  幣: '币', 盜: '盗', 偵: '侦', 殺: '杀', 團: '团', 獸: '兽', 黒: '黑',
};

/** 把繁体字替换成简体（只处理表内字） */
function toSimplified(text) {
  let out = '';
  for (const ch of String(text ?? '')) out += TRADITIONAL_MAP[ch] ?? ch;
  return out;
}

/**
 * 简体 -> 繁体 的反查表。
 *
 * 多个繁体字归并到同一个简体字时（館/舘 -> 馆、幹/乾 -> 干），
 * 反查只能挑一个。早期版本的做法是「不唯一就整条丢弃」，结果是
 * 「馆」这种被两个繁体字共用的高频字**完全无法反查**，
 * `toTraditional('美术馆')` 会转出「美術馆」这种半繁半简的检索词。
 *
 * 现在改为：**取表内首次出现的那一个**（表的编排里标准繁体在前、
 * 异体在后），再用 AMBIGUOUS_TRADITIONAL 对已知会挑错的字显式纠正。
 */
const AMBIGUOUS_TRADITIONAL = {
  干: '乾', // 乾燥/乾淨 用「乾」；「幹部」的幹是另一义，书名里罕见
  发: '發', // 發現/出發 用「發」；「頭髮」的髮是另一义
  只: '隻', // 一隻/兩隻 用「隻」；「只有」的只不同字
  后: '後', // 後天/最後 用「後」；「皇后」的后不同字
  钟: '鐘', // 鐘錶/時鐘 用「鐘」；「鍾」是姓氏與酒器，书名里几乎不用
  台: '臺', // 臺灣/舞臺 用「臺」
  里: '裡', // 裡面/那裡 用「裡」
  面: '面', // 面本身在繁體裡就是「面」；「麵」是麵條，不能拿來代替（「二十面相」曾被转成「二十麵相」）
};

const SIMPLIFIED_TO_TRADITIONAL = (() => {
  const reverse = {};
  for (const [t, s] of Object.entries(TRADITIONAL_MAP)) {
    if (!(s in reverse)) reverse[s] = t; // 首次出现优先，不覆盖
  }
  return { ...reverse, ...AMBIGUOUS_TRADITIONAL };
})();

/** 把简体字换成对应的繁体字（只处理能一对一反推的字） */
export function toTraditional(text) {
  let out = '';
  for (const ch of String(text ?? '')) out += SIMPLIFIED_TO_TRADITIONAL[ch] ?? ch;
  return out;
}

/** 归一化书名，用于比对 */
export function normalizeTitle(text) {
  return toSimplified(String(text ?? '').replace(NOISE_CHARS, '')).toLowerCase();
}

/** 归一化作者名：去掉国别前缀、译者标注、空格与点 */
export function normalizeAuthor(text) {
  return toSimplified(
    String(text ?? '')
      .replace(/^\[[^\]]*\]\s*/, '')
      .replace(/[（(].*?[)）]/g, '')
      .replace(NOISE_CHARS, '')
      .replace(/著|译|编|等/g, ''),
  ).toLowerCase();
}

/**
 * 比对用的"骨架"：在归一化基础上再剥离虚词、分隔符，并把中文数词折成阿拉伯数字。
 *
 * 中文书名常因译者不同而在这些地方产生差异：
 *   「砂之器」/「砂器」                     —— 虚词增减
 *   「心理罪·画像」/「心理罪：画像」           —— 分隔符不同
 *   「19年间谋杀小叙」/「十九年间谋杀小叙」     —— 数字写法不同
 * 不做这一步，正规译名会被判成"另一本书"而漏抓（真实踩过的坑）。
 */
function titleSkeleton(text) {
  return normalizeTitle(text)
    .replace(/[之的与和]/g, '')
    .replace(/[·・:：]/g, '')
    .replace(/[零一二三四五六七八九十百千两]+/g, (run) => String(cjkToNumber(run) ?? run));
}

/**
 * 中文数词 → 数字（只支持书名里可能出现的量级：一 ~ 九千九百九十九）。
 * 处理「十九」→19、「二十」→20、「一百零三」→103 这类写法。
 * @param {string} run
 * @returns {number|null} 无法解析时返回 null
 */
export function cjkToNumber(run) {
  const DIGITS = { 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
  const UNITS = { 十: 10, 百: 100, 千: 1000 };
  let total = 0;
  let section = 0;
  let seen = false;

  for (const ch of String(run)) {
    if (ch in DIGITS) {
      section = DIGITS[ch];
      seen = true;
    } else if (ch in UNITS) {
      const unit = UNITS[ch];
      // 「十九」这种以单位开头的写法，隐含 1
      section = (section || 1) * unit;
      total += section;
      section = 0;
      seen = true;
    } else {
      return null;
    }
  }
  return seen ? total + section : null;
}

/**
 * 判断候选条目是否**很可能不是同一本书**。
 *
 * 这是为了防住一类真实事故：检索「知更鸟」时豆瓣第一条是哈珀·李的
 * 《杀死一只知更鸟》（9.3 分、9 万人评价），而目标是尤·奈斯博的《知更鸟》。
 * 只按"评价人数最多"挑选，就会把完全无关的书的高分写进知识库。
 *
 * 判定依据：
 *   - 书名骨架完全相同 → 放行（同书不同版本 / 不同译名）
 *   - 候选与**原书名**相符 → 放行（豆瓣上常常只有外文原版条目）
 *   - 书名不完全一致时，必须作者匹配才放行
 *   - 作者匹配且书名是包含关系 → 放行
 *
 * @param {{title:string, author:string}} candidate
 * @param {{title:string, author:string, originalTitle?:string}} book
 * @returns {{ reject: boolean, reason?: string }}
 */
export function looksLikeDifferentBook(candidate, book) {
  const cTitle = normalizeTitle(candidate.title);
  const bTitle = normalizeTitle(book.title);
  const cAuthor = normalizeAuthor(candidate.author);
  const bAuthor = normalizeAuthor(book.author);

  if (!cTitle || !bTitle) return { reject: false };

  // 作者比对：只要有一方的名字片段出现在另一方即可（处理「[英] 阿加莎·克里斯蒂」这类写法）
  const authorKey = bAuthor.slice(0, 2);
  const authorMatches = !cAuthor || !bAuthor || cAuthor.includes(authorKey) || bAuthor.includes(cAuthor.slice(0, 2));

  /**
   * 原书名比对。
   *
   * 豆瓣上很多作品只有外文原版条目——《Strong Poison》《Murder Must Advertise》
   * 《天使のナイフ》都是如此。只拿中文书名去比对，这些条目永远会被判成
   * 「另一本书」而漏抓，前 42 部未命中条目里的大半都是这个原因。
   *
   * ⚠️ 这里**不能要求作者匹配**：豆瓣对原版条目返回的是作者的外文名
   * （《剧毒》的作者在豆瓣是「Dorothy L. Sayers」，而库里存的是「多萝西·L·塞耶斯」），
   * 中英文名对不上，作者判定必然失败——早期就是因为这点导致这批书全部漏抓。
   *
   * 因此分两档：
   *   - 原书名骨架**完全相同** → 直接放行（标题一字不差已经足够强的证据，
   *     即使作者名对不上，也只可能是同一部作品的不同版本）
   *   - 只是**包含关系** → 仍要求作者匹配（防止《The Cask》吃到
   *     爱伦·坡的《The Cask of Amontillado》）
   */
  const orig = String(book.originalTitle ?? '').trim();
  if (orig) {
    const cSkel = titleSkeleton(candidate.title);
    const oSkel = titleSkeleton(orig);
    if (cSkel && oSkel) {
      if (cSkel === oSkel) return { reject: false };
      if ((cSkel.includes(oSkel) || oSkel.includes(cSkel)) && authorMatches) return { reject: false };
    }
  }

  /**
   * 中文书名骨架一致 → 视为同一本书的不同版本，**但仍要求作者对得上**。
   *
   * ⚠️ 这里原先是「骨架相同就直接放行，连作者都不看」，理由是「标题一字不差
   * 已足够强」。对长而独特的书名成立，对**通用短书名必然出错**：库里久生十兰的
   * 《魔都》因此吃到了村松梢风同名上海游记（原作 SHANGHAI）的评分 7.2/465 人，
   * 而两者毫无关系。同类风险还有《十字街》《黑色记事本》这类词。
   *
   * 作者校验本身是宽松的（任一方前两字出现在另一方即可，且缺作者信息时视为通过），
   * 所以加上它不会误伤「[英] 阿加莎·克里斯蒂」这类写法差异。
   */
  if (titleSkeleton(candidate.title) === titleSkeleton(book.title) && authorMatches) return { reject: false };

  const titleMatches = cTitle === bTitle || cTitle.includes(bTitle) || bTitle.includes(cTitle);

  // 数字写法差异无法靠骨架完全覆盖（「19年间」vs「十九年间」），
  // 因此当书名里出现中文数词且作者匹配时，只要书名有包含关系就放行。
  const hasCjkNumeral = /[一二三四五六七八九十百千万零两]/.test(bTitle) || /[一二三四五六七八九十百千万零两]/.test(cTitle);
  if (hasCjkNumeral && authorMatches && titleMatches) return { reject: false };

  if (!titleMatches) return { reject: true, reason: `书名不匹配（候选《${candidate.title}》）` };

  // 标题是包含关系但长出很多，且作者对不上 → 极可能是另一本书
  const lengthGap = Math.abs(cTitle.length - bTitle.length);
  if (!authorMatches && lengthGap >= 3) {
    return {
      reject: true,
      reason: `疑似另一本书：候选《${candidate.title}》（${candidate.author}）与目标作者「${book.author}」不符`,
    };
  }

  if (!authorMatches) {
    return { reject: true, reason: `作者不匹配（候选作者「${candidate.author}」）` };
  }

  return { reject: false };
}

/**
 * 在检索结果里挑出可能的版本。
 * 优先标题精确匹配 + 作者匹配，其次包含关系，最后按年接近度。
 * **作者不匹配且标题差异明显的候选会被剔除**，避免张冠李戴。
 */
function rankCandidates(candidates, book) {
  const target = normalizeTitle(book.title);
  const authorKey = normalizeAuthor(book.author).slice(0, 2);
  const bookYear = Number(String(book.firstPublished).match(/\d{4}/)?.[0] ?? 0);

  const scored = [];
  const rejected = [];

  for (const candidate of candidates) {
    const verdict = looksLikeDifferentBook(candidate, book);
    if (verdict.reject) {
      rejected.push({ ...candidate, rejectReason: verdict.reason });
      continue;
    }

    const title = normalizeTitle(candidate.title);
    const candidateAuthor = normalizeAuthor(candidate.author);
    let score = 0;

    if (title === target) score += 100;
    else if (title.includes(target) || target.includes(title)) score += 50;

    if (authorKey && candidateAuthor.includes(authorKey)) score += 40;

    const candidateYear = Number(candidate.year ?? 0);
    if (bookYear && candidateYear && Math.abs(candidateYear - bookYear) <= 8) score += 10;

    scored.push({ ...candidate, score });
  }

  scored.sort((a, b) => b.score - a.score);
  scored.rejected = rejected;
  return scored;
}

/* ------------------------------------------------------------------ */
/* 主流程                                                              */
/* ------------------------------------------------------------------ */

async function main() {
  const startedAt = Date.now();
  console.log('');
  console.log(color('  豆瓣实时评分抓取', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));

  // 连通性预检
  process.stdout.write('  ▸ 连通性预检 … ');
  const probe = await get('https://book.douban.com/j/subject_suggest?q=%E6%8E%A8%E7%90%86', { json: true });
  if (!probe.ok) {
    console.log(color(`失败（HTTP ${probe.status}${probe.error ? ` / ${probe.error}` : ''}）`, C.red));
    console.log('');
    console.log(color('  无法访问豆瓣。可能原因：', C.yellow));
    console.log('    · 当前环境无外网');
    console.log('    · 豆瓣接口被限流或需要登录态');
    console.log('');
    console.log(color('  本次不修改任何数据文件。知识库中的离线估计值保持不变。', C.dim));
    console.log('');
    process.exit(1);
  }
  console.log(color('正常', C.green));
  console.log('');

  let books = await loadBooks();
  if (args.bookId) books = books.filter((b) => b.id === args.bookId);
  // 只补抓「还没有可追溯实时记录」的书——新增批次后不必重抓全库
  if (args.missing) {
    const atlas = await readExistingAtlas();
    const covered = new Set(atlas.filter((r) => r?.sourceUrl).map((r) => r.bookId ?? r.id));
    books = books.filter((b) => !covered.has(b.id));
    /**
     * 再扣掉「已知未命中」：它们的 `misses` 原因都是内容层面的
     * （检索无结果／只有外文原版条目／条目暂无评分），重试只是白花请求。
     * 要重试就显式传 `--retry-misses`。
     */
    if (args.skipKnownMisses) {
      const known = new Set((await readExistingMisses()).map((m) => m.id));
      const before = books.length;
      books = books.filter((b) => !known.has(b.id));
      if (before !== books.length) {
        console.log(
          `  ⓘ 已跳过图谱里记过的未命中 ${before - books.length} 部（原因都是内容层面的：豆瓣没有中文版条目等）；` +
            '要重试请加 --retry-misses',
        );
      }
    }
  }
  if (args.limit) books = books.slice(0, args.limit);

  if (!books.length) {
    console.log(color('  ! 没有需要处理的书籍', C.yellow));
    process.exit(0);
  }

  console.log(`  待抓取 ${books.length} 部，每本最多比较 ${args.candidates} 个版本`);
  console.log(`  请求间隔 ${args.delay} ms（预计约 ${Math.ceil((books.length * (args.candidates + 1) * args.delay) / 60000)} 分钟）`);
  console.log('');

  const records = [];
  const misses = [];
  const asOf = stampMonth();

  // **必须在写文件之前**读取既有图谱，否则合并模式会读到刚写好的内容而丢掉旧记录
  const existingRecords = args.merge ? await readExistingAtlas() : [];
  if (args.merge) {
    console.log(`  合并模式：已读取既有图谱 ${existingRecords.length} 条记录`);
    console.log('');
  }

  for (const [index, book] of books.entries()) {
    const label = `[${String(index + 1).padStart(3)}/${String(books.length)}]`;
    process.stdout.write(`  ${label} 《${book.title}》 `);

    // 1. 多策略检索：逐个关键词尝试，直到拿到候选
    let candidates = [];
    let usedQuery = null;
    const queries = withAliases(book, buildQueries(book));

    /**
     * 0. 人工钉住的条目优先。
     *
     * 豆瓣的 `subject_suggest` 不是全量索引：少数条目页存在、但用任何书名关键词
     * 都搜不到（《罪恶天使》即一例）。这类书若不钉住，就会**永远**停在
     * 「豆瓣检索无结果」，而真实原因是索引缺失。钉住后直取该条目，走的是同一条
     * 详情页解析与同一条来源可追溯性检查，取证强度与检索命中的记录完全一致。
     */
    const pin = pinFor(book.id);
    if (pin) {
      candidates = [
        {
          id: pin.subjectId,
          title: book.title,
          author: book.author,
          // 用**条目页上的**出版年，不能拿 firstPublished 回填——
          // 那等于把整理者自己的记录当成豆瓣著录，是自证而非取证（见 subject-pins.mjs）
          year: String(pin.editionYear ?? ''),
          url: `https://book.douban.com/subject/${pin.subjectId}/`,
        },
      ];
      usedQuery = `人工钉住 ${pin.subjectId}`;
    }

    for (const query of queries) {
      if (candidates.length) break;
      const search = await get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(query)}`, { json: true });
      if (!search.ok) {
        await sleep(args.delay);
        continue;
      }
      const found = rankCandidates(parseDoubanSuggest(search.body), book);
      if (found.length) {
        candidates = found.slice(0, args.candidates);
        usedQuery = query;
        break;
      }
      await sleep(args.delay);
    }

    if (!candidates.length) {
      console.log(color(`未检索到条目（尝试了 ${queries.length} 个关键词）`, C.yellow));
      misses.push({ book, reason: `豆瓣检索无结果（关键词：${queries.join(' / ')}）` });
      await sleep(args.delay);
      continue;
    }

    if (pin) {
      process.stdout.write(color(`[人工钉住条目 ${pin.subjectId}] `, C.dim));
    } else if (usedQuery !== book.title) {
      process.stdout.write(color(`[检索词「${usedQuery}」] `, C.dim));
    }

    await sleep(args.delay);

    // 2. 逐个抓详情页，挑选「达到成熟度门槛且评价人数最多」的版本
    const parsedEditions = [];
    const triedIds = new Set();
    /** 抓到过页面、但页面上根本没有评分的人数（区别于「页面结构变了」） */
    let pagesWithoutRating = 0;
    /**
     * 抓到过页面的候选里，**只有外文原版**的情况。
     *
     * 为什么必须单独区分：豆瓣的检索索引对不少日本作品只收日文原版条目
     * （例如「黒革の手帖」只返回 1983 年新潮社上下卷），而日文原版通常无人评分。
     * 这时报「豆瓣上尚无人评价」是**误导**——中文版可能有几百人评分，
     * 只是它的条目根本没进检索索引。分开记，才不会把索引缺失误当成
     * 「这本书没人读」，也才看得出该换检索词而不是放弃。
     */
    const seenEditions = [];

    /** 候选是否是外文（非中文）版本：标题含假名，或几乎全是拉丁字母/假名 */
    const isForeignEdition = (title) => {
      const t = String(title || '');
      if (!t) return false;
      if (/[\u3040-\u309f\u30a0-\u30ff]/.test(t)) return true; // 平假名/片假名
      const cjk = (t.match(/[\u4e00-\u9fff]/g) || []).length;
      const latin = (t.match(/[A-Za-z]/g) || []).length;
      return latin > 0 && cjk === 0;
    };

    /** 抓取一批候选的详情页 */
    const fetchEditions = async (list) => {
      for (const candidate of list) {
        if (triedIds.has(candidate.id)) continue;
        triedIds.add(candidate.id);
        seenEditions.push({ title: candidate.title, year: candidate.year, foreign: isForeignEdition(candidate.title) });
        const page = await get(candidate.url);
        if (!page.ok) {
          await sleep(args.delay);
          continue;
        }
        const parsed = parseDoubanSubject(page.body, {
          subjectId: candidate.id,
          sourceUrl: candidate.url,
          fetchedAt: new Date().toISOString(),
        });
        if (parsed) {
          parsedEditions.push({
            ...parsed,
            editionTitle: candidate.title,
            editionYear: candidate.year,
            editionAuthor: candidate.author,
          });
        } else if (/rating_num/.test(page.body)) {
          // 页面有评分容器却取不到分数 → 这本书在豆瓣确实还没人评价，
          // 不是解析器坏了。两者必须分清，否则豆瓣改版会被误当成「无人评价」而静默通过。
          pagesWithoutRating += 1;
        }
        await sleep(args.delay);
      }
    };

    await fetchEditions(candidates);

    // 若这一批里没有达到评价人数门槛的版本，扩大候选池再试一次
    // （豆瓣检索默认只返回前几条，通行版可能排在后面）
    const hasMature = () => parsedEditions.some((e) => (e.count ?? 0) >= args.minVotes);
    if (!hasMature() && usedQuery) {
      const wider = rankCandidates(
        parseDoubanSuggest(await get(`https://book.douban.com/j/subject_suggest?q=${encodeURIComponent(usedQuery)}`, true)),
        book,
      ).slice(0, 12);
      await sleep(args.delay);
      if (wider.length > triedIds.size) {
        process.stdout.write(color(`[扩大候选 ${String(wider.length)} 个] `, C.dim));
        await fetchEditions(wider);
      }
    }

    // 优先取达到评价人数门槛的版本；若全都不达标，退而取人数最多的那个并标注警告
    const mature = parsedEditions.filter((e) => (e.count ?? 0) >= args.minVotes);
    const pool = mature.length ? mature : parsedEditions;
    const best = pool.length ? pool.reduce((a, b) => ((b.count ?? 0) > (a.count ?? 0) ? b : a)) : null;
    const lowSample = best ? (best.count ?? 0) < args.minVotes : false;

    if (!best) {
      const foreignOnly = seenEditions.length > 0 && seenEditions.every((e) => e.foreign);
      if (foreignOnly) {
        const sample = seenEditions
          .slice(0, 3)
          .map((e) => `${e.title}${e.year ? `（${e.year}）` : ''}`)
          .join('、');
        console.log(color(`只找到外文原版条目（${sample}），中文版未进豆瓣检索索引`, C.yellow));
        misses.push({
          book,
          reason: `豆瓣只索引到外文原版条目（${sample}），未找到中文版评分；保持「暂无数据」`,
        });
      } else if (pagesWithoutRating > 0) {
        console.log(color('条目暂无评分（豆瓣上尚无人评价）', C.dim));
        misses.push({ book, reason: '豆瓣条目存在但尚无评分，保持「暂无数据」' });
      } else {
        console.log(color('详情页解析失败', C.yellow));
        misses.push({ book, reason: '详情页未解析出评分（可能被反爬或页面结构变化）' });
      }
      continue;
    }

    const previous = book.ratings?.douban?.score ?? null;
    const delta = typeof previous === 'number' ? Number((best.score - previous).toFixed(1)) : null;
    const deltaText =
      delta === null ? '' : delta === 0 ? color(' = 与离线估计一致', C.dim) : color(` Δ${delta > 0 ? '+' : ''}${delta}`, delta > 0 ? C.cyan : C.yellow);

    console.log(
      color(`${best.score} / ${best.count ?? '?'} 人`, C.bold) +
        color(`（${best.editionTitle} ${best.editionYear}）`, C.dim) +
        deltaText +
        (lowSample ? color('  ⚠ 评价人数偏少，样本不足', C.yellow) : ''),
    );

    records.push({
      id: book.id,
      title: book.title,
      author: book.author,
      platform: 'douban',
      score: best.score,
      count: best.count,
      scale: '10 分制',
      sourceUrl: best.sourceUrl,
      subjectId: best.subjectId,
      editionTitle: best.editionTitle,
      editionYear: best.editionYear,
      fetchedAt: best.fetchedAt,
      asOf,
      previousOfflineScore: previous,
      delta,
      lowSample,
      comparedEditions: parsedEditions.length,
      searchQuery: usedQuery,
    });
  }

  /* ---------------- 合并模式：保留既有记录 ---------------- */
  let merged = records;
  let keptFromPrevious = 0;
  if (args.merge) {
    const fresh = new Set(records.map((r) => `${r.id}::${r.platform}`));
    const kept = existingRecords.filter((r) => !fresh.has(`${r.id}::${r.platform}`));
    keptFromPrevious = kept.length;
    merged = [...kept, ...records].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  }

  /* ---------------- 合并模式：保留未被本轮探测的未命中原因 ---------------- */
  let mergedMisses = misses;
  if (args.merge) {
    const probed = new Set(books.map((b) => b.id));
    const covered = new Set(merged.filter((r) => r?.sourceUrl).map((r) => r.bookId ?? r.id));
    const carried = (await readExistingMisses())
      .filter((m) => m?.id && !probed.has(m.id) && !covered.has(m.id))
      .map((m) => ({ book: { id: m.id, title: m.title }, reason: m.reason }));
    mergedMisses = [...misses, ...carried];
  }

  /* ---------------- 写入前的兜底闸门 ---------------- */
  // 即使调用方忘了 --merge，也不允许一次抓取把图谱「改小」。
  // 图谱缩水只可能是两种情况：调用方式不对（定向抓取覆盖全量），
  // 或者库里的书被删了（那应当先用 rebuild-atlas 明确重建）。
  // 两种都不该由一次普通抓取静默完成。
  if (!args.merge && !args.rebuild) {
    const before = existingRecords.length;
    if (merged.length < before) {
      console.error('');
      console.error(
        `  ✗ 已终止写入：本轮得到 ${merged.length} 条记录，少于图谱中已有的 ${before} 条。`
      );
      console.error(
        '    只探测了一部分书籍时，请加 --merge（保留未探测的既有记录）；' +
          '确实要用本轮结果整体替换图谱，请加 --rebuild。'
      );
      console.error('    图谱未被修改。');
      console.error('');
      process.exit(1);
    }
  }

  /* ---------------- 写出图谱 ---------------- */
  const payload = {
    format: 'dftr-ratings-atlas',
    version: 1,
    platform: 'douban',
    scale: '10 分制',
    generatedAt: new Date().toISOString(),
    elapsedSeconds: Math.round((Date.now() - startedAt) / 1000),
    requestCount,
    note:
      '本文件为**实时抓取**的豆瓣公开评分与评价人数，每条记录都带 sourceUrl 与 fetchedAt，可逐条追溯。' +
      '仅读取评分与评价人数，未抓取任何书评正文，避免引入剧透。',
    recordCount: merged.length,
    missCount: mergedMisses.length,
    records: merged,
    misses: mergedMisses.map((m) => ({ id: m.book.id, title: m.book.title, reason: m.reason })),
  };

  await fs.mkdir(path.dirname(ATLAS), { recursive: true });
  await fs.writeFile(ATLAS, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  /* ---------------- 汇总 ---------------- */
  console.log('');
  console.log(color('  ────────────────────────────────────────────', C.dim));
  console.log(`  抓取成功   ${color(String(records.length), C.green + C.bold)} / ${books.length} 部`);
  console.log(`  抓取失败   ${misses.length ? color(String(misses.length), C.yellow) : '0'} 部`);
  if (args.merge) console.log(`  合并模式   保留图谱中已有的 ${keptFromPrevious} 条，图谱现共 ${merged.length} 条`);
  console.log(`  网络请求   ${requestCount} 次，用时 ${Math.round((Date.now() - startedAt) / 1000)} 秒`);

  if (records.length) {
    const changed = records.filter((r) => r.delta !== null && r.delta !== 0);
    const avgAbs = changed.length
      ? (changed.reduce((sum, r) => sum + Math.abs(r.delta), 0) / changed.length).toFixed(2)
      : '0';
    const big = records.filter((r) => r.delta !== null && Math.abs(r.delta) >= 0.8);
    console.log(`  与离线估计   ${changed.length} 条不同，平均偏差 ${avgAbs} 分`);
    if (big.length) {
      console.log('');
      console.log(color(`  ! 偏差最大的 ${Math.min(big.length, 15)} 条（离线估计明显不准）`, C.yellow));
      for (const r of big.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta)).slice(0, 15)) {
        console.log(`    《${r.title}》 离线 ${r.previousOfflineScore} → 实时 ${r.score}（Δ${r.delta > 0 ? '+' : ''}${r.delta}）`);
      }
    }
  }

  if (misses.length) {
    console.log('');
    console.log(color('  未抓到的条目（保持原值，不做任何修改）', C.dim));
    for (const m of misses.slice(0, 20)) console.log(`    《${m.book.title}》—— ${m.reason}`);
    if (misses.length > 20) console.log(color(`    … 另有 ${misses.length - 20} 条`, C.dim));
  }
  if (mergedMisses.length > misses.length) {
    console.log(
      color(
        `    （图谱中累计未命中 ${mergedMisses.length} 部，含上一轮 ${mergedMisses.length - misses.length} 部未重测的）`,
        C.dim,
      ),
    );
  }

  console.log('');
  console.log(`  已写出 ${color('data/ratings-atlas.json', C.cyan)}`);
  console.log('');
  console.log(color('  下一步：', C.bold));
  console.log('    1) node scripts/verify-ratings.mjs     复核来源可追溯性与量纲');
  console.log('    2) node scripts/apply-ratings.mjs      把实时数据写回知识库（--apply 生效）');
  console.log('');
}

/**
 * 仅在**直接运行**本脚本时执行抓取。
 *
 * 这一点很重要：本模块导出了 buildQueries / looksLikeDifferentBook /
 * normalizeTitle / normalizeAuthor 等纯函数供单元测试使用。
 * 若不加这层判断，测试一 import 就会触发整轮全量抓取
 * （真实踩过的坑：单元测试卡住 3 分钟，实际是在抓 165 本书）。
 */
const isDirectRun = (() => {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return path.resolve(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
})();

if (isDirectRun) {
  main().catch((error) => {
    console.error(color(`\n✗ 抓取脚本异常：${error.stack ?? error.message}\n`, C.red));
    process.exit(1);
  });
}
