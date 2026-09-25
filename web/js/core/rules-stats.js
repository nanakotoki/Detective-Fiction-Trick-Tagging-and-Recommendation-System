/**
 * 规则统计（供「关于」页展示，避免在文案里写死数字导致与实现脱节）
 */

import { SAFE_PHRASES, SPOILER_RULES } from './safety.js';

export const RULES_STATS = {
  rules: SPOILER_RULES.length,
  patterns: SPOILER_RULES.reduce((sum, rule) => sum + rule.patterns.length, 0),
  categories: [...new Set(SPOILER_RULES.map((r) => r.category))],
  safePhrases: SAFE_PHRASES.length,
  byRisk: SPOILER_RULES.reduce((acc, rule) => {
    acc[rule.risk] = (acc[rule.risk] ?? 0) + 1;
    return acc;
  }, {}),
};
