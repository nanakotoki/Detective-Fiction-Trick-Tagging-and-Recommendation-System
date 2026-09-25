#!/usr/bin/env node
/**
 * 书名「大陆版优先」核查
 * ======================
 * 背景：整理过程中书名可能取自台版（繁体）、日文原版或英文原版，
 * 与大陆简体版的正式译名不一致。真实踩过的坑：
 *   《密室狂亂時代的殺人》(台版) → 大陆版是《密室狂乱时代的孤岛事件》，书名完全不同
 *   《如生灵双身之物》《替身》《献给虚无的供物》也都是同一类问题。
 *
 * 本脚本做**静态筛查**，把可疑条目按证据强度分级，不联网：
 *   A 级：书名含繁体字 / 日文假名 / 纯外文 —— 几乎确定不是大陆书名
 *   B 级：豆瓣实际匹配到的版本名与库中书名不一致 —— 很可能有更通行的译名
 *   C 级：书名含「の」「・」等日文痕迹
 * 输出按级别排序，供逐条核查。
 *
 * 用法：
 *   node scripts/audit-titles.mjs            # 打印分级报告
 *   node scripts/audit-titles.mjs --json     # 输出 JSON
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { SEED_FILES } from '../web/js/core/seed-files.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const argv = process.argv.slice(2);
const AS_JSON = argv.includes('--json');
const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/** 繁体字表（与 refresh-ratings 的映射表同源，这里只用于「检测」而非转换） */
const TRADITIONAL = new Set(
  '偵兇兒內兩冊劃劇劍動勝匯員嚇圍園圓圖團執場壞學實寫寶將專尋對導屍層屬岡島嶺巖帥帶幫幹幾廟廢廳張彈彙彥復徹惡愛慘憶應懷戰戲戶揚撲擔據擠擺攝敗敵數斷於昇時書會東業極樂樓樹橋機橫檢權歡歲歷殘殺毀氣決沒測湊準溝滅滿漢潑潔澀澤灣災為烏無煙熱燈燒營爭爺爾牆獄獨獲獵現環產畢畫異當疇瘋療發皺盡監盤眾睜矚碼礎礙祿禍禮種稱積穩窮竊競筆節範簡簽籤粵紀純紙級紛細終組結絕統絲經綠維綱網綾緊線練縮總織繼續纏罰罷羅義習聞聯聽肅腦腫臉臨與舉舊莊華萬葉蓋藥處號蟲術衛衝補裝複見規覺觀觸訂討讓讚貝負賽輛輝輪轉農運遊鄰長閉開陣陳雜難電靜響顏飄驚鬥魯鮮鴉鷹麥麵齊齒齡龍龜戀蠻彎傑僅儲優儉債傾僑偽偉傳亂彌黒薬澤惠徳塩竜渋稲縁顔検験権歓観気経続総戦単団対発変辺歩豊毎亜圧囲売覚楽壊拡挙拠済産実舎獣収従渉焼畳縄壌嬢剰払抜択訳釈駅桜顕県剣綸嶋藪鷲鯨鮎宮獻鶴鳳鵬跡週給結絕統經驗維綱',
);

/** 日文假名 */
const KANA = /[\u3040-\u309f\u30a0-\u30ff]/;

/** 纯外文（拉丁 / 西里尔 / 韩文 / 希腊） */
const FOREIGN_ONLY = /^[\s\u0041-\u024f\u0370-\u03ff\u0400-\u04ff\uac00-\ud7af\u3130-\u318f\u0e00-\u0e7f\d\-–—.,'’"()·:：]+$/;

function loadBooks() {
  const out = [];
  for (const { file, data } of SEED_FILES) {
    for (const raw of Array.isArray(data) ? data : []) out.push({ ...raw, _file: file });
  }
  return out;
}

/** 正常化：去标点空格，用于比较书名是否等价 */
const norm = (s) => String(s ?? '').replace(/[\s《》〈〉·・:：,，.。、\-—－_/\\|()（）[\]【】「」『』!！?？"'“”‘’]/g, '').toLowerCase();

/** 从 ratings.douban.edition（形如「狱门岛 2012」）里取出书名部分 */
function editionTitle(book) {
  const e = book?.ratings?.douban?.edition;
  if (!e) return null;
  return String(e).replace(/\s*\d{4}.*$/, '').trim() || null;
}

function classify(book) {
  const title = String(book.title ?? '');
  const tradChars = [...title].filter((c) => TRADITIONAL.has(c));
  const hasKana = KANA.test(title);
  const foreign = FOREIGN_ONLY.test(title);
  const edTitle = editionTitle(book);
  const edDiffers = edTitle && norm(edTitle) !== norm(title);

  const reasons = [];
  if (tradChars.length) reasons.push(`含繁体字「${[...new Set(tradChars)].join('')}」`);
  if (hasKana) reasons.push('含日文假名');
  if (foreign) reasons.push('纯外文书名');
  if (edDiffers) reasons.push(`豆瓣匹配到《${edTitle}》，与库中书名不同`);

  let grade = null;
  if (tradChars.length || hasKana || foreign) grade = 'A';
  else if (edDiffers) grade = 'B';

  return { grade, reasons, editionTitle: edTitle };
}

function main() {
  const books = loadBooks();
  const rows = books.map((b) => ({ book: b, ...classify(b) })).filter((r) => r.grade);

  const A = rows.filter((r) => r.grade === 'A');
  const B = rows.filter((r) => r.grade === 'B');

  if (AS_JSON) {
    console.log(JSON.stringify({ total: books.length, candidates: rows.length, A, B }, null, 2));
    return;
  }

  console.log('');
  console.log(color('  书名「大陆版优先」核查', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));
  console.log(`  全库 ${books.length} 部，可疑 ${rows.length} 部（A 级 ${A.length} / B 级 ${B.length}）`);
  console.log('');

  if (A.length) {
    console.log(color('  A 级：书名含繁体字 / 假名 / 纯外文（几乎确定不是大陆书名）', C.red + C.bold));
    for (const r of A) {
      console.log(`    ${r.book.id.padEnd(14)} 《${r.book.title}》  —— ${r.reasons.join('；')}`);
    }
    console.log('');
  }
  if (B.length) {
    console.log(color('  B 级：豆瓣匹配到的版本名与库中书名不一致', C.yellow + C.bold));
    for (const r of B) {
      console.log(`    ${r.book.id.padEnd(14)} 《${r.book.title}》 → 豆瓣《${r.editionTitle}》`);
    }
    console.log('');
  }
}

main();
