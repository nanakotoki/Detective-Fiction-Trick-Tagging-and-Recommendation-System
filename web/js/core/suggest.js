/**
 * 标签推断器（无剧透）
 * ================
 * 当用户只提供书名与无剧透梗概时，从**梗概文本**中推断候选标签。
 *
 * 严格约束：
 *   - 只做「关键词 → 标签类别」的映射，绝不尝试推断"谜底是什么"。
 *   - 输出的是**候选**标签，且附带命中的原文片段，供用户确认或修改。
 *   - 若梗概中没有出现任何线索，则返回空数组，由用户在界面上手动选择，
 *     系统宁可说「信息有限」，也不臆测。
 */

import { TAGS, tagLabel } from './tags.js';

/**
 * 每个标签的判定线索。
 * strong 命中即高置信度（明确提及该类型）。
 * weak   命中为中等置信度（描述到了相关场景/结构）。
 */
const LEXICON = {
  'locked-room': { strong: ['密室', '密闭房间', '不可能犯罪', '从内部上锁', '反锁'], weak: ['上锁的房间', '无法进入', '门窗紧锁'] },
  alibi: { strong: ['不在场证明', '不在场', 'alibi'], weak: ['时间差', '行程', '证明他不在'] },
  'narrative-trick': { strong: ['叙述性诡计', '叙述诡计', '叙诡'], weak: ['叙述者', '第一人称叙述', '手记'] },
  timetable: { strong: ['时刻表', '时间表诡计', '列车时刻'], weak: ['列车', '车站', '换乘', '时间刻'] },
  'faceless-corpse': { strong: ['无面尸', '面部被毁', '无法辨认的尸体', '身份不明的尸体'], weak: ['毁容', '尸体身份'] },
  'vanished-weapon': { strong: ['凶器消失', '凶器不见', '找不到凶器'], weak: ['凶器', '凶器去向'] },
  'closed-circle': { strong: ['暴风雪山庄', '封闭山庄', '与外界隔绝', '孤岛模式', '无法离开'], weak: ['暴风雪', '断桥', '大雪封', '孤岛', '隔绝'] },
  'multiple-solutions': { strong: ['多重解答', '多重推理', '伪解答', '两种推理'], weak: ['推翻', '推理被否定', '另一种可能'] },
  'psychological-misdirection': { strong: ['心理误导', '心理盲点', '心理陷阱'], weak: ['误导', '错觉', '想当然'] },
  'red-herring': { strong: ['红鲱鱼', '烟雾弹', '误导线索'], weak: ['线索指向', '嫌疑人', '疑点重重'] },
  'swap-murder': { strong: ['交换杀人', '互杀', '互相为对方'], weak: ['两人约定', '共同计划'] },
  'nursery-rhyme': { strong: ['童谣杀人', '童谣', '按诗句', '预言杀人', '模仿杀人'], weak: ['歌谣', '诗句', '歌词', '韵文', '传说对应'] },
  cipher: { strong: ['暗号', '密码', '暗码', '密文', '隐写'], weak: ['符号', '纸条', '留言', '字谜'] },
  'dual-role': { strong: ['一人二角', '一人分饰', '双重身份'], weak: ['两个身份', '冒充', '化名'] },

  'first-person': { strong: ['第一人称', '以「我」', '以"我"'], weak: ['我接到', '我收到', '我回到', '我来到'] },
  'dual-line': { strong: ['双线', '两条时间线', '双线叙事'], weak: ['与此同时', '另一条线', '多年前', '多年后', '另一时间'] },
  nonlinear: { strong: ['非线性', '时间跳跃', '打乱时间'], weak: ['倒回', '闪回', '跳跃叙述'] },
  ensemble: { strong: ['群像', '多视角', '多人物视角'], weak: ['众人', '各人', '十个人', '几个人分别'] },
  'diary-form': { strong: ['日记体', '手记体', '书信体', '档案体'], weak: ['日记', '手记', '信件', '笔记', '记录'] },
  'reverse-chronology': { strong: ['倒叙', '逆行时间'], weak: ['从结局写起', '先说结果'] },
  'unreliable-narrator': { strong: ['不可靠叙述者', '不可靠叙述'], weak: ['叙述者是否可信', '他的记忆', '记不清'] },

  'isolated-island': { strong: ['孤岛', '海岛', '无人岛'], weak: ['岛', '渡船', '海上'] },
  mansion: { strong: ['洋馆', '公馆', '宅邸', '别墅'], weak: ['大宅', '老宅', '豪门', '宅院'] },
  train: { strong: ['列车', '火车', '卧铺', '新干线'], weak: ['车厢', '铁路', '站台'] },
  campus: { strong: ['校园', '大学', '学园', '高中'], weak: ['社团', '教室', '学生'] },
  hospital: { strong: ['医院', '疗养院', '精神病院', '诊所'], weak: ['病房', '医生', '护士'] },
  countryside: { strong: ['乡村', '山村', '村庄', '小镇'], weak: ['村里', '农家', '乡下', '镇子'] },
  city: { strong: ['都市', '大城', '现代城市'], weak: ['公寓', '写字楼', '街区', '城市'] },
  snowfield: { strong: ['雪原', '雪山', '雪地'], weak: ['积雪', '脚印', '严寒', '暴雪'] },
  'locked-space': { strong: ['密室空间', '封闭空间', '狭小空间'], weak: ['电梯', '地下室', '密舱', '单间'] },
  'cruise-ship': { strong: ['邮轮', '游轮', '客船'], weak: ['船上', '航行'] },
  theater: { strong: ['剧场', '剧院', '舞台'], weak: ['演出', '演员', '排练'] },
  'historical-setting': { strong: ['时代背景', '昭和', '江户', '民国'], weak: ['战前', '战后', '古代'] },

  revenge: { strong: ['复仇', '报仇', '报应'], weak: ['旧怨', '恩怨'] },
  gain: { strong: ['遗产', '财产', '图财'], weak: ['继承', '利益', '金钱'] },
  passion: { strong: ['情杀', '感情纠葛', '不伦'], weak: ['恋人', '婚外', '情感'] },
  silencing: { strong: ['灭口', '封口'], weak: ['掩盖', '目击者'] },
  vigilante: { strong: ['替天行道', '私刑', '正义制裁'], weak: ['制裁', '惩罚者'] },
  obsession: { strong: ['执念', '偏执'], weak: ['执着', '执迷', '放不下'] },
  identity: { strong: ['身份认同', '身份焦虑'], weak: ['出身', '归属', '我是谁'] },
  concealment: { strong: ['掩盖秘密', '隐藏过去'], weak: ['旧案', '过去', '秘密', '多年前的'] },
  fear: { strong: [], weak: ['恐惧', '威胁', '恐吓', '胁迫'] },
  curiosity: { strong: [], weak: ['好奇', '想知道', '探究'] },

  honkaku: { strong: ['本格'], weak: ['解谜', '推理游戏', '公平', '读者挑战'] },
  'social-commentary': { strong: ['社会派', '社会议题'], weak: ['制度', '阶层', '底层', '现实'] },
  hardboiled: { strong: ['硬汉', '冷硬'], weak: ['侦探事务所', '委托人', '酒'] },
  'dark-atmosphere': { strong: ['暗黑', '压抑'], weak: ['阴森', '恐怖', '血腥', '诡异'] },
  cozy: { strong: ['日常之谜', '日常推理'], weak: ['轻松', '温馨', '生活'] },
  youth: { strong: ['青春'], weak: ['少年', '少女', '学生时代', '成长'] },
  'meta-fiction': { strong: ['后设', '元小说'], weak: ['致敬', '戏仿', '书中书'] },
  'series-detective': { strong: ['系列侦探', '名侦探'], weak: ['系列', '侦探登场', 'again'] },
  'legend-folklore': { strong: ['民俗', '怪谈', '传说'], weak: ['诅咒', '迷信', '神社', '习俗'] },
  forensic: { strong: ['法医', '鉴识'], weak: ['解剖', 'DNA', '尸检', '鉴定'] },
  'spy-espionage': { strong: ['谍战', '间谍'], weak: ['情报', '组织', '特工'] },
  adventure: { strong: [], weak: ['寻宝', '探险', '逃亡', '追逐'] },
};

/**
 * 从梗概推断候选标签。
 * @param {string} text
 * @param {{ max?: number }} [options]
 * @returns {Array<{id:string, label:string, category:string, confidence:number, level:'high'|'medium', hits:string[]}>}
 */
export function suggestTags(text, options = {}) {
  const { max = 24 } = options;
  const source = String(text ?? '');
  if (!source.trim()) return [];

  const results = [];

  for (const tag of TAGS) {
    const lex = LEXICON[tag.id];
    if (!lex) continue;

    const strongHits = (lex.strong ?? []).filter((kw) => source.includes(kw));
    const weakHits = (lex.weak ?? []).filter((kw) => source.includes(kw));
    if (!strongHits.length && !weakHits.length) continue;

    const confidence = strongHits.length ? 0.9 - Math.min(0.25, (strongHits.length - 1) * 0.05) : 0.55;
    results.push({
      id: tag.id,
      label: tagLabel(tag.id),
      category: tag.category,
      confidence: Number(confidence.toFixed(2)),
      level: strongHits.length ? 'high' : 'medium',
      hits: [...strongHits, ...weakHits].slice(0, 4),
    });
  }

  const levelRank = { high: 1, medium: 0 };
  results.sort((a, b) => levelRank[b.level] - levelRank[a.level] || b.confidence - a.confidence);

  return results.slice(0, max);
}

/** 判断文本是否有足够信息用于推断 */
export function hasEnoughSignal(text) {
  return suggestTags(text).length > 0;
}
