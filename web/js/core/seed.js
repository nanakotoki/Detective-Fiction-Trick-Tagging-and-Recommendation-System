/**
 * 种子知识库加载器
 * ================
 * 知识库按批次拆分为多个文件（便于多人协作与代码审查），此处统一合并、去重、排序。
 *
 * 新增数据只需把 JSON 放进 `data/books/`，然后运行：
 *     npm run gen:seed
 * 即可自动登记（该命令已集成进 npm run build 与 npm run check）。
 *
 * 为什么需要一份自动生成的文件清单：浏览器端必须用**静态** import 才能加载
 * JSON（动态拼接的路径无法被静态托管与打包器正确处理），所以清单无法在运行时生成。
 */

import { SEED_FILES } from './seed-files.js';
import { isSchoolTag } from './tags.js';

export { SEED_FILES };

/**
 * 把混进 `tags` 里的流派标签拆出来。
 *
 * 流派是与诡计正交的第二维度，规范上只能存在 `school`/`schoolTags` 字段。
 * 但用户在网页表单、批量导入、或手改 JSON 时很容易把两者写进同一个数组。
 * 这里做一次自愈：无论调用方怎么写，`tags` 里都不会残留流派 id。
 *
 * 不这样做的话，`check-data.mjs` 的标签覆盖统计、`manage.js` 的编辑回填
 * 都会因为两个维度的数据混在一起而给出错误结果。
 *
 * @param {string[]} ids
 * @returns {{tags: string[], school: string[]}}
 */
export function splitSchoolTags(ids) {
  const tags = [];
  const school = [];
  for (const id of ids) {
    if (typeof id !== 'string' || !id) continue;
    (isSchoolTag(id) ? school : tags).push(id);
  }
  return { tags, school };
}

/**
 * 把「作者」字段里的一串名字拆成数组。
 *
 * 背景：知识库原先是**单一作者模型**（`author` 一个字符串，全库含分隔符的条目为 0）。
 * 但一批已核实是推理小说的作品是两三个人合著的（《失踪的消防车》是舍瓦尔与瓦勒夫妇合写、
 * 《死亡的样板》是博尔赫斯与比奥伊·卡萨雷斯合写、福尔摩斯探案续集是两两合著），
 * 还有一批是十几位作家的合集。为它们扩出 `authors` 数组后，仍需一个统一入口：
 * 无论调用方写 `author: '舍瓦尔、瓦勒'` 还是 `authors: ['舍瓦尔','瓦勒']`，结果都要一致。
 *
 * ⚠️ **只按「、，,;；」拆，绝不按「·」拆**——后者是西方人名的组成部分
 * （阿加莎·克里斯蒂、约翰·迪克森·卡尔、G·K·切斯特顿），拆了就全毁了。
 *
 * @param {string} value
 * @returns {string[]}
 */
export function splitAuthors(value) {
  return String(value ?? '')
    .split(/[、,，;；]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * 取一本书的**全部署名作者**。
 * 老数据只有 `author`（单作者），新数据有 `authors` 数组，这里统一成数组给
 * 统计、推荐与作者多样性约束使用。**不要**在别处直接读 `book.author` 做聚合。
 *
 * @param {object} book
 * @returns {string[]}
 */
export function authorListOf(book) {
  if (!book) return [];
  if (Array.isArray(book.authors) && book.authors.length) return book.authors;
  const fallback = String(book.author ?? '').trim();
  return fallback ? [fallback] : [];
}

/**
 * 两本书是否有**共同署名作者**（推荐算法的「同作者」加成与推荐理由都据此判断）。
 * 用交集而非字符串相等：合著作品与其中任一作者的独著之间也算同作者。
 *
 * @param {object} a
 * @param {object} b
 * @returns {string} 共同作者名；没有则返回空字符串
 */
export function sharedAuthor(a, b) {
  const left = authorListOf(a);
  if (!left.length) return '';
  const right = new Set(authorListOf(b));
  for (const name of left) if (right.has(name)) return name;
  return '';
}

/**
 * 多人协作标记：给一部作品算出「合著 / 合集」的展示文案。
 *
 * 用途只有一个——**在界面上醒目地告诉读者「这本不是一个人写的」**。
 * 它**不参与**统计与推荐：用户已明确「选集也算作个人作品」，
 * 所以作者榜与「同作者」推荐照旧按 `authorListOf()` 的每位署名者计入
 * （见 docs/collection-backlog.md §34）。
 *
 * 两种情形的区分靠 `anthology` 字段（数据层显式标注），而不是靠猜作者个数：
 *   · `anthology: true` —— **多人合集**（十几位作家各写一篇，或编者牵头结集）
 *   · 未标 `anthology` 而署名 ≥2 —— **合著**（两三个人一起写完整本书）
 * 因为「两个人合写一本长篇」和「十二个人各写一个短篇」在读者眼里是两回事，
 * 前者值得按正常作品看待，后者需要提醒「你买的是一本选集」。
 *
 * @param {object} book
 * @returns {{kind:'coauthor'|'anthology', text:string, detail:string}|null}
 */
export function collabLabel(book) {
  if (!book) return null;
  const names = authorListOf(book);
  const isAnthology = book.anthology === true;
  if (!isAnthology && names.length < 2) return null;
  const count = names.length;
  if (isAnthology) {
    return {
      kind: 'anthology',
      text: '合集',
      // 馆藏常常只列一位领衔作者，所以这里只报「已登记」的数量，不谎称就是全部。
      // 只登记一位时要说清楚，否则读者会以为这本书就是那一个人写的。
      detail:
        count >= 2
          ? `多人合集：已登记 ${count} 位作者`
          : '多人合集：馆藏仅登记 1 位领衔作者，其余作者未列名',
    };
  }
  return {
    kind: 'coauthor',
    text: `合著 · ${count} 位`,
    detail: `由 ${names.join('、')} 共同创作`,
  };
}

/**
 * 合并全部种子数据。
 * @returns {Array<object>}
 */
export function loadSeedBooks() {
  const seen = new Set();
  const seenTitles = new Map();
  const books = [];

  for (const { file, group, data } of SEED_FILES) {
    const list = Array.isArray(data) ? data : [];
    for (const raw of list) {
      const book = normalizeSeedBook(raw, group, file);
      if (!book) continue;

      // 同一 id 重复：跳过后者
      if (seen.has(book.id)) {
        console.warn(`[seed] 重复的书籍 id：${book.id}（来自 ${file}），已跳过`);
        continue;
      }

      // 同一本书（书名 + 作者）出现在多个批次：保留先出现的，避免书架上出现两张同书卡片
      const key = `${book.title}||${book.author}`;
      if (seenTitles.has(key)) {
        console.warn(
          `[seed] 重复的书目：《${book.title}》— ${book.author}（${seenTitles.get(key)} 与 ${file}/${book.id}），已保留前者`,
        );
        continue;
      }

      seen.add(book.id);
      seenTitles.set(key, `${file}/${book.id}`);
      books.push(book);
    }
  }

  return books;
}

/**
 * 流派归一化
 * ==========
 * 多人协作整理时流派写法很容易发散（「社会派」「社会派推理」「社会派推理小说」
 * 其实是同一类），而流派会同时影响：
 *   - 知识库的流派筛选下拉框
 *   - 推荐算法里的「同流派 +0.02」加成
 * 因此这里统一归一到一个受控词表，原始写法保留在 genreDetail 里供展示。
 *
 * ⚠️ 词表顺序即匹配优先级，**必须从具体到宽泛**：
 *    「新本格」要排在「本格推理」之前，否则 `includes('本格')` 会先把新本格吞掉。
 */
export const GENRE_VOCABULARY = [
  { id: '新本格', label: '新本格', patterns: ['新本格'] },
  { id: '本格推理', label: '本格推理', patterns: ['本格推理', '古典本格', '不可能犯罪', '密室', '本格'] },
  { id: '社会派', label: '社会派', patterns: ['社会派', '社会议题'] },
  { id: '硬汉派', label: '硬汉派', patterns: ['硬汉', '冷硬', '私家侦探'] },
  { id: '变格', label: '变格', patterns: ['变格', '怪奇'] },
  { id: '青春推理', label: '青春推理', patterns: ['青春', '少年'] },
  { id: '历史推理', label: '历史推理', patterns: ['历史'] },
  { id: '间谍小说', label: '间谍小说', patterns: ['间谍', '谍战', '谍报'] },
  { id: '恐怖', label: '恐怖', patterns: ['恐怖', '怪谈'] },
  { id: '日常之谜', label: '日常之谜', patterns: ['日常之谜', '日常推理', '轻推理', '幽默推理', '温情'] },
  { id: '犯罪悬疑', label: '犯罪悬疑', patterns: ['犯罪', '悬疑', '惊悚', '心理罪', '心理'] },
  { id: '冒险悬疑', label: '冒险悬疑', patterns: ['冒险', '探险'] },
];

/** 受控流派词表（供界面下拉框使用） */
export const GENRE_OPTIONS = GENRE_VOCABULARY.map((g) => g.label);

/** 受控值的集合，用于"已经是标准值就不再改"的快速判定 */
const GENRE_LABEL_SET = new Set(GENRE_OPTIONS);

/**
 * 系列名归一化
 * ============
 * 多人协作整理时系列名会有三类偏差：
 *   1. 职责/头衔写法不同：「亨利·梅利维尔爵士系列」「亨利·梅利维尔系列」是同一位侦探
 *   2. 译名用字不同：「菲洛·凡斯」「菲洛·万斯」「马普尔」「玛普尔」
 *   3. 非系列作品的占位写法五花八门：「非系列」「独立作（非系列）」「独立作（非菲尔博士系列）」
 *
 * 系列名会影响 `recommend()` 里的「同一系列不推荐续作」判断，
 * 写法不统一就会漏判（把同一系列的续作当成不同系列推给读者）。
 *
 * 归一化策略：
 *   - 显式的别名映射表处理译名差异
 *   - 去掉「系列」后缀与头衔词再比对，命中则统一到规范名
 *   - 非系列一律归一为空字符串（语义上更准确，展示层再渲染成「非系列作品」）
 */

/** 非系列作品的写法 → 空字符串 */
const NON_SERIES_PATTERN = /^(非系列|独立作|独立作品|无系列|单本|非系列作品|独立长篇)/;

/**
 * 系列别名（**键必须是 seriesKey() 的输出**，即已去掉标点、头衔与「系列」后缀的形式）。
 *
 * ⚠️ 这里的键容易写错：`seriesKey('马普尔小姐系列')` 会把「小姐」也去掉得到 `马普尔`，
 * 因此键要写 `马普尔` 而不是 `马普尔小姐`。改动本表后请运行 `npm test`
 * （test-core.mjs 里有针对每一组译名差异的断言）。
 */
const SERIES_ALIASES = {
  '菲洛凡斯': '菲洛·凡斯系列',
  '菲洛万斯': '菲洛·凡斯系列',
  '马普尔': '玛普尔小姐系列',
  '玛普尔': '玛普尔小姐系列',
  '亨利梅利维尔': '亨利·梅利维尔爵士系列',
  '梅利维尔': '亨利·梅利维尔爵士系列',
  '赫尔克里波洛': '赫尔克里·波洛系列',
  '波洛': '赫尔克里·波洛系列',
  '埃勒里奎因': '埃勒里·奎因系列',
  '奎因': '埃勒里·奎因系列',
  '哈利霍尔': '哈利·霍勒系列',
  '哈利霍勒': '哈利·霍勒系列',
  '罗飞': '刑警罗飞系列',
};

/** 归一化时要去掉的修饰词 */
const SERIES_NOISE = /(系列|探长|警部|爵士|修士|小姐|大师|侦探|事务所)/g;

/** 归一化系列名，用于比对 */
function seriesKey(text) {
  return String(text ?? '')
    .replace(/[（(].*?[)）]/g, '')
    .replace(/[\s·・.。、,，:：\-—]/g, '')
    .replace(SERIES_NOISE, '')
    .toLowerCase();
}

/**
 * 把任意系列写法归一到规范名。
 * @param {string} raw
 * @returns {string} 规范系列名；非系列作品返回空字符串
 */
export function canonicalSeries(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  if (NON_SERIES_PATTERN.test(text)) return '';

  const key = seriesKey(text);
  if (!key) return '';

  if (SERIES_ALIASES[key]) return SERIES_ALIASES[key];

  // 用别名表的键做一次包含匹配，处理「苏珊·赖兰系列（苏珊·赖兰）」这类写法
  for (const [alias, canonical] of Object.entries(SERIES_ALIASES)) {
    if (key === alias || (alias.length >= 3 && key.includes(alias))) return canonical;
  }

  return text;
}

/** 是否为同一系列（推荐算法用） */
export function sameSeries(a, b) {
  const ka = seriesKey(canonicalSeries(a));
  const kb = seriesKey(canonicalSeries(b));
  if (!ka || !kb) return false;
  return ka === kb || (ka.length > 1 && (ka.includes(kb) || kb.includes(ka)));
}

/**
 * 把任意流派写法归一到受控词表。
 * @param {string} raw
 * @returns {string} 命中则返回标准流派；无法判定时返回 '其他'
 */
export function canonicalGenre(raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '其他';

  // 已经是受控值就直接返回。
  // 这比"把词表顺序排对"更根本：否则「冒险悬疑」会因为包含「悬疑」
  // 被更靠前的「犯罪悬疑」抢先命中，自己反被改掉（真实踩过的坑）。
  if (GENRE_LABEL_SET.has(text)) return text;

  // 全角括号内容先剥掉，避免「本格推理（不可能犯罪）」这类写法干扰
  const bare = text.replace(/[（(].*?[)）]/g, '').trim() || text;
  const lower = bare.toLowerCase();

  // 严格按词表顺序匹配：先精确相等，再包含。顺序即优先级（从具体到宽泛）。
  for (const entry of GENRE_VOCABULARY) {
    for (const pattern of entry.patterns) {
      if (lower === pattern.toLowerCase()) return entry.label;
    }
  }
  for (const entry of GENRE_VOCABULARY) {
    for (const pattern of entry.patterns) {
      if (lower.includes(pattern.toLowerCase())) return entry.label;
    }
  }
  return '其他';
}

/** 规范化单条种子数据，保证前端拿到的结构统一 */
export function normalizeSeedBook(raw, group = null, file = null) {
  if (!raw || typeof raw !== 'object') return null;
  const id = String(raw.id ?? '').trim();
  const title = String(raw.title ?? '').trim();
  if (!id || !title) return null;

  const rawGenre = String(raw.genre ?? '').trim();

  // 两个正交维度分开存放；混写在 tags 里的流派 id 会被搬回 schoolTags（自愈）
  const split = splitSchoolTags(Array.isArray(raw.tags) ? [...new Set(raw.tags)] : []);
  const tagIds = split.tags;
  /**
   * ⚠️ 必须同时接受 `school`（原始写入形状）与 `schoolTags`（本函数自己的输出形状）。
   *
   * 本函数不只用于读取种子 JSON，服务端 getUserBooks、store 的导入/保存都会把
   * **已经规范化过的对象**再喂进来一次。只认 `school` 的话，第二次规范化的结果
   * 就是 schoolTags: []，等于每次读取都把流派标注抹掉——用户新建的作品一旦
   * 重新拉取就丢失全部流派，且没有任何报错。
   * 因此这里保证幂等：normalize(normalize(x)) === normalize(x)。
   */
  const rawSchool = Array.isArray(raw.school) ? raw.school : Array.isArray(raw.schoolTags) ? raw.schoolTags : [];
  const schoolIds = [...new Set([...rawSchool, ...split.school])].filter(isSchoolTag);

  /**
   * 作者：`authors` 是权威的署名作者列表，`author` 是展示标签。
   *
   * 显式给了 `authors` 数组就**以它为准**，此时 `author` 允许写成简写标签
   * （合集常见的「江户川乱步 等」——这种写法拆分出来会带上「等」字，
   * 所以不能拿 `author` 去反推列表）。
   * 只给了 `author` 字符串时，按「、，,;；」拆成列表，这条路径同时充当
   * **老数据的自愈**：万一有人把 `author` 写成「舍瓦尔、瓦勒」，聚合也不会被污染。
   */
  const explicitAuthors = Array.isArray(raw.authors)
    ? [...new Set(raw.authors.map((s) => String(s ?? '').trim()).filter(Boolean))]
    : [];
  const authorLabel = String(raw.author ?? '').trim();
  const listed = explicitAuthors.length ? explicitAuthors : [...new Set(splitAuthors(authorLabel))];
  const author = authorLabel || listed.join('、') || '佚名';
  /**
   * ⚠️ `authors` **永不为空数组**：连作者都没写的条目要落到 `['佚名']`。
   * 否则第一遍规范化得到 `authors: []`、第二遍从 `author: '佚名'` 又拆出 `['佚名']`，
   * 幂等性就断了——而本函数确实会被喂进已规范化的对象（服务端 getUserBooks、
   * store 的导入/保存）。这条是被 test-core 的幂等用例抓出来的。
   */
  const authors = listed.length ? listed : [author];

  return {
    id,
    title,
    /**
     * 又名：同一部作品的其他中文译名（大陆版/台版/旧译）。
     * 合并重复条目时，落选那一版的书名保留在这里，搜索会一并命中，
     * 详情页也会展示——否则用旧译名来查的读者会以为库里没有这本书。
     * 与 normalizeSeedBook 的其余字段一样保持幂等。
     */
    alternateTitles: Array.isArray(raw.alternateTitles)
      ? [...new Set(raw.alternateTitles.map((t) => String(t ?? '').trim()).filter(Boolean))]
      : [],
    originalTitle: raw.originalTitle ?? '',
    /**
     * `author` 是**展示用的作者标签**（列表、排序、搜索、报告都读它），
     * `authors` 才是**统计用的署名作者列表**——这是一个刻意分开的两个字段：
     *
     *   · 单作者：`author === '阿加莎·克里斯蒂'`，`authors === ['阿加莎·克里斯蒂']`
     *   · 合著　：`author === '马伊·舍瓦尔、佩尔·瓦勒'`，`authors === ['马伊·舍瓦尔','佩尔·瓦勒']`
     *   · 合集　：`author === '江户川乱步 等'`（标签可以是「等」这种简写），
     *            `authors` 仍是完整的 11 位署名作者
     *
     * 为什么不让聚合逻辑去读 `author`：那样「马伊·舍瓦尔、佩尔·瓦勒」会被当成
     * **一个叫这两个名字的第三人**——作者榜上多一个只有 1 本书的伪作者，
     * 而真正的舍瓦尔与瓦勒各自都少了这一本，推荐里的「同作者」也会同时错三处。
     * 聚合（作者统计、同作者加成、作者多样性上限）一律走 `authorListOf()`。
     *
     * 幂等性与 schoolTags 同理：本函数会被喂进**已经规范化过的对象**。
     */
    author,
    authors,
    /**
     * 多人合集标记（纯展示用）。
     * 用户裁决「选集也算作个人作品」，所以它**不改变统计口径**；
     * 只用来在界面上打一个醒目的「合集」徽章，让读者一眼看出这本不是一个人写的。
     * 与 `authors` 一样保持幂等。
     */
    anthology: raw.anthology === true,
    authorEn: raw.authorEn ?? '',
    genre: canonicalGenre(rawGenre),
    genreDetail: rawGenre,
    /**
     * 两个「年」字段，语义必须分开（2026-09 决定，见 docs/collection-backlog.md 第十一节）：
     *   · `firstPublished` —— **作品首次出版年**（原作年）。查得到就填，查不到留空。
     *   · `editionYear`    —— **本库所引版本的出版年**（通常是中译本的出版年）。有来源可核验。
     * 此前一个字段同时承担两件事，导致「按年代排序」把同一套书劈成两半，
     * 也让「首次出版」这一栏显示的其实是版本年。
     */
    firstPublished: raw.firstPublished ?? '',
    editionYear: raw.editionYear ?? '',
    series: canonicalSeries(raw.series),
    seriesDetail: String(raw.series ?? '').trim(),
    detective: raw.detective ?? '',
    country: raw.country ?? '',
    tags: tagIds,
    /**
     * 推理流派（第二维度，独立字段）。
     * 与 tags 分开存放的原因：流派是"写法取向"，与"有哪些诡计"正交，
     * 混在一个数组里会让报告的第二部分（诡计标签）与流派混在一起难以区分。
     * bookTagIds() 会把两者合并参与推荐计算。
     *
     * 合并 `tags` 里被误写的流派 id（见上方 splitSchoolTags），做一次自愈。
     */
    schoolTags: schoolIds,
    customTags: Array.isArray(raw.customTags) ? raw.customTags : [],
    safeSummary: raw.safeSummary ?? '',
    recommendationReason: raw.recommendationReason ?? '',
    ratings: raw.ratings ?? {},
    readingTips: {
      suitableFor: raw.readingTips?.suitableFor ?? [],
      watchFor: raw.readingTips?.watchFor ?? [],
      warning: raw.readingTips?.warning ?? '',
    },
    editorialNote: raw.editorialNote ?? '',
    vault: {
      culprit: raw.vault?.culprit ?? '',
      coreTrick: raw.vault?.coreTrick ?? '',
      ending: raw.vault?.ending ?? '',
      notes: raw.vault?.notes ?? '',
    },
    origin: raw.origin ?? 'seed',
    group,
    seedFile: file,
    recommendable: raw.recommendable !== false,
    verification: raw.verification ?? { verified: false },
    provenance: raw.provenance ?? {
      source: file ?? 'bundled',
      ratingsNote: '评分与摘要为整理时采集，标注为「暂无数据」表示未采集到可靠公开数据。',
    },
    createdAt: raw.createdAt ?? null,
    updatedAt: raw.updatedAt ?? null,
  };
}

/** 统计信息 */
export function seedStats(books) {
  const byGroup = new Map();
  for (const b of books) {
    const key = b.group ?? '未分组';
    byGroup.set(key, (byGroup.get(key) ?? 0) + 1);
  }
  return {
    total: books.length,
    byGroup: [...byGroup.entries()].map(([group, count]) => ({ group, count })),
  };
}
