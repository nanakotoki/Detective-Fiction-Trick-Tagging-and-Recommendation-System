/**
 * 写权限守卫（第 197 轮）
 * ======================
 * 站点要从「整站密码」（§196）走向「对外公开」。但公开之后，**写接口不能跟着公开**：
 *
 *   POST   /api/books               新增
 *   PUT    /api/books/:id           修改
 *   DELETE /api/books/:id           删除
 *   POST   /api/books/:id/restore   撤销删除
 *   POST   /api/reload              重读数据目录
 *
 * 这五个动作对匿名开放，任何人（或任何爬虫）都能把共享书库灌满垃圾、甚至删书。
 * 第 193 轮的 CSRF 防线只能挡「别的网站借用访客浏览器」，挡不住直接 `curl -X POST`。
 *
 * 三种模式（环境变量 `TRICK_WRITE_MODE`）：
 *
 * | 模式    | 含义                                   | 用在哪            |
 * |---------|----------------------------------------|-------------------|
 * | `open`  | 谁都能写                               | 本机开发/测试      |
 * | `token` | 写请求必须带 `x-admin-token: <令牌>`   | 公网部署用这个     |
 * | `off`   | 一律 403，纯只读站                     | 只给读者看的时候   |
 *
 * **默认值故意这样定**：`NODE_ENV=production` 且什么都没配时退化成 `off`（只读），
 * 而不是 `open`。配漏一个环境变量的代价应该是「管理员暂时写不了」，
 * 不应该是「全世界都能写」。
 *
 * 注意：`/api/recommend` 与 `/api/check` 虽然也是 POST，但它们**只读不写**
 * （拿一本书算标签/算相似度，不落盘），不受这里管——否则读者连推荐都用不了。
 */

import { timingSafeEqual } from 'node:crypto';

export const WRITE_MODES = ['open', 'token', 'off'];
export const TOKEN_HEADER = 'x-admin-token';
export const MIN_TOKEN_LENGTH = 16;

const trim = (value) => String(value ?? '').trim();

/**
 * 从环境变量解析写模式。配置自相矛盾时**直接抛错**——安全开关宁可不启动，也不要猜。
 * @param {Record<string, string | undefined>} [env]
 * @returns {'open' | 'token' | 'off'}
 */
export function resolveWriteMode(env = process.env) {
  const explicit = trim(env.TRICK_WRITE_MODE).toLowerCase();
  const token = trim(env.TRICK_ADMIN_TOKEN);
  const isProd = trim(env.NODE_ENV).toLowerCase() === 'production';

  if (token && token.length < MIN_TOKEN_LENGTH) {
    throw new Error(
      `TRICK_ADMIN_TOKEN 太短（${token.length} 位）：至少 ${MIN_TOKEN_LENGTH} 位。生成一个：openssl rand -hex 24`,
    );
  }

  if (explicit) {
    if (!WRITE_MODES.includes(explicit)) {
      throw new Error(`TRICK_WRITE_MODE 只能是 ${WRITE_MODES.join(' / ')}，收到 ${JSON.stringify(explicit)}`);
    }
    if (explicit === 'token' && !token) {
      throw new Error('TRICK_WRITE_MODE=token 但没有配置 TRICK_ADMIN_TOKEN');
    }
    return explicit;
  }

  // 没显式指定：配了令牌就按令牌模式跑（配置本身就是在表达意图）；否则按环境取默认
  if (token) return 'token';
  return isProd ? 'off' : 'open';
}

/**
 * 这条请求是不是「会改数据」的动作之一。
 * @param {string} method
 * @param {string[]} segments `/api/` 之后的路径段
 */
export function isMutatingRequest(method, segments = []) {
  const [first, , third] = segments;
  if (first === 'books') {
    if (method === 'POST' && segments.length === 1) return true; // 新增
    if (method === 'PUT' && segments.length === 2) return true; // 修改
    if (method === 'DELETE' && segments.length === 2) return true; // 删除
    if (method === 'POST' && segments.length === 3 && third === 'restore') return true; // 撤销删除
  }
  if (first === 'reload' && method === 'POST' && segments.length === 1) return true; // 重读数据
  return false;
}

/** 定长比较，避免"逐字节提前返回"把令牌前缀泄露出去 */
function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) {
    timingSafeEqual(left, left); // 长度不同也走一遍比较，让耗时尽量一致
    return false;
  }
  return timingSafeEqual(left, right);
}

/**
 * 判定这条写请求能不能放行。
 * @param {{ headers?: Record<string, string | string[] | undefined> }} req
 * @param {'open' | 'token' | 'off'} mode
 * @param {string} token
 * @returns {null | { status: number, error: string }} `null` 表示放行
 */
export function checkWrite(req, mode, token) {
  if (mode === 'open') return null;
  if (mode === 'off') {
    return { status: 403, error: '本站在只读模式：不接受写入（TRICK_WRITE_MODE=off）' };
  }
  const given = trim(req.headers?.[TOKEN_HEADER]);
  if (!given) {
    return { status: 401, error: '需要管理员令牌：请带上 x-admin-token（在「添加小说」页输入即可）' };
  }
  if (!safeEqual(given, token)) {
    return { status: 403, error: '管理员令牌不正确' };
  }
  return null;
}

/** 给日志/健康检查用的人话描述 */
export function describeWriteMode(mode) {
  if (mode === 'open') return 'open（谁都能写：仅限本机开发）';
  if (mode === 'token') return 'token（写入需要 x-admin-token 令牌）';
  return 'off（只读：不接受任何写入）';
}
