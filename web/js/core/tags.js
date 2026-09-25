/**
 * 标签体系字典 —— 全站标签的唯一事实来源（single source of truth）
 *
 * 需求文档《知识库标签体系》共四大类：
 *   诡计类 / 叙事类 / 场景类 / 动机类
 * 在此基础上系统额外扩展了「氛围题材类」（theme），用于风格相似度兜底；
 * 该类别权重最低，不会影响「诡计类优先」的推荐逻辑。
 *
 * 权重说明（见 engine.js）：
 *   trick 3.0 > narrative 1.6 > scene 1.0 = motive 1.0 > theme 0.5
 */

/** 标签类别元信息 */
export const TAG_CATEGORIES = [
  {
    id: 'trick',
    label: '诡计类',
    en: 'Trick',
    weight: 3.0,
    specOrder: 1,
    description: '诡计机制层面的标签，是推荐匹配的第一优先级。只描述"存在哪一类诡计"，不描述诡计内容。',
  },
  {
    id: 'narrative',
    label: '叙事类',
    en: 'Narrative',
    weight: 1.6,
    specOrder: 2,
    description: '叙述结构与人称视角层面的标签，第二优先级。',
  },
  {
    id: 'scene',
    label: '场景类',
    en: 'Scene',
    weight: 1.0,
    specOrder: 3,
    description: '故事发生的物理空间与地理环境，第三优先级。',
  },
  {
    id: 'motive',
    label: '动机类',
    en: 'Motive',
    weight: 1.0,
    specOrder: 4,
    description: '动机类型，只标类型，不说明具体是谁。',
  },
  {
    id: 'theme',
    label: '氛围题材类',
    en: 'Theme',
    weight: 0.5,
    specOrder: 5,
    description: '风格、题材与情绪基调，仅在诡计标签不足时作为兜底信号。',
  },
  {
    id: 'school',
    label: '推理流派',
    en: 'School',
    weight: 1.4,
    specOrder: 6,
    description:
      '作品属于哪一路推理写法（逻辑流 / 诡计流 / 法庭派 / 硬汉派 / 刑侦派 …）。' +
      '与「诡计类」是两个维度：社会派作品同样可以有密室，因此单独成类。' +
      '权重高于场景与题材，用于在诡计类型相近时进一步区分叙事取向。',
  },
];

/** 类别 id -> 元信息 */
export const CATEGORY_MAP = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c]));

/** 类别展示顺序 */
export const CATEGORY_ORDER = TAG_CATEGORIES.map((c) => c.id);

/**
 * 标签全量定义。
 * id      : ASCII 稳定标识（数据文件、URL、代码里用它，永不变更）
 * label   : 中文展示名（输出 Markdown 时用反引号包裹）
 * category: 所属类别
 * spec    : 是否来自需求文档明确列出的标签（false 表示系统扩展标签）
 * desc    : 无剧透释义，用于标签体系页与 tooltip
 * aliases : 录入时的容错别名
 */
export const TAGS = [
  // ── 诡计类 ────────────────────────────────────────────────────────────
  {
    id: 'locked-room',
    label: '密室',
    category: 'trick',
    spec: true,
    desc: '在（看似）完全封闭、无法进出的空间内发生案件，围绕"如何进出/如何形成"构成谜团。',
    aliases: ['密室杀人', '不可能犯罪', '封闭空间'],
  },
  {
    id: 'alibi',
    label: '不在场证明',
    category: 'trick',
    spec: true,
    desc: '以时间或空间上的"不在现场"作为核心谜团，重点在于证明是如何被构造出来的。',
    aliases: ['不在场证明诡计', 'alibi'],
  },
  {
    id: 'narrative-trick',
    label: '叙述性诡计',
    category: 'trick',
    spec: true,
    desc: '利用叙述行为本身（人称、视角、信息取舍）构成的诡计，读者与叙述者的认知存在落差。',
    aliases: ['叙述诡计', '叙述性'],
  },
  {
    id: 'timetable',
    label: '时刻表诡计',
    category: 'trick',
    spec: true,
    desc: '以交通工具时刻、行程表、时间刻度为骨架构建的诡计，精密的"时间表"往往本身就是谜面。',
    aliases: ['时刻表', '列车时刻表'],
  },
  {
    id: 'faceless-corpse',
    label: '无面尸',
    category: 'trick',
    spec: true,
    desc: '尸体面部或身份标识被破坏、无法辨认，围绕"这具尸体究竟是谁"构成谜团。',
    aliases: ['无脸尸', '身份不明尸体'],
  },
  {
    id: 'vanished-weapon',
    label: '凶器消失',
    category: 'trick',
    spec: true,
    desc: '凶器在案发后消失或无法寻获，核心谜团是凶器去向与形态。',
    aliases: ['消失的凶器', '凶器消失'],
  },
  {
    id: 'closed-circle',
    label: '暴风雪山庄',
    category: 'trick',
    spec: true,
    desc: '因暴风雪、断桥、孤岛等原因与外界隔绝的封闭舞台，人物无法离开，案件连续发生。',
    aliases: ['封闭山庄', '孤岛模式', '封闭环境'],
  },
  {
    id: 'multiple-solutions',
    label: '多重解答',
    category: 'trick',
    spec: true,
    desc: '针对同一谜团给出两种以上彼此冲突的推理版本，以推翻与重建推动情节。',
    aliases: ['多重推理', '伪解答'],
  },
  {
    id: 'psychological-misdirection',
    label: '心理误导',
    category: 'trick',
    spec: true,
    desc: '通过引导读者形成特定心理预设来完成误导，重点在"诱导你以为"而非物理手法。',
    aliases: ['心理盲点', '心理陷阱'],
  },
  {
    id: 'red-herring',
    label: '红鲱鱼',
    category: 'trick',
    spec: true,
    desc: '刻意安放、指向错误方向的线索或人物，用于牵引侦查与阅读的重心。',
    aliases: ['误导线索', '烟雾弹'],
  },
  {
    id: 'swap-murder',
    label: '交换杀人',
    category: 'trick',
    spec: true,
    desc: '两名以上当事人互相为对方实施加害，以切断动机与行为之间的直接关联。',
    aliases: ['交换杀人计划', '互杀'],
  },
  {
    id: 'nursery-rhyme',
    label: '童谣杀人',
    category: 'trick',
    spec: true,
    desc: '案件依照童谣、诗句、预言或某种既定序列逐一发生，形式本身构成谜团。',
    aliases: ['童谣', '预言杀人', '模仿杀人'],
  },
  {
    id: 'cipher',
    label: '暗号密码',
    category: 'trick',
    spec: true,
    desc: '以密码、暗号、隐写或符号系统为核心谜团，破译过程构成主要推理线。',
    aliases: ['密码', '暗号', '密码诡计'],
  },
  {
    id: 'dual-role',
    label: '一人二角',
    category: 'trick',
    spec: true,
    desc: '同一人物在故事中以两个身份出现（或两个身份被误认为两人），身份关系构成谜团。',
    aliases: ['一人分饰两角', '双重身份'],
  },

  // ── 叙事类 ────────────────────────────────────────────────────────────
  {
    id: 'first-person',
    label: '第一人称',
    category: 'narrative',
    spec: true,
    desc: '以"我"的视角展开叙述。',
    aliases: ['第一人称叙述', '我视角'],
  },
  {
    // 补这个标签的由来：此前写批次时两次想标「第二人称」，词表里只有 first-person，
    // 于是被闸门拦下。第二人称是推理里很有效的一种人称安排（读者被当成「你」，
    // 天然产生认知不可靠），与第一人称对称，值得单列而不是硬塞进别的标签。
    id: 'second-person',
    label: '第二人称',
    category: 'narrative',
    spec: true,
    desc: '以"你"称呼读者或主角展开叙述，读者被置于当事人的位置。',
    aliases: ['第二人称叙述', '你视角'],
  },
  {
    id: 'dual-line',
    label: '双线',
    category: 'narrative',
    spec: true,
    desc: '两条时间线或视角线并行推进，在特定节点交汇。',
    aliases: ['双线叙事', '两条线'],
  },
  {
    id: 'nonlinear',
    label: '非线性',
    category: 'narrative',
    spec: true,
    desc: '时间顺序被有意打乱，由读者自行重组事件次序。',
    aliases: ['非线性叙事', '时间跳跃'],
  },
  {
    id: 'ensemble',
    label: '群像',
    category: 'narrative',
    spec: true,
    desc: '多人物视角轮转，没有单一绝对主视角。',
    aliases: ['群像视角', '多视角'],
  },
  {
    id: 'diary-form',
    label: '日记体',
    category: 'narrative',
    spec: true,
    desc: '以日记、手记、书信、档案等文本材料为主要叙述载体。',
    aliases: ['手记体', '书信体', '档案体'],
  },
  {
    id: 'reverse-chronology',
    label: '倒叙',
    category: 'narrative',
    spec: true,
    desc: '从结果或较晚的时间点起笔，再回溯过程。',
    aliases: ['倒叙结构', '逆时序'],
  },
  {
    id: 'unreliable-narrator',
    label: '不可靠叙述者',
    category: 'narrative',
    spec: true,
    desc: '叙述者的陈述本身存在偏差、隐瞒或认知局限，需要读者对其保持警觉。',
    aliases: ['不可靠叙述', '叙述者不可信'],
  },

  // ── 场景类 ────────────────────────────────────────────────────────────
  {
    id: 'isolated-island',
    label: '孤岛',
    category: 'scene',
    spec: true,
    desc: '被海、湖或无人区包围的孤立陆地舞台。',
    aliases: ['海岛', '孤岛舞台'],
  },
  {
    id: 'mansion',
    label: '洋馆',
    category: 'scene',
    spec: true,
    desc: '西式宅邸、别墅或豪门大宅构成的舞台。',
    aliases: ['别墅', '宅邸', '公馆'],
  },
  {
    id: 'train',
    label: '列车',
    category: 'scene',
    spec: true,
    desc: '行驶中的列车（含豪华卧铺、新干线等）构成的移动舞台。',
    aliases: ['火车', '铁道'],
  },
  {
    id: 'campus',
    label: '校园',
    category: 'scene',
    spec: true,
    desc: '学校、大学或社团构成的舞台。',
    aliases: ['学校', '学园'],
  },
  {
    id: 'hospital',
    label: '医院',
    category: 'scene',
    spec: true,
    desc: '医院、疗养院、精神病院等医疗场所构成的舞台。',
    aliases: ['疗养院', '医疗设施'],
  },
  {
    id: 'countryside',
    label: '乡村',
    category: 'scene',
    spec: true,
    desc: '村庄、小镇、山村等相对封闭的乡野舞台。',
    aliases: ['村庄', '小镇', '山村'],
  },
  {
    id: 'city',
    label: '都市',
    category: 'scene',
    spec: true,
    desc: '现代大城市构成的舞台。',
    aliases: ['城市', '现代都市'],
  },
  {
    id: 'snowfield',
    label: '雪原',
    category: 'scene',
    spec: true,
    desc: '雪地、严寒地带或冬季环境构成的舞台（脚印、积雪常成为谜团要素）。',
    aliases: ['雪地', '冬季', '雪山'],
  },
  {
    id: 'locked-space',
    label: '密室空间',
    category: 'scene',
    spec: true,
    desc: '空间本身极度受限（电梯、地下室、单间公寓、密舱）的舞台。',
    aliases: ['封闭空间', '狭小空间'],
  },
  {
    id: 'cruise-ship',
    label: '邮轮',
    category: 'scene',
    spec: false,
    desc: '航行中的邮轮或客船构成的移动封闭舞台。',
    aliases: ['客船', '游轮'],
  },
  {
    id: 'theater',
    label: '剧场',
    category: 'scene',
    spec: false,
    desc: '剧院、舞台、演出场所构成的舞台。',
    aliases: ['剧院', '舞台'],
  },
  {
    id: 'historical-setting',
    label: '时代背景',
    category: 'scene',
    spec: false,
    desc: '故事明确设置在过去某个历史时期，时代细节参与构成谜团。',
    aliases: ['历史背景', '年代感'],
  },

  // ── 动机类 ────────────────────────────────────────────────────────────
  {
    id: 'revenge',
    label: '复仇',
    category: 'motive',
    spec: true,
    desc: '动机类型：复仇。仅标注类型，不指向任何具体人物。',
    aliases: ['报仇'],
  },
  {
    id: 'gain',
    label: '财杀',
    category: 'motive',
    spec: true,
    desc: '动机类型：财产、遗产、利益。',
    aliases: ['图财', '遗产'],
  },
  {
    id: 'passion',
    label: '情杀',
    category: 'motive',
    spec: true,
    desc: '动机类型：情感纠葛。',
    aliases: ['情感', '爱恨'],
  },
  {
    id: 'silencing',
    label: '灭口',
    category: 'motive',
    spec: true,
    desc: '动机类型：为掩盖其他事实而灭口。',
    aliases: ['封口', '掩盖'],
  },
  {
    id: 'vigilante',
    label: '替天行道',
    category: 'motive',
    spec: true,
    desc: '动机类型：自认的正义裁决。',
    aliases: ['私刑', '正义制裁'],
  },
  {
    id: 'obsession',
    label: '执念',
    category: 'motive',
    spec: true,
    desc: '动机类型：长期执念、偏执追求。',
    aliases: ['偏执', '执著'],
  },
  {
    id: 'identity',
    label: '身份认同',
    category: 'motive',
    spec: true,
    desc: '动机类型：身份、归属、被承认的渴望。',
    aliases: ['身份焦虑', '归属'],
  },
  {
    id: 'concealment',
    label: '掩盖秘密',
    category: 'motive',
    spec: false,
    desc: '动机类型：隐瞒过去或不愿被揭开的旧事。',
    aliases: ['隐藏过去', '旧案'],
  },
  {
    id: 'fear',
    label: '恐惧',
    category: 'motive',
    spec: false,
    desc: '动机类型：恐慌、被胁迫或精神压力驱动。',
    aliases: ['恐慌', '胁迫'],
  },
  {
    id: 'curiosity',
    label: '求知欲',
    category: 'motive',
    spec: false,
    desc: '动机类型：探究欲、"想知道答案"本身构成驱动力。',
    aliases: ['探究', '好奇心'],
  },

  // ── 氛围题材类（系统扩展，权重最低） ──────────────────────────────────
  {
    id: 'honkaku',
    label: '本格解谜',
    category: 'theme',
    spec: false,
    desc: '以公平解谜为核心，线索摆明、逻辑推演优先。',
    aliases: ['本格', '解谜'],
  },
  {
    id: 'social-commentary',
    label: '社会议题',
    category: 'theme',
    spec: false,
    desc: '以案件为切口讨论社会结构、制度或群体处境。',
    aliases: ['社会派', '社会性'],
  },
  {
    id: 'hardboiled',
    label: '硬汉风',
    category: 'theme',
    spec: false,
    desc: '冷硬、粗粝的叙述气质与行动派主角。',
    aliases: ['硬汉派', '冷硬'],
  },
  {
    id: 'dark-atmosphere',
    label: '暗黑氛围',
    category: 'theme',
    spec: false,
    desc: '阴郁、压抑、带有恐怖或不安感的基调。',
    aliases: ['暗黑', '压抑'],
  },
  {
    id: 'cozy',
    label: '日常之谜',
    category: 'theme',
    spec: false,
    desc: '以生活化的小谜团为主，暴力与血腥程度低。',
    aliases: ['日常推理', '轻推理'],
  },
  {
    id: 'youth',
    label: '青春',
    category: 'theme',
    spec: false,
    desc: '以少年少女的成长与情感为底色。',
    aliases: ['青春推理', '少年'],
  },
  {
    id: 'meta-fiction',
    label: '后设趣味',
    category: 'theme',
    spec: false,
    desc: '对推理文体本身进行戏仿、致敬或拆解。',
    aliases: ['元小说', '致敬作'],
  },
  {
    id: 'series-detective',
    label: '系列侦探',
    category: 'theme',
    spec: false,
    desc: '由固定侦探/系列角色贯穿的系列作品。',
    aliases: ['系列作', '名侦探系列'],
  },
  {
    id: 'legend-folklore',
    label: '民俗传说',
    category: 'theme',
    spec: false,
    desc: '融入怪谈、民俗、传说等超自然色彩元素（不必然存在超自然解释）。',
    aliases: ['怪谈', '民俗'],
  },
  {
    id: 'forensic',
    label: '科学取证',
    category: 'theme',
    spec: false,
    desc: '以法医学、鉴识科学或技术手段推动推理。',
    aliases: ['法医', '鉴识'],
  },
  {
    id: 'spy-espionage',
    label: '谍战',
    category: 'theme',
    spec: false,
    desc: '涉及谍报、组织对抗与政治阴谋。',
    aliases: ['间谍', '谍报'],
  },
  {
    id: 'adventure',
    label: '冒险',
    category: 'theme',
    spec: false,
    desc: '带有寻宝、探险、追逃等动作冒险色彩。',
    aliases: ['探险', '寻宝'],
  },

  // ── 推理流派（系统扩展类别，第二维度） ────────────────────────────────
  {
    id: 'logic-school',
    label: '逻辑流',
    category: 'school',
    spec: false,
    desc: '以严密推演驱动，线索公平摆明、结论由逻辑闭合，谜面多为"如何从已知推出唯一解"。',
    aliases: ['逻辑推理', '奎因流', '解谜流'],
  },
  {
    id: 'trick-school',
    label: '诡计流',
    category: 'school',
    spec: false,
    desc: '以诡计机关本身为卖点，谜团的"设计感"重于推演过程。',
    aliases: ['机关流', '诡计本位'],
  },
  {
    id: 'orthodox-school',
    label: '本格正统',
    category: 'school',
    spec: false,
    desc: '遵循黄金时代范式的公平解谜：封闭舞台、有限嫌疑人、读者可参与推理。',
    aliases: ['正统本格', '黄金时代派'],
  },
  {
    id: 'social-school',
    label: '社会派',
    category: 'school',
    spec: false,
    desc: '以案件为切口追问社会结构与人性处境，动机与社会背景重于诡计机关。',
    aliases: ['社会派推理'],
  },
  {
    id: 'police-procedural',
    label: '刑侦派',
    category: 'school',
    spec: false,
    desc: '以警方办案流程为主线（现场勘查、走访、串并案、技术鉴定），程序感强。',
    aliases: ['警察小说', '刑侦推理', '警探程序'],
  },
  {
    id: 'legal-thriller',
    label: '法庭派',
    category: 'school',
    spec: false,
    desc: '以法庭对抗、证据攻防、陪审与判决为核心舞台，真相在控辩交锋中浮现。',
    aliases: ['法庭推理', '法律惊悚', '律师小说'],
  },
  {
    id: 'forensic-school',
    label: '法医鉴识派',
    category: 'school',
    spec: false,
    desc: '以法医、鉴识科学与物证推理推动破案，"证据会说话"是主要乐趣。',
    aliases: ['法医推理', '鉴识派', '科学派'],
  },
  {
    id: 'hardboiled-school',
    label: '硬汉派',
    category: 'school',
    spec: false,
    desc: '冷硬都市里的孤独侦探，动作与道德困境并重，解谜让位于处境与选择。',
    aliases: ['冷硬派', '硬汉推理'],
  },
  {
    id: 'psychological-school',
    label: '心理悬疑派',
    category: 'school',
    spec: false,
    desc: '以人物的记忆、认知偏差与心理博弈构成主要悬念，恐怖感来自不可靠的内心。',
    aliases: ['心理惊悚', '心理流派'],
  },
  {
    id: 'spy-school',
    label: '间谍派',
    category: 'school',
    spec: false,
    desc: '情报机构与组织对抗为主线，身份、忠诚与背叛构成谜团。',
    aliases: ['谍战派', '间谍小说'],
  },
  {
    id: 'adventure-school',
    label: '冒险派',
    category: 'school',
    spec: false,
    desc: '解谜与追逃探险并行，场景跨度大、节奏偏快。',
    aliases: ['探险派'],
  },
  {
    id: 'daily-mystery-school',
    label: '日常之谜派',
    category: 'school',
    spec: false,
    desc: '以生活化的小谜团为主，暴力程度低，趣味在观察与人心。',
    aliases: ['日常推理派', '轻推理派'],
  },
  {
    id: 'meta-school',
    label: '后设派',
    category: 'school',
    spec: false,
    desc: '有意对推理文体本身进行戏仿、致敬或拆解，常以"书中书"形式呈现。',
    aliases: ['元小说派', '反推理'],
  },
  {
    id: 'bizarre-school',
    label: '变格派',
    category: 'school',
    spec: false,
    desc: '气氛怪奇、知识炫学、逻辑让位于感官冲击，常见于战前日本推理。',
    aliases: ['怪奇派', '幻想推理'],
  },
];

/** 标签 id -> 定义 */
export const TAG_MAP = Object.fromEntries(TAGS.map((t) => [t.id, t]));

/** 别名 -> 标签 id（含标签本身） */
export const TAG_ALIAS_MAP = (() => {
  const map = new Map();
  for (const tag of TAGS) {
    map.set(tag.id.toLowerCase(), tag.id);
    map.set(tag.label, tag.id);
    for (const alias of tag.aliases ?? []) map.set(alias, tag.id);
  }
  return map;
})();

/** 按类别分组的标签 */
export const TAGS_BY_CATEGORY = CATEGORY_ORDER.reduce((acc, cid) => {
  acc[cid] = TAGS.filter((t) => t.category === cid);
  return acc;
}, {});

/** 需求文档中明确列出的「核心诡计标签」（用于报告 2.1 的默认候选清单） */
export const SPEC_CORE_TRICK_TAGS = TAGS.filter((t) => t.category === 'trick' && t.spec).map((t) => t.label);

/** 类别权重 */
export const CATEGORY_WEIGHT = Object.fromEntries(TAG_CATEGORIES.map((c) => [c.id, c.weight]));

/**
 * 把任意输入（id / 中文标签 / 别名）规范化为标签 id。
 * @param {string} input
 * @returns {string|null} 无法识别时返回 null
 */
export function normalizeTag(input) {
  if (typeof input !== 'string') return null;
  const key = input.trim();
  if (!key) return null;
  return TAG_ALIAS_MAP.get(key) ?? TAG_ALIAS_MAP.get(key.toLowerCase()) ?? null;
}

/**
 * 标签 id -> 中文展示名
 * @param {string} id
 */
export function tagLabel(id) {
  return TAG_MAP[id]?.label ?? id;
}

/**
 * 标签 id 列表 -> 中文展示名列表（自动去重、保持字典顺序）
 * @param {string[]} ids
 */
export function tagLabels(ids) {
  const set = new Set(ids ?? []);
  return TAGS.filter((t) => set.has(t.id)).map((t) => t.label);
}

/** 标签 id 的类别 */
export function tagCategory(id) {
  return TAG_MAP[id]?.category ?? null;
}

/**
 * 该标签是否属于「推理流派」维度。
 *
 * 流派存在独立的 `schoolTags` 字段，与 `tags` 正交；表单、导入、手改 JSON
 * 都可能把两者混写，因此需要一处统一的判定函数供自愈逻辑复用。
 *
 * @param {string} id
 * @returns {boolean}
 */
export function isSchoolTag(id) {
  return TAG_MAP[id]?.category === 'school';
}

/**
 * 校验一组标签 id 是否全部合法
 * @param {string[]} ids
 * @returns {{ valid: string[], unknown: string[] }}
 */
export function partitionTags(ids) {
  const valid = [];
  const unknown = [];
  for (const id of ids ?? []) {
    if (TAG_MAP[id]) valid.push(id);
    else unknown.push(id);
  }
  return { valid, unknown };
}
