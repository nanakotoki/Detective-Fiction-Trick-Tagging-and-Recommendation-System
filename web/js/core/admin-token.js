/**
 * 管理员令牌的存取（第 197 轮）
 * ============================
 * 站点公开后，写权限由服务端的 `TRICK_WRITE_MODE=token` 守着
 * （见 `server/lib/write-guard.mjs`）：新增/修改/删除必须带 `x-admin-token`。
 * 令牌只存在**使用者自己的浏览器**里，换台设备要重新输一次。
 *
 * 为什么不把令牌写进前端代码：那等于把令牌发给每一个访客——
 * 前端拿到就等于公开，写权限也就跟没设一样了。
 */

const TOKEN_KEY = 'dftr:adminToken:v1';

/** localStorage 不可用（隐私模式 / 禁用存储）时退回内存，至少本次会话能用 */
const memory = { token: '' };

/** @returns {string} 已保存的令牌；没有就是空串 */
export function readAdminToken() {
  try {
    const stored = globalThis.localStorage?.getItem(TOKEN_KEY);
    if (typeof stored === 'string') return stored;
  } catch {
    /* 隐私模式：读不了就走内存 */
  }
  return memory.token;
}

/** 保存令牌；传空串等于清除 */
export function saveAdminToken(token) {
  const value = String(token ?? '').trim();
  memory.token = value;
  try {
    if (value) globalThis.localStorage?.setItem(TOKEN_KEY, value);
    else globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    /* 存不进去也不影响本次会话 */
  }
  return value;
}

export function clearAdminToken() {
  saveAdminToken('');
}

export function hasAdminToken() {
  return readAdminToken().length > 0;
}
