/**
 * DOM 工具集
 * 所有视图统一用「模板字符串 + html`` 转义」的方式构建，避免 innerHTML 注入口子。
 */

/** HTML 转义 */
export function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** 可信 HTML 的标记键 */
const RAW = Symbol('dsh.raw');

/**
 * 安全 HTML 字符串。
 *
 * 继承 String，因此可以像普通字符串一样使用（includes / slice / === 比较等），
 * 但带有 RAW 标记，插入到另一个 html`` 中时**不会被二次转义**。
 *
 * 这一点很关键：html`` 是**可组合**的——
 *     html`<ul>${items.map((i) => html`<li>${i}</li>`)}</ul>`
 * 若 html`` 返回普通字符串，内层结果会被外层当成用户输入再转义一遍。
 *
 * 另外重写了 join()：`items.map(htmlFn).join('')` 是最自然的写法，
 * 若 join 之后 RAW 标记丢失，同一份代码"加不加 join 结果不同"，
 * 会变成极难排查的陷阱（真实踩过：页面上直接显示出一大段 HTML 源码）。
 * 因此 join 的结果仍然是 SafeHtml。
 */
class SafeHtml extends String {
  get [RAW]() {
    return true;
  }

  /** 拼接后仍保持可信标记，避免 `.map(html``).join('')` 被外层转义 */
  join(separator = ',') {
    return new SafeHtml(super.join(separator));
  }
}

/**
 * 标签模板函数：自动转义插值内容，且可安全嵌套。
 * 用法：
 *     html`<p>${userInput}</p>`                        普通插值会被转义
 *     html`<div>${raw(systemGeneratedHtml)}</div>`     可信 HTML 原样输出
 *     html`<ul>${list.map((x) => html`<li>${x}</li>`)}</ul>`   数组自动逐项处理
 */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((str, i) => {
    out += str;
    if (i < values.length) out += stringify(values[i]);
  });
  return new SafeHtml(out);
}

/** 是否为带 RAW 标记的可信 HTML */
function isRaw(value) {
  return value !== null && typeof value === 'object' && (value[RAW] === true || value.__raw === true);
}

/**
 * 把插值转换成 HTML 字符串。
 *
 * 关键点：**必须递归处理**
 *   - 数组要逐项处理（否则 Array.prototype.toString 会把元素拼成 [object Object]）
 *   - 嵌套的可信 HTML 要原样透出，且允许无限层级嵌套
 * 早期版本没有递归也没有 SafeHtml 标记，导致两处真实缺陷：
 *   `raw(...)` 放进数组显示成「[object Object]」；嵌套 html`` 被二次转义。
 */
function stringify(value, depth = 0) {
  if (value === null || value === undefined || value === false) return '';
  if (typeof value === 'string') return esc(value);
  if (typeof value === 'number' || typeof value === 'bigint') return esc(value);
  if (Array.isArray(value)) {
    if (depth > 20) return '';
    return value.map((item) => stringify(item, depth + 1)).join('');
  }
  // 可信 HTML：原样输出（内容由本系统生成）
  if (isRaw(value)) return String(value.value ?? value);
  return esc(value);
}

/**
 * 标记一段字符串为「可信 HTML」，在 html`` 中不会被转义。
 *
 * 返回的对象带有 toString / valueOf / Symbol.toPrimitive，因此：
 *   ✅ html`<div>${raw(x)}</div>`            —— 直接插值，原样输出
 *   ✅ html`<div>${[raw(a), raw(b)]}</div>`  —— 放进数组，递归处理
 *   ✅ container.innerHTML = raw(x).toString() 等显式取字符串的场合
 *
 *   ⚠️ html`<div>${[raw(a), raw(b)].join('')}</div>`
 *      虽然不会显示 [object Object]（toString 已实现），但 join 之后 RAW 标记丢失，
 *      结果会被**转义**显示成 &lt;span&gt;。这是刻意的安全设计：
 *      若拼接后的字符串自动可信，就等于开了一个绕过转义的后门。
 *      正确写法是把数组直接交给插值，或用 raw(...) 显式再包一层。
 */
export function raw(value) {
  const text = String(value ?? '');
  return {
    [RAW]: true,
    __raw: true,
    value: text,
    toString() {
      return text;
    },
    valueOf() {
      return text;
    },
    [Symbol.toPrimitive]() {
      return text;
    },
  };
}

/** 把 HTML 字符串渲染进容器 */
export function render(container, markup) {
  if (!container) return null;
  container.innerHTML = markup;
  return container;
}

/** querySelector 简写 */
export function qs(selector, scope = document) {
  return scope.querySelector(selector);
}

/**
 * querySelectorAll 简写（返回真数组，便于 map/filter）。
 * 注意：返回的是数组，没有 addEventListener —— 需要绑事件请用 onAll() 或 bindAll()。
 */
export function qsa(selector, scope = document) {
  return [...scope.querySelectorAll(selector)];
}

/**
 * 判断是否为「元素集合」。
 * 兼容真数组（qsa 的返回值）与 NodeList / HTMLCollection。
 */
export function isCollection(value) {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return true;
  const type = typeof value;
  const isIterable = type === 'object' && typeof value[Symbol.iterator] === 'function';
  // 元素本身也可能有 length（如 <form>.length），但不会是可迭代的，故先排除
  return isIterable || (type === 'object' && typeof value.length === 'number' && typeof value.nodeType !== 'number');
}

/**
 * 给「一个元素或一组元素」绑定事件，返回统一的解绑函数。
 *
 * 这个函数的存在是为了修掉一类真实缺陷：把 qsa() 的结果直接传给
 * `el.addEventListener(...)`，在浏览器里会抛
 * "target.addEventListener is not a function" 并导致整个视图渲染失败。
 *
 * @param {Element|Iterable<Element>|null} target
 * @param {string} event
 * @param {Function} handler
 * @returns {() => void} 解绑函数
 */
export function onAll(target, event, handler) {
  if (!target) return () => {};

  // 集合：逐个绑定
  if (isCollection(target)) {
    const offs = [...target].filter(Boolean).map((el) => onAll(el, event, handler));
    return () => {
      for (const off of offs) off();
    };
  }

  // 单个元素
  if (typeof target.addEventListener !== 'function') return () => {};
  target.addEventListener(event, handler);
  return () => target.removeEventListener(event, handler);
}

/** 事件委托 */
export function delegate(root, eventName, selector, handler) {
  if (!root) return () => {};
  const listener = (event) => {
    const target = event.target.closest(selector);
    if (target && root.contains(target)) handler(event, target);
  };
  root.addEventListener(eventName, listener);
  return () => root.removeEventListener(eventName, listener);
}

/* ------------------------------------------------------------------ */
/* Toast                                                              */
/* ------------------------------------------------------------------ */

const TOAST_ICONS = { ok: '✓', error: '✕', warn: '!', info: 'i' };

/**
 * 弹出提示。
 * @param {string} message
 * @param {{ type?: 'ok'|'error'|'warn'|'info', duration?: number, title?: string }} [options]
 */
export function toast(message, options = {}) {
  const { type = 'info', duration = 3600, title = '' } = options;
  const stack = qs('#toast-stack');
  if (!stack) return () => {};

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.innerHTML = html`
    <span aria-hidden="true" style="font-weight:700">${TOAST_ICONS[type] ?? 'i'}</span>
    <span style="min-width:0">
      ${title ? raw(`<strong style="display:block">${esc(title)}</strong>`) : ''}
      <span>${message}</span>
    </span>
  `;
  stack.appendChild(el);

  const close = () => {
    if (!el.isConnected) return;
    el.classList.add('hide');
    setTimeout(() => el.remove(), 220);
  };
  const timer = setTimeout(close, duration);
  el.addEventListener('click', () => {
    clearTimeout(timer);
    close();
  });
  return close;
}

/* ------------------------------------------------------------------ */
/* 模态框                                                             */
/* ------------------------------------------------------------------ */

/**
 * 打开模态框。
 * @param {{ title: string, body: string, actions?: Array<{label:string, variant?:string, onClick?:Function, close?:boolean}>, width?: string }} options
 * @returns {{ close: Function, root: HTMLElement }}
 */
export function modal(options) {
  const { title, body, actions = [{ label: '关闭', variant: 'btn-ghost' }] } = options;

  const backdrop = document.createElement('div');
  backdrop.className = 'modal-backdrop';
  backdrop.innerHTML = html`
    <div class="modal" role="dialog" aria-modal="true" aria-label="${title}">
      <div class="modal-head">${title}</div>
      <div class="modal-body">${raw(body)}</div>
      <div class="modal-foot"></div>
    </div>
  `;

  const foot = qs('.modal-foot', backdrop);
  const close = () => {
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    // 测试环境的 DOM 桩里 body 没有 style（真实浏览器里一定有），故用可选链兜一下
    document.body?.style?.removeProperty?.('overflow');
  };

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `btn ${action.variant ?? ''}`;
    btn.textContent = action.label;
    btn.addEventListener('click', () => {
      const result = action.onClick?.({ close, root: backdrop });
      if (action.close !== false && result !== false) close();
    });
    foot.appendChild(btn);
  }

  const onKey = (event) => {
    if (event.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  backdrop.addEventListener('click', (event) => {
    if (event.target === backdrop) close();
  });

  document.body.appendChild(backdrop);
  if (document.body.style) document.body.style.overflow = 'hidden';
  qs('button, input, textarea, select', backdrop)?.focus();

  return { close, root: backdrop };
}

/* ------------------------------------------------------------------ */
/* 剪贴板                                                             */
/* ------------------------------------------------------------------ */

/**
 * 复制文本到剪贴板，带降级方案（file:// 与旧浏览器）。
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function copyText(text) {
  try {
    if (navigator.clipboard && globalThis.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* 继续走降级方案 */
  }

  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------ */
/* 下载                                                               */
/* ------------------------------------------------------------------ */

/** 触发浏览器下载 */
export function download(filename, content, mime = 'text/plain;charset=utf-8') {
  const blob = content instanceof Blob ? content : new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/* ------------------------------------------------------------------ */
/* 其它                                                               */
/* ------------------------------------------------------------------ */

/** 防抖 */
export function debounce(fn, wait = 220) {
  let timer = null;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), wait);
  };
}

/** 格式化时间戳 */
export function formatTime(iso, { withTime = true } = {}) {
  if (!iso) return '—';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return withTime ? `${ymd} ${pad(date.getHours())}:${pad(date.getMinutes())}` : ymd;
}

/** 生成安全的文件名 */
export function safeFilename(name, ext = 'md') {
  const base = String(name ?? 'report')
    .replace(/[\\/:*?"<>|]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return `${base || 'report'}.${ext}`;
}

/** 滚动到元素 */
export function scrollToEl(el, offset = 80) {
  if (!el) return;
  const top = el.getBoundingClientRect().top + window.scrollY - offset;
  window.scrollTo({ top, behavior: 'smooth' });
}

/** 主题读写 */
export function applyStoredTheme() {
  let theme = null;
  try {
    theme = localStorage.getItem('dftr:theme');
  } catch {
    theme = null;
  }
  if (!theme) {
    theme = globalThis.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  }
  document.documentElement.dataset.theme = theme;
  return theme;
}

export function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try {
    localStorage.setItem('dftr:theme', next);
  } catch {
    /* ignore */
  }
  return next;
}
