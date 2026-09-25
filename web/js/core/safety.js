/**
 * 反剧透安全引擎
 * ================
 * 落地需求文档《最高铁律》与《安全自检清单》：
 *   1. 绝不写出凶手是谁
 *   2. 绝不写出真相、结局、手法核心答案
 *   3. 绝不暗示关键诡计的破解方式
 *   4. 只描述"存在什么类型的诡计"，不描述"这个诡计是什么/怎么破的"
 *   5. 推荐作品时只能比较诡计类型与风格
 *
 * 设计要点：
 *   - 「字段级门禁」：每本书的每个字段被明确标记为公开 / 保密，保密字段永不进入渲染与导出管线。
 *   - 「规则引擎」：对公开文本做正则扫描，命中即给出风险等级、类别与修复建议。
 *   - 「白名单」：推理语境下的合法表述（如"找出凶手是谁""不剧透"）会被豁免，避免误报。
 *   - 「输出前自检」：按需求文档的 5 条清单逐条给出结论，未通过则拦截导出。
 *
 * 本模块为纯函数实现，浏览器与 Node 端共用。
 */

/** 风险等级 */
export const RISK = {
  HIGH: 'high', // 必定泄露谜底，必须修改
  MEDIUM: 'medium', // 极可能构成暗示，强烈建议修改
  LOW: 'low', // 需要人工确认
  INFO: 'info', // 提示，不构成风险
};

export const RISK_META = {
  high: { label: '高危', icon: '⛔', className: 'risk-high' },
  medium: { label: '可疑', icon: '⚠️', className: 'risk-medium' },
  low: { label: '待确认', icon: '❓', className: 'risk-low' },
  info: { label: '提示', icon: 'ℹ️', className: 'risk-info' },
};

const RANK = { info: 0, low: 1, medium: 2, high: 3 };

/**
 * 字段级门禁策略。
 * public=false 的字段属于「谜底保险库」，不参与任何渲染 / 导出 / 推荐。
 */
export const FIELD_POLICY = {
  title: { public: true, maxLength: 120, label: '书名', kind: 'title' },
  author: { public: true, maxLength: 120, label: '作者', kind: 'name' },
  genre: { public: true, maxLength: 40, label: '流派', kind: 'enum' },
  firstPublished: { public: true, maxLength: 40, label: '首次出版', kind: 'date' },
  /** 本库所引版本的出版年（见 docs/collection-backlog.md 第十一节：与 firstPublished 语义分开） */
  editionYear: { public: true, maxLength: 40, label: '版本年', kind: 'date' },
  series: { public: true, maxLength: 120, label: '系列', kind: 'series' },
  safeSummary: { public: true, maxLength: 100, label: '无剧透简介', kind: 'sentence', strictLength: true },
  matchingReason: { public: true, maxLength: 200, label: '匹配理由', kind: 'sentence' },
  readingTips: { public: true, maxLength: 600, label: '阅读提示', kind: 'sentence' },
  reviewSummary: { public: true, maxLength: 300, label: '平台评价摘要', kind: 'sentence' },
  editorialNote: { public: true, maxLength: 300, label: '编者按', kind: 'sentence' },

  // ── 谜底保险库：以下字段永不对外输出 ──
  vault: { public: false, label: '谜底保险库（仅本机保存，永不输出）' },
  'vault.culprit': { public: false, label: '凶手身份' },
  'vault.coreTrick': { public: false, label: '诡计核心解法' },
  'vault.ending': { public: false, label: '结局' },
  'vault.notes': { public: false, label: '其他保密笔记' },
};

/** 保险库字段路径 */
export const VAULT_FIELDS = ['vault.culprit', 'vault.coreTrick', 'vault.ending', 'vault.notes'];

/**
 * 剧透检测规则库。
 * pattern 使用带 flags 的字符串写法以便序列化。
 */
export const SPOILER_RULES = [
  // ── A. 凶手 / 犯人身份 ──
  {
    id: 'identity-assert',
    category: '凶手身份',
    risk: RISK.HIGH,
    patterns: [
      '(?:真凶|凶手|犯人|罪犯|作案人|罪魁祸首|元凶)(?:其实|原来)?(?:就)?(?:是|正是|乃|为)',
      '(?:凶手|真凶)(?:的身份)?(?:竟然|居然|原来)',
      '(?:原来|其实|真相是)[^。！？]{0,8}(?:凶手|真凶)',
    ],
    hint: '出现了对凶手身份的断言，触碰铁律第 1 条。改为只描述"存在哪一类诡计"。',
  },
  {
    id: 'identity-reveal-verb',
    category: '凶手身份',
    risk: RISK.HIGH,
    patterns: [
      '(?:揭示|揭露|道出|指出|点明|揭穿|曝光|水落石出)[^。！？]{0,12}(?:凶手|真凶|犯人|身份)',
      '(?:凶手|真凶|犯人)(?:最终|最后)?(?:被)?(?:揭穿|揪出|抓获|落网|逮捕|绳之以法)',
      '(?:真凶|凶手)(?:自白|自首|落网|伏法)',
      '(?:真凶|凶手)(?:终于|最终|最后)?(?:浮出水面|露面|现身|现形|查明)',
    ],
    hint: '出现了"揭晓凶手"的表述，读者会立刻预判结局走向。删除该表述。',
  },
  // ── B. 真相 / 结局 ──
  {
    id: 'ending-reveal',
    category: '真相结局',
    risk: RISK.HIGH,
    patterns: [
      '(?:结局|结尾|尾声|最后)[^。！？]{0,10}(?:是|为|表明|显示|揭示|原来)',
      '真相(?:是|竟是|原来|大白|浮出水面)',
      '最终(?:真相|结局|答案)',
      '(?:原来|其实)[^。！？]{0,6}(?:一切|全都|都是)[^。！？]{0,10}(?:策划|设计|安排|伪装|骗局|谎言)',
    ],
    hint: '出现了对真相或结局的陈述，触碰铁律第 2 条。',
  },
  // ── C. 手法核心答案 ──
  {
    id: 'method-reveal',
    category: '手法答案',
    risk: RISK.HIGH,
    patterns: [
      '(?:手法|诡计|圈套|机关|把戏|障眼法|骗局)(?:的)?(?:核心|关键|本质|真相)?(?:其实|原来)?(?:就)?(?:是|在于|如下|为)',
      '(?:利用|借助|通过|依靠)[^。！？]{0,16}(?:制造|伪造|伪装|完成|实现)[^。！？]{0,10}(?:密室|不在场证明|自杀|意外|死亡)',
      '(?:制造|伪造|伪装|营造)(?:了|出)?[^。！？]{0,8}(?:密室|不在场证明|自杀|意外事故)',
      '(?:实际上|事实上|其实)[^。！？]{0,10}(?:已经|早已|并未|并没有)[^。！？]{0,8}(?:死亡|死去|活着|在场|离开)',
      '(?:凶手|真凶)[^。！？]{0,8}(?:利用|借助|通过|事先|提前|偷偷)',
    ],
    hint: '出现了对作案手法实现方式的描述，触碰铁律第 2、3 条。',
  },
  {
    id: 'mechanism-detail',
    category: '手法答案',
    risk: RISK.MEDIUM,
    patterns: [
      '(?:暗道|密道|机关装置|翻板|绞盘|滑轮|钢丝|绳索装置|定时装置|延时装置|自动装置|远距离|遥控装置)',
      '(?:死亡时间|作案时间)[^。！？]{0,10}(?:被)?(?:伪造|篡改|错误|有误|对不上)',
      '(?:身份|姓名|尸体的身份)[^。！？]{0,8}(?:被)?(?:调换|替换|掉包|互换|顶替)',
      '(?:死去的|死亡的|尸体的主人)[^。！？]{0,6}(?:其实|原来|并不是|并非)',
      '(?:叙诡|诡计)[^。！？]{0,6}(?:在于|的核心|的关键)',
      '(?:叙述者|讲述人|"我")[^。！？]{0,10}(?:其实|原来|就是|并非|不是|隐瞒)',
    ],
    hint: '出现了可能指向具体机制的技术细节或身份反转暗示。请确认它只描述设备/现象，不指向解法。',
  },
  // ── D. 破解提示 ──
  {
    id: 'solution-through',
    category: '诡计破解',
    risk: RISK.HIGH,
    patterns: [
      '(?:破解|解开|识破|看穿|推翻)[^。！？]{0,10}(?:诡计|手法|圈套|不在场证明|密室|谎言|伪装)',
      '(?:关键|突破口|决定性)(?:线索|证据|证物|一击)(?:是|在于|为)',
      '(?:决定性证据|关键证据|铁证)[^。！？]{0,6}(?:是|在于|为)',
      '(?:只要|只需|一旦)[^。！？]{0,12}(?:就(?:能|可以|会)(?:识破|发现|证明|推出))',
    ],
    hint: '出现了破解方式或关键证据的说明，触碰铁律第 3 条。',
  },
  // ── E. 结果与动机泄露 ──
  {
    id: 'outcome-reveal',
    category: '真相结局',
    risk: RISK.HIGH,
    patterns: [
      '(?:共|总计|先后|相继|接连)?(?:杀害|杀死|杀了|勒死|毒杀|刺杀|枪杀)(?:了)?[^。！？]{0,8}(?:\\d+|一|二|三|四|五|六|七|八|九|十|数|多)(?:人|名|位|个)',
      '(?:是|属于)(?:一场|一起|一桩)?(?:由)[^。！？]{0,10}(?:策划|设计|导演)(?:的)?[^。！？]{0,6}(?:骗局|表演|闹剧|复仇)',
      '(?:假死|装死|诈死|自导自演|伪造死亡)',
    ],
    hint: '出现了案件结果（人数、性质）或关键反转的说明。',
  },
  {
    id: 'motive-reveal',
    category: '动机泄露',
    risk: RISK.MEDIUM,
    patterns: [
      '(?:动机|杀人动机|作案动机)(?:是|在于|为|源于)',
      '(?:为了|因为)[^。！？]{0,14}(?:而)?(?:杀人|行凶|下手|复仇|灭口)',
      '(?:凶手|真凶)[^。！？]{0,8}(?:的)?动机',
      '(?:二十|十|三十|十几|数)年前[^。！？]{0,10}(?:的)?(?:事件|案件|秘密|真相|恩怨|旧案)[^。！？]{0,10}(?:导致|引发|埋下)',
    ],
    hint: '动机只允许标注"类型"（复仇/财杀/情杀…），不得说明具体是谁、为了什么。',
  },
  // ── F. 交叉作品泄底 ──
  {
    id: 'cross-work-spoiler',
    category: '跨作品泄底',
    risk: RISK.HIGH,
    patterns: [
      '(?:同样|也|都)(?:是|采用了|使用了)[^。！？]{0,10}(?:凶手|真凶)(?:是|为)',
      '(?:两本书|和[《"]?[^。！？]{0,20}[》"]?)[^。！？]{0,10}(?:凶手|真相|结局)[^。！？]{0,6}(?:一样|相同|类似|同一个)',
      '(?:与|和)[《"]?[^。！？]{1,24}[》"][^。！？]{0,16}(?:如出一辙|完全相同)的(?:凶手|真相|结局)',
    ],
    hint: '推荐理由中不得比较谜底，只能比较诡计类型与风格（铁律第 5 条）。',
  },
];

/**
 * 合法表述白名单：命中则豁免该片段。
 * 这些是推理语境下的常规说法，不构成剧透。
 */
export const SAFE_PHRASES = [
  '找出凶手',
  '凶手是谁',
  '凶手到底是谁',
  '真凶是谁',
  '凶手身份不明',
  '凶手未知',
  '不剧透',
  '无剧透',
  '去剧透',
  '防剧透',
  '不泄底',
  '无泄底',
  '不揭示',
  '凶手未明',
  '谁是真凶',
  '凶手尚不明确',
];

/** 需求文档《安全自检清单》的 5 条 */
export const SELF_CHECK_ITEMS = [
  {
    id: 'culprit',
    question: '是否出现了凶手身份？',
    ruleCategories: ['凶手身份'],
    forbidden: true,
  },
  {
    id: 'truth',
    question: '是否透露了案件真相或结局？',
    ruleCategories: ['真相结局'],
    forbidden: true,
  },
  {
    id: 'method',
    question: '是否解释了诡计的具体实现方式？',
    ruleCategories: ['手法答案', '诡计破解'],
    forbidden: true,
  },
  {
    id: 'crossWork',
    question: '推荐作品中是否泄露了任何一本的谜底？',
    ruleCategories: ['跨作品泄底', '真相结局', '凶手身份', '手法答案'],
    forbidden: true,
  },
  {
    id: 'type-only',
    question: '是否只描述"诡计类型"而非"诡计内容"？',
    ruleCategories: ['手法答案', '诡计破解', '动机泄露'],
    forbidden: true,
  },
];

/** 文本长度（按 Unicode 码点计数，中文按 1 字） */
export function countChars(text) {
  return Array.from(String(text ?? '')).length;
}

/** 编译正则（带缓存） */
const regexCache = new Map();
function compile(source) {
  if (!regexCache.has(source)) {
    regexCache.set(source, new RegExp(source, 'g'));
  }
  const re = regexCache.get(source);
  re.lastIndex = 0;
  return re;
}

/**
 * 用白名单遮蔽合法表述，避免误报。
 * 用等长占位符替换，保证命中位置与原文一致。
 */
function maskSafePhrases(text) {
  let masked = text;
  const hits = [];
  for (const phrase of SAFE_PHRASES) {
    let idx = masked.indexOf(phrase);
    while (idx !== -1) {
      hits.push({ phrase, index: idx });
      masked = masked.slice(0, idx) + '\u0000'.repeat(phrase.length) + masked.slice(idx + phrase.length);
      idx = masked.indexOf(phrase, idx + phrase.length);
    }
  }
  return { masked, safeHits: hits };
}

/**
 * 扫描一段文本。
 * @param {string} text
 * @param {{ field?: string, context?: 'book'|'recommendation'|'platform' }} [options]
 * @returns {{ text: string, findings: Array, highestRisk: string|null, passed: boolean }}
 */
export function scanText(text, options = {}) {
  // 统一换行符：用户从 Windows 程序粘贴的文本常含 \r，会干扰正则与位置计算
  const raw = String(text ?? '').replace(/\r\n?/g, '\n');
  const { field = 'unknown', context = 'book' } = options;
  const findings = [];

  if (!raw.trim()) {
    return { text: raw, field, findings, highestRisk: null, passed: true, safeHits: [] };
  }

  const { masked, safeHits } = maskSafePhrases(raw);

  for (const rule of SPOILER_RULES) {
    for (const pattern of rule.patterns) {
      const re = compile(pattern);
      let match;
      let guard = 0;
      while ((match = re.exec(masked)) !== null && guard < 50) {
        guard += 1;
        if (match[0].length === 0) {
          re.lastIndex += 1;
          continue;
        }
        const start = Math.max(0, match.index - 12);
        const end = Math.min(raw.length, match.index + match[0].length + 12);
        findings.push({
          ruleId: rule.id,
          category: rule.category,
          risk: rule.risk,
          field,
          context,
          match: match[0],
          excerpt: `${start > 0 ? '…' : ''}${raw.slice(start, end)}${end < raw.length ? '…' : ''}`,
          index: match.index,
          hint: rule.hint,
        });
      }
    }
  }

  // 同一位置重复命中时只保留风险最高的一条
  const deduped = [];
  for (const f of findings.sort((a, b) => a.index - b.index || RANK[b.risk] - RANK[a.risk])) {
    const dup = deduped.find((d) => Math.abs(d.index - f.index) < 4);
    if (!dup) deduped.push(f);
    else if (RANK[f.risk] > RANK[dup.risk]) deduped[deduped.indexOf(dup)] = f;
  }

  // 书名/作者等字段的命中降级为提示（书名本身可能含"凶手"等词）
  const finalFindings = deduped.map((f) => {
    if (field === 'title' || field === 'author' || field === 'series') {
      return { ...f, risk: f.risk === RISK.HIGH ? RISK.MEDIUM : f.risk };
    }
    return f;
  });

  const highestRisk = finalFindings.reduce((acc, f) => (acc === null || RANK[f.risk] > RANK[acc] ? f.risk : acc), null);

  return {
    text: raw,
    field,
    findings: finalFindings,
    safeHits,
    highestRisk,
    passed: !finalFindings.some((f) => f.risk === RISK.HIGH || f.risk === RISK.MEDIUM),
  };
}

/**
 * 扫描一本书的全部公开字段。
 * @param {object} book
 * @param {{ includeVault?: boolean }} [options]
 */
export function analyzeBook(book, options = {}) {
  const { includeVault = false } = options;
  const results = [];
  const issues = [];

  const publicFields = Object.entries(FIELD_POLICY)
    .filter(([, p]) => p.public && p.kind !== 'enum' && p.kind !== 'date' && p.kind !== 'series')
    .map(([key, p]) => [key, p]);

  for (const [key, policy] of publicFields) {
    let value = book?.[key];
    if (key === 'matchingReason') value = book?.recommendationReason ?? value;
    if (value == null || value === '') continue;

    const scan = scanText(value, { field: key, context: 'book' });
    const length = countChars(value);
    const overLength = countChars(value) > policy.maxLength;

    if (overLength) {
      issues.push({
        ruleId: 'length',
        category: '格式规范',
        risk: policy.strictLength ? RISK.MEDIUM : RISK.LOW,
        field: key,
        fieldLabel: policy.label,
        match: `${length} 字`,
        excerpt: `${policy.label} 共 ${length} 字，超出上限 ${policy.maxLength} 字`,
        hint: policy.strictLength
          ? `需求文档要求「无剧透简介」在 ${policy.maxLength} 字以内，请精简。`
          : `建议压缩到 ${policy.maxLength} 字以内。`,
      });
    }

    for (const f of scan.findings) {
      issues.push({ ...f, fieldLabel: policy.label });
    }

    results.push({
      field: key,
      label: policy.label,
      policy,
      length,
      overLength,
      highestRisk: scan.highestRisk,
      findings: scan.findings,
      snippet: String(value).slice(0, 80),
    });
  }

  if (includeVault && book?.vault) {
    const filled = VAULT_FIELDS.filter((path) => {
      const key = path.split('.')[1];
      return book.vault?.[key];
    });
    results.push({
      field: 'vault',
      label: FIELD_POLICY.vault.label,
      policy: FIELD_POLICY.vault,
      sealed: true,
      filledFields: filled,
      note: filled.length
        ? `保险库已加密保存 ${filled.length} 项保密内容，系统在任何界面与导出文件中都不会输出。`
        : '保险库为空。',
    });
  }

  const severity = issues.reduce((acc, i) => (acc === null || RANK[i.risk] > RANK[acc] ? i.risk : acc), null);

  return {
    bookId: book?.id ?? null,
    bookTitle: book?.title ?? '(未命名)',
    results,
    issues: issues.sort((a, b) => RANK[b.risk] - RANK[a.risk]),
    highestRisk: severity,
    passed: !issues.some((i) => i.risk === RISK.HIGH || i.risk === RISK.MEDIUM),
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 推荐语安全校验：只允许比较诡计类型与风格。
 * @param {{reason:string, tags?:string[], book?:object, target?:object}} params
 */
export function analyzeRecommendation(params) {
  const { reason = '', tags = [], book, target } = params;
  const scan = scanText(reason, { field: 'matchingReason', context: 'recommendation' });

  const extra = [];
  // 推荐理由必须至少落在一个真实存在的共享标签上，避免"凭空相似"
  const shared = new Set((target?.tags ?? []).filter((t) => (book?.tags ?? []).includes(t)));
  const claimed = tags.filter((t) => !shared.has(t));
  if (claimed.length) {
    extra.push({
      ruleId: 'tag-mismatch',
      category: '匹配依据',
      risk: RISK.LOW,
      field: 'matchingReason',
      match: claimed.join('、'),
      excerpt: `推荐理由引用了与目标作品不共享的标签：${claimed.join('、')}`,
      hint: '匹配理由应基于两书真实共享的标签，否则构成风格误判。',
    });
  }
  if (!shared.size) {
    extra.push({
      ruleId: 'no-shared-tag',
      category: '匹配依据',
      risk: RISK.LOW,
      field: 'matchingReason',
      match: '—',
      excerpt: '两本书没有任何共享标签，却仍被推荐。',
      hint: '请补充共享标签，或降低该推荐的展示优先级。',
    });
  }

  const findings = [...scan.findings, ...extra];
  return {
    reason,
    findings,
    highestRisk: findings.reduce((acc, f) => (acc === null || RANK[f.risk] > RANK[acc] ? f.risk : acc), null),
    passed: !findings.some((f) => f.risk === RISK.HIGH || f.risk === RISK.MEDIUM),
  };
}

/**
 * 输出前自检清单（需求文档 5 条）。
 * @param {object} params
 * @param {object} params.book 目标书籍
 * @param {Array} [params.recommendations] 推荐结果 [{book, reason}]
 * @returns {{ passed: boolean, items: Array, blockers: Array }}
 */
export function runSelfCheck({ book, recommendations = [] }) {
  const bookReport = analyzeBook(book);
  const recReports = recommendations.map((rec) => ({
    bookId: rec.book?.id,
    title: rec.book?.title,
    report: analyzeRecommendation({
      reason: rec.reason ?? rec.book?.recommendationReason ?? '',
      tags: rec.book?.tags ?? [],
      book: rec.book,
      target: book,
    }),
  }));

  const allFindings = [
    ...bookReport.issues.map((i) => ({ ...i, source: `《${bookReport.bookTitle}》` })),
    ...recReports.flatMap((r) =>
      r.report.findings.map((f) => ({ ...f, source: `推荐《${r.title}》` })),
    ),
  ];

  const items = SELF_CHECK_ITEMS.map((item) => {
    const hits = allFindings.filter((f) => item.ruleCategories.includes(f.category) && RANK[f.risk] >= RANK[RISK.MEDIUM]);
    return {
      id: item.id,
      question: item.question,
      answer: hits.length > 0, // true 表示"是"，即不合格
      passed: hits.length === 0,
      hits: hits.map((h) => ({ source: h.source, excerpt: h.excerpt, hint: h.hint, risk: h.risk })),
    };
  });

  const blockers = allFindings.filter((f) => RANK[f.risk] >= RANK[RISK.MEDIUM]);

  return {
    passed: items.every((i) => i.passed),
    items,
    blockers,
    bookReport,
    recReports,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * 安全渲染成 Markdown 自检清单。
 * @param {ReturnType<typeof runSelfCheck>} selfCheck
 */
export function formatSelfCheckMarkdown(selfCheck) {
  const lines = ['### 安全自检清单', ''];
  for (const item of selfCheck.items) {
    lines.push(`- [${item.passed ? 'x' : ' '}] ${item.question} → ${item.passed ? '否 ✅' : '是 ⛔'}`);
  }
  if (!selfCheck.passed) {
    lines.push('', '> ⛔ 存在未通过项，已按需求文档要求拦截输出。请修改下列内容后重新生成：', '');
    for (const b of selfCheck.blockers) {
      lines.push(`> - 【${b.source}】${b.fieldLabel ?? ''}：…${b.excerpt}… — ${b.hint}`);
    }
  } else {
    lines.push('', '> ✅ 五项自检全部通过，本次输出不含任何剧透内容。');
  }
  return lines.join('\n');
}

/**
 * 保险库剥离：从任意对象中递归移除保密字段，用于任何对外输出的最后一道关卡。
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function stripVault(value) {
  if (Array.isArray(value)) return value.map(stripVault);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (k === 'vault') continue;
      out[k] = stripVault(v);
    }
    return out;
  }
  return value;
}
