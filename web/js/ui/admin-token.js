/**
 * 管理员令牌弹窗（第 197 轮）
 * ==========================
 * 只在一种情况下出现：站点开着令牌模式（`TRICK_WRITE_MODE=token`），
 * 而这次写入被服务端以 401 拒了——也就是"没带令牌"或"令牌不对"。
 *
 * 为什么用回调而不是 Promise：弹窗可以被 ESC / 点背景 / 取消按钮关掉，
 * 若返回 Promise，那几条路径不 resolve 就会永远挂着，调用方再也等不到结果。
 */

import { html, modal, qs } from './dom.js';
import { clearAdminToken, readAdminToken, saveAdminToken } from '../core/admin-token.js';

/**
 * 弹一个令牌输入框。
 * @param {object} options
 * @param {string} [options.reason] 一句"为什么要令牌"，显示在弹窗里
 * @param {(token: string) => void} [options.onSaved] 保存后回调（通常用来重试刚才那一步）
 * @param {() => void} [options.onCleared] 清除令牌后回调
 * @returns {{ close: () => void, root: HTMLElement }}
 */
export function promptAdminToken({ reason = '', onSaved, onCleared } = {}) {
  const saved = readAdminToken();

  const body = html`
    <p>这一步需要 <b>管理员令牌</b>${reason ? `：${reason}` : '。'}</p>
    <label class="field">
      <span>令牌</span>
      <input
        type="password"
        name="admin-token"
        autocomplete="off"
        spellcheck="false"
        placeholder="粘贴维护者给你的令牌"
      />
    </label>
    <p class="small muted">令牌只保存在你这台浏览器里，不会发给别人。${saved ? '（当前已保存过一个，可直接覆盖）' : ''}</p>
  `;

  const actions = [
    {
      label: '保存并重试',
      variant: 'btn-primary',
      close: false,
      onClick: ({ close, root }) => {
        const input = qs('input[name="admin-token"]', root);
        const value = String(input?.value ?? '').trim();
        if (!value) {
          input?.focus?.();
          return false; // 空输入：不关窗，让用户继续填
        }
        saveAdminToken(value);
        close();
        onSaved?.(value);
        return false;
      },
    },
  ];

  if (saved) {
    actions.push({
      label: '清除已保存的令牌',
      variant: 'btn-danger',
      close: false,
      onClick: ({ close }) => {
        clearAdminToken();
        close();
        onCleared?.();
        return false;
      },
    });
  }

  return modal({ title: '管理员令牌', body, actions });
}
