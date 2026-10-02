/**
 * 图片指纹（第 171 轮）
 * ====================
 * 用途：判断同一部作品的两张封面**是不是同一张图**——用户反馈「有些放了两版的图其实一模一样」，
 * 光比像素字节是没用的（同一张图在不同站点会被重新压成不同尺寸、不同格式），
 * 所以要把图**缩小成 16×16 灰度**再比：这一步会抹掉分辨率、压缩质量与格式的差异，
 * 留下的是「画面构图与明暗」。
 *
 * 为什么用 ffmpeg：库里同时存在 **webp**（豆瓣那批是 webp）与 **jpeg**（微信读书那批），
 * 要在两种格式之间比，就得先解码。项目自身没有图像库，而 ffmpeg 本机可用。
 * **没有 ffmpeg 时这套逻辑整体退化为「不比」**（返回 null），由调用方决定怎么办——
 * 绝不因为缺少工具就误删版本。
 *
 * 用法：
 *   const a = await fingerprintFile('web/covers/x.webp');
 *   const b = await fingerprintBuffer(buf, '.jpg');
 *   similarity(a, b) // 0~1，1 表示画面一致
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const SIZE = 16;

let ffmpegPath = undefined;

/** ffmpeg 在不在（找不到就返回 null，所有指纹函数随之退化为 null） */
export function findFfmpeg() {
  if (ffmpegPath !== undefined) return ffmpegPath;
  const candidates = ['ffmpeg', 'ffmpeg.exe'];
  for (const bin of candidates) {
    try {
      execFileSync(bin, ['-version'], { stdio: 'ignore' });
      ffmpegPath = bin;
      return ffmpegPath;
    } catch {
      /* 换下一个 */
    }
  }
  ffmpegPath = null;
  return ffmpegPath;
}

/** 把任意格式的图片解码成 16×16 灰度指纹（256 字节）；失败返回 null */
function fingerprintVia(buffer, ext = '.img') {
  const bin = findFfmpeg();
  if (!bin) return null;
  const dir = mkdtempSync(path.join(tmpdir(), 'cover-fp-'));
  const input = path.join(dir, `in${ext}`);
  const output = path.join(dir, 'out.raw');
  try {
    writeFileSync(input, buffer);
    execFileSync(
      bin,
      ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-vf', `scale=${SIZE}:${SIZE}`, '-pix_fmt', 'gray', '-f', 'rawvideo', output],
      { stdio: 'ignore' },
    );
    const raw = readFileSync(output);
    if (raw.length !== SIZE * SIZE) return null;
    return new Uint8Array(raw);
  } catch {
    return null;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 临时目录清不掉也不影响结果 */
    }
  }
}

/** 本地文件的指纹 */
export function fingerprintFile(file) {
  try {
    return fingerprintVia(readFileSync(file), path.extname(file) || '.img');
  } catch {
    return null;
  }
}

/** 内存里一段图片字节的指纹（外链版本先下载再指纹） */
export function fingerprintBuffer(buffer, ext = '.jpg') {
  return fingerprintVia(buffer, ext);
}

/**
 * 两张图有多像：0~1。
 *
 * 用「平均灰度差」而不是汉明距离：指纹是 8 位灰度，差一点点的压缩噪声应该在容差里被忽略，
 * 而画面不同（不同封面）的差异会大得多——实测同一张图在不同站点之间平均差 1~4，
 * 不同封面普遍在 25 以上，阈值取 8 有很宽的余量。
 */
export function similarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  const meanDiff = sum / a.length;
  return Math.max(0, 1 - meanDiff / 255);
}

/** 平均灰度差（更直观：同一张图 0~5，不同封面 20+） */
export function meanAbsDiff(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (let i = 0; i < a.length; i += 1) sum += Math.abs(a[i] - b[i]);
  return sum / a.length;
}

/** 两张图是不是同一张（默认容差 8 级灰度） */
export function looksSameImage(a, b, tolerance = 8) {
  if (!a || !b) return false;
  return meanAbsDiff(a, b) <= tolerance;
}

/* ------------------------------------------------------------------ */
/* 更稳一点的判据：梯度指纹（dHash）                                    */
/* ------------------------------------------------------------------ */

/**
 * 为什么还要 dHash：同一部作品的两张封面常常是**同一张画但裁切不同**
 * （豆瓣那张带白边与书脊、微信读书那张是紧裁的电子版封面）。
 * 纯灰度差的判据对此敏感——实测同一张图能差到 9 级灰度，而某些不同封面只差 20 级，
 * 两者挨得太近。dHash 比的是**相邻像素的明暗关系**（结构），裁掉一圈白边几乎不影响它。
 *
 * 返回 15×16 = 240 位的数组（每项 0/1）。
 */
export function dhashFromGray(gray, size = SIZE) {
  if (!gray || gray.length !== size * size) return null;
  const bits = new Uint8Array((size - 1) * size);
  let k = 0;
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size - 1; x += 1) {
      bits[k] = gray[y * size + x] < gray[y * size + x + 1] ? 1 : 0;
      k += 1;
    }
  }
  return bits;
}

/** 两个 dHash 的汉明距离占比（0~1，越小越像） */
export function dhashDistance(a, b) {
  if (!a || !b || a.length !== b.length || !a.length) return 1;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) diff += 1;
  return diff / a.length;
}

/* ------------------------------------------------------------------ */
/* 多裁切指纹：对付「同一张画、裁切不同」                                */
/* ------------------------------------------------------------------ */

/**
 * 同一张封面在不同站点常常**裁切不同**（豆瓣那张带白边与书脊、微信读书那张紧裁）。
 * 只比一种裁切会漏判，所以同一张图算三份指纹：整图、居中裁 90%、居中裁 80%，
 * 比对时取**三组里最像的那一组**。
 */
/**
 * 三档裁切：整图、居中裁 90%、居中裁 80%。
 * 90% 这一档是校准里最关键的一档——「带白边的豆瓣图」与「紧裁的电子版封面」正是在这一档对上的
 * （整图差 18.8%，裁 90% 之后降到 10.0%）。
 */
const CROPS = [1, 0.9, 0.8];

/**
 * 一次 ffmpeg 调用出全部分档的灰度图：每个裁切档是一条 `crop,scale` 链 + 一个输出。
 * （最初是一档一次调用，三档两张图要跑六次；合成一次之后整库判重从小时级降到分钟级。）
 */
function graysVia(buffer, ext) {
  const bin = findFfmpeg();
  if (!bin) return null;
  const dir = mkdtempSync(path.join(tmpdir(), 'cover-fp-'));
  const input = path.join(dir, `in${ext}`);
  const outputs = CROPS.map((_, i) => path.join(dir, `out${i}.raw`));
  try {
    writeFileSync(input, buffer);
    const chains = CROPS.map(
      (c, i) => `[0:v]${c < 1 ? `crop=iw*${c}:ih*${c},` : ''}scale=${SIZE}:${SIZE}[v${i}]`,
    ).join(';');
    const args = ['-hide_banner', '-loglevel', 'error', '-y', '-i', input, '-filter_complex', chains];
    for (const [i, out] of outputs.entries()) {
      args.push('-map', `[v${i}]`, '-pix_fmt', 'gray', '-f', 'rawvideo', out);
    }
    execFileSync(bin, args, { stdio: 'ignore' });
    return outputs.map((out) => {
      try {
        const raw = readFileSync(out);
        return raw.length === SIZE * SIZE ? new Uint8Array(raw) : null;
      } catch {
        return null;
      }
    });
  } catch {
    return null;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* 清不掉临时目录不影响结果 */
    }
  }
}

/** 一组指纹（整图 + 居中裁 82%）；没有 ffmpeg 时返回 null */
export function fingerprintsOfBuffer(buffer, ext = '.jpg') {
  const grays = graysVia(buffer, ext);
  if (!grays || grays.every((g) => !g)) return null;
  return grays.map((g) => ({ gray: g, hash: g ? dhashFromGray(g) : null }));
}

/** 一组指纹（本地文件） */
export function fingerprintsOfFile(file) {
  try {
    return fingerprintsOfBuffer(readFileSync(file), path.extname(file) || '.img');
  } catch {
    return null;
  }
}

/**
 * 两组指纹的「最像程度」：取三组裁切里结构差最小的一组。
 * 返回 { dhash, grayDiff }；任一侧没有指纹时返回 null。
 */
export function compareFingerprints(a, b) {
  if (!a || !b) return null;
  let best = null;
  for (const x of a) {
    if (!x?.hash) continue;
    for (const y of b) {
      if (!y?.hash) continue;
      const d = dhashDistance(x.hash, y.hash);
      if (!best || d < best.dhash) best = { dhash: d, grayDiff: meanAbsDiff(x.gray, y.gray) };
    }
  }
  return best;
}

/**
 * 判定「同一张图」。
 *
 * 阈值是实测校准出来的（见台账 §171）：
 *   · 同一张图（含裁切不同）：结构差 2%~12%
 *   · 不同封面：结构差 19% 起，多数 40% 以上
 * 取 15% 作分界，并要求灰度差也不能太大（防止「结构像但明暗完全不同」的误判）。
 */
export function isSameCover(a, b, { dhashTolerance = 0.15, grayTolerance = 30 } = {}) {
  const cmp = compareFingerprints(a, b);
  if (!cmp) return null; // 没有指纹 → 不下结论
  return cmp.dhash <= dhashTolerance && cmp.grayDiff <= grayTolerance;
}
