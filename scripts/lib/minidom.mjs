/**
 * 极简 DOM 实现（仅依赖 node: 内置模块）
 * =====================================
 * 用途：在**没有浏览器**的环境下执行前端视图，验证：
 *   - 应用能启动（bootstrap）
 *   - 路由能真正渲染每一个视图
 *   - 视图里的每一个 querySelector 都能命中真实存在的元素
 *     （这是最重要的一条：视图若选了不存在的节点，浏览器里表现为"点了没反应"）
 *
 * 实现范围：innerHTML 解析、id/class/属性/标签选择器、事件注册与派发、
 *          dataset、closest、表单元素取值。不实现布局、样式计算与事件冒泡细节。
 */

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

/**
 * NodeList 语义。
 *
 * 关键：浏览器的 querySelectorAll 返回的是 **NodeList**，它
 *   - 有 length / 索引访问 / forEach / item()
 *   - 但**没有** addEventListener、value 这些元素属性
 * 代码里 `bind(qsa(...), ...)` 这种写法正是依赖"NodeList 上没有 addEventListener"
 * 而静默跳过的。如果这里返回真数组，这类代码在桩里会抛异常、在浏览器里却正常，
 * 测试就失去了意义。因此这里继承 Array（保留数组便利性）但**不**提供任何元素方法。
 */
export class NodeList extends Array {
  item(index) {
    return this[index] ?? null;
  }
  namedItem() {
    return null;
  }
  static get [Symbol.species]() {
    return Array;
  }
}

/* ------------------------------------------------------------------ */
/* 节点                                                                */
/* ------------------------------------------------------------------ */

class ClassList {
  constructor(el) {
    this.el = el;
    this._set = new Set();
  }
  add(...names) {
    for (const n of names) if (n) this._set.add(n);
    this._sync();
  }
  remove(...names) {
    for (const n of names) this._set.delete(n);
    this._sync();
  }
  toggle(name, force) {
    const want = force === undefined ? !this._set.has(name) : Boolean(force);
    if (want) this._set.add(name);
    else this._set.delete(name);
    this._sync();
    return want;
  }
  contains(name) {
    return this._set.has(name);
  }
  get value() {
    return [...this._set].join(' ');
  }
  _sync() {
    this.el.attributes.class = this.value;
  }
}

export class Element {
  constructor(tagName, ownerDocument) {
    this.tagName = String(tagName).toUpperCase();
    this.ownerDocument = ownerDocument;
    this.attributes = Object.create(null);
    this.childNodes = [];
    this.parentNode = null;
    this._listeners = new Map();
    this._innerHTML = '';
    this._value = '';
    /** 是否用 `el.value = x` 显式设过（决定 value 走属性还是走标签默认值，见下面的 getter） */
    this._valueSet = false;
    this._checked = false;
    this.classList = new ClassList(this);
    this.dataset = new Proxy(
      {},
      {
        get: (_t, key) => {
          const attr = `data-${camelToKebab(String(key))}`;
          return this.attributes[attr];
        },
        set: (_t, key, value) => {
          this.attributes[`data-${camelToKebab(String(key))}`] = String(value);
          return true;
        },
        has: (_t, key) => `data-${camelToKebab(String(key))}` in this.attributes,
        ownKeys: () => Object.keys(this.attributes).filter((k) => k.startsWith('data-')),
        getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
      },
    );
  }

  /* ---------- 属性 ---------- */

  get id() {
    return this.attributes.id ?? '';
  }
  set id(v) {
    this.attributes.id = String(v);
  }

  get className() {
    return this.attributes.class ?? '';
  }
  set className(v) {
    this.attributes.class = String(v);
    this.classList._set = new Set(String(v).split(/\s+/).filter(Boolean));
  }

  getAttribute(name) {
    const key = String(name).toLowerCase();
    if (key === 'class') return this.attributes.class ?? '';
    return key in this.attributes ? this.attributes[key] : null;
  }
  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    this.attributes[key] = String(value);
    if (key === 'class') this.classList._set = new Set(String(value).split(/\s+/).filter(Boolean));
  }
  removeAttribute(name) {
    delete this.attributes[String(name).toLowerCase()];
  }
  hasAttribute(name) {
    return String(name).toLowerCase() in this.attributes;
  }

  /* ---------- 内容 ---------- */

  /**
   * innerHTML getter：**序列化当前子节点**，而不是回吐当初赋值的原始字符串。
   *
   * 这一点非常关键：视图的模板字符串里含有未求值的 `${...}` 占位文本，
   * 若直接把赋值时的字符串返回，测试读到的就是模板源码而非真实 DOM 内容，
   * 会得出"报告没渲染"这类完全错误的结论（这个坑真实踩过一次）。
   */
  get innerHTML() {
    if (this.childNodes.length === 0) return this._innerHTML;
    return this.childNodes.map(serializeNode).join('');
  }
  set innerHTML(markup) {
    this._innerHTML = String(markup ?? '');
    this.childNodes = [];
    if (!this.ownerDocument) return;
    const parsed = parseHTML(this._innerHTML, this.ownerDocument);
    for (const child of parsed) {
      child.parentNode = this;
      this.childNodes.push(child);
    }
    // 解析出的元素按 id 注册进文档索引，供 querySelector 命中
    for (const el of collectElements(this.childNodes)) this.ownerDocument._index(el);
  }

  get textContent() {
    if (this.childNodes.length === 0) return this._innerHTML.replace(/<[^>]*>/g, '');
    return this.childNodes.map((c) => c.textContent ?? '').join('');
  }
  set textContent(value) {
    this._innerHTML = escapeText(String(value ?? ''));
    this.childNodes = [];
  }

  get outerHTML() {
    return serializeNode(this);
  }

  /* ---------- 遍历 ---------- */

  get children() {
    return this.childNodes.filter((n) => n instanceof Element);
  }
  get firstChild() {
    return this.childNodes[0] ?? null;
  }
  get firstElementChild() {
    return this.children[0] ?? null;
  }
  get isConnected() {
    let node = this;
    while (node.parentNode) node = node.parentNode;
    return node === this.ownerDocument?.documentElement || node === this.ownerDocument?.body || node?.tagName === 'HTML' || node?.tagName === 'BODY';
  }

  appendChild(child) {
    child.parentNode = this;
    this.childNodes.push(child);
    if (child instanceof Element) this.ownerDocument?._index(child);
    return child;
  }
  insertBefore(child, ref) {
    child.parentNode = this;
    const at = ref ? this.childNodes.indexOf(ref) : -1;
    if (at === -1) this.childNodes.push(child);
    else this.childNodes.splice(at, 0, child);
    return child;
  }
  removeChild(child) {
    this.childNodes = this.childNodes.filter((c) => c !== child);
    child.parentNode = null;
    return child;
  }
  remove() {
    this.parentNode?.removeChild(this);
    this.parentNode = null;
  }
  contains(other) {
    let node = other;
    while (node) {
      if (node === this) return true;
      node = node.parentNode;
    }
    return false;
  }

  /* ---------- 查询 ---------- */

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] ?? null;
  }
  querySelectorAll(selector) {
    const groups = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
    const out = new NodeList();
    for (const group of groups) {
      for (const el of collectElements(this.childNodes)) {
        if (matches(el, group) && !out.includes(el)) out.push(el);
      }
      // 也允许命中自身（closest 语义）
      if (matches(this, group) && !out.includes(this)) out.push(this);
    }
    return out;
  }
  closest(selector) {
    let node = this;
    while (node) {
      if (node instanceof Element && matches(node, selector)) return node;
      node = node.parentNode;
    }
    return null;
  }
  matches(selector) {
    return matches(this, selector);
  }

  getBoundingClientRect() {
    return { top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
  }

  /* ---------- 表单 ---------- */

  /**
   * `value` 的属性语义（第 123 轮修）。
   *
   * HTML 里 `value="…"` 属性只是**默认值**（defaultValue）：一旦用 `el.value = x`
   * 显式设过，此后读到的就是设进去的那个值，**哪怕设成空串**。
   *
   * 旧写法 `this._value || this.attributes.value` 把空串当成「没设过」，
   * 于是 `input.value = ''` 之后 `input.value` 又变回标签上的默认值——
   * 「清空搜索框」在测试里等于没清。真实浏览器不是这样，这个偏差会**掩盖真 bug**：
   * 知识库的「刷新之后搜索框里总有旧关键词」就是被它挡在测试之外的。
   */
  get value() {
    return this._valueSet ? this._value : this.attributes.value || '';
  }
  set value(v) {
    this._valueSet = true;
    this._value = String(v ?? '');
  }
  get checked() {
    return this._checked || this.hasAttribute('checked');
  }
  set checked(v) {
    this._checked = Boolean(v);
  }

  /* ---------- 事件 ---------- */

  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }
  /** 仅用于测试：直接派发事件 */
  dispatchEvent(event) {
    const evt = { type: event.type, target: this, currentTarget: this, preventDefault() {}, stopPropagation() {}, ...event };
    for (const handler of this._listeners.get(evt.type) ?? []) handler(evt);
    // 向上冒泡到祖先（事件委托依赖这一点）
    let parent = this.parentNode;
    while (parent) {
      for (const handler of parent._listeners?.get(evt.type) ?? []) handler({ ...evt, currentTarget: parent });
      parent = parent.parentNode;
    }
    return true;
  }
  click() {
    this.dispatchEvent({ type: 'click' });
  }
  focus() {}
  blur() {}
  select() {}
}

function camelToKebab(s) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}
function escapeText(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function collectElements(nodes, acc = []) {
  for (const node of nodes) {
    if (node instanceof Element) {
      acc.push(node);
      collectElements(node.childNodes, acc);
    }
  }
  return acc;
}

/* ------------------------------------------------------------------ */
/* 序列化                                                              */
/* ------------------------------------------------------------------ */

const ESCAPE_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
function escapeAttr(value) {
  return String(value ?? '').replace(/[&<>"]/g, (c) => ESCAPE_MAP[c]);
}

/** 把节点序列化回 HTML 字符串（innerHTML / outerHTML 用） */
function serializeNode(node) {
  if (node === null || node === undefined) return '';
  if (!(node instanceof Element)) return String(node.textContent ?? '');

  const tag = node.tagName.toLowerCase();
  let attrs = '';
  for (const [name, value] of Object.entries(node.attributes)) {
    attrs += value === '' ? ` ${name}` : ` ${name}="${escapeAttr(value)}"`;
  }

  if (VOID_TAGS.has(tag)) return `<${tag}${attrs}>`;

  // 原始文本元素（script/style/textarea/title）内容不再转义
  if (RAW_TEXT_TAGS.has(tag) && node.childNodes.length === 0) {
    return `<${tag}${attrs}>${node._innerHTML}</${tag}>`;
  }

  const inner = node.childNodes.map(serializeNode).join('');
  return `<${tag}${attrs}>${inner}</${tag}>`;
}

/* ------------------------------------------------------------------ */
/* 选择器匹配（支持 tag / #id / .class / [attr] / [attr="v"] 及其组合）  */
/* ------------------------------------------------------------------ */

const SIMPLE_RE = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\]/g;

function parseSimple(selector) {
  const parts = [];
  SIMPLE_RE.lastIndex = 0;
  let m;
  while ((m = SIMPLE_RE.exec(selector)) !== null) {
    if (m[1]) parts.push({ kind: 'tag', value: m[1].toLowerCase() });
    else if (m[2]) parts.push({ kind: 'id', value: m[2] });
    else if (m[3]) parts.push({ kind: 'class', value: m[3] });
    else if (m[4]) parts.push({ kind: 'attr', name: m[4].toLowerCase(), op: m[5], value: m[6] ?? '' });
  }
  return parts;
}

function matches(el, selector) {
  // 只支持单个复合选择器（本项目不使用后代选择器做关键查询）
  const selectorText = String(selector).trim().split(/\s+/).pop();
  if (selectorText === '*') return true;
  const parts = parseSimple(selectorText);
  if (!parts.length) return false;

  for (const part of parts) {
    if (part.kind === 'tag' && el.tagName.toLowerCase() !== part.value) return false;
    if (part.kind === 'id' && el.id !== part.value) return false;
    if (part.kind === 'class' && !el.classList.contains(part.value)) return false;
    if (part.kind === 'attr') {
      if (!el.hasAttribute(part.name)) return false;
      if (part.op === '=' && el.getAttribute(part.name) !== part.value) return false;
      if (part.op === '^=' && !String(el.getAttribute(part.name)).startsWith(part.value)) return false;
      if (part.op === '$=' && !String(el.getAttribute(part.name)).endsWith(part.value)) return false;
      if (part.op === '*=' && !String(el.getAttribute(part.name)).includes(part.value)) return false;
    }
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* HTML 解析                                                           */
/* ------------------------------------------------------------------ */

function parseAttrs(text) {
  const attrs = Object.create(null);
  const re = /([a-zA-Z_:][-\w:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const name = m[1].toLowerCase();
    attrs[name] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

/**
 * 把 HTML 片段解析成节点数组。
 *
 * 实现要点：维护一个**节点栈**，子节点直接 append 到栈顶节点上，
 * 父指针只在插入时确定一次，不再另做挂载遍历
 * （早期版本先建树再统一设置 parentNode，两处互相干扰，
 *   导致部分元素被"挂载"时 parentNode 被置为 null）。
 *
 * @param {string} html
 * @param {Document} doc
 */
export function parseHTML(html, doc) {
  const source = String(html ?? '');
  const root = [];
  const stack = []; // 当前打开的祖先元素

  const currentChildren = () => (stack.length ? stack[stack.length - 1].childNodes : root);
  const appendText = (text) => {
    if (!text) return;
    currentChildren().push(new TextNode(text, doc));
  };

  let i = 0;
  while (i < source.length) {
    const lt = source.indexOf('<', i);

    // 没有更多标签：剩下的都是文本
    if (lt === -1) {
      appendText(source.slice(i));
      break;
    }
    appendText(source.slice(i, lt));

    // 注释
    if (source.startsWith('<!--', lt)) {
      const end = source.indexOf('-->', lt);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    // doctype / 其他声明
    if (source.startsWith('<!', lt)) {
      const end = source.indexOf('>', lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    const gt = source.indexOf('>', lt);
    if (gt === -1) {
      appendText(source.slice(lt));
      break;
    }
    const raw = source.slice(lt + 1, gt);
    i = gt + 1;

    // 闭合标签：弹出到匹配的祖先
    if (raw.startsWith('/')) {
      const name = raw.slice(1).trim().toLowerCase().split(/\s/)[0];
      for (let d = stack.length - 1; d >= 0; d -= 1) {
        if (stack[d].tagName.toLowerCase() === name) {
          stack.length = d;
          break;
        }
      }
      continue;
    }

    // 开始标签
    const selfClosing = raw.endsWith('/');
    const spaceAt = raw.search(/[\s/]/);
    const tagName = (spaceAt === -1 ? raw : raw.slice(0, spaceAt)).toLowerCase().replace(/\/$/, '');
    if (!tagName) continue;

    const el = new Element(tagName, doc);
    const attrs = parseAttrs(spaceAt === -1 ? '' : raw.slice(spaceAt));
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);

    // 插入到当前父节点（父指针在这里唯一确定）
    const parent = stack[stack.length - 1];
    if (parent) {
      el.parentNode = parent;
      parent.childNodes.push(el);
    } else {
      el.parentNode = null;
      root.push(el);
    }

    // 原始文本元素：整段吞掉
    if (RAW_TEXT_TAGS.has(tagName) && !selfClosing) {
      const closeTag = `</${tagName}>`;
      const closeAt = source.toLowerCase().indexOf(closeTag, i);
      const inner = closeAt === -1 ? source.slice(i) : source.slice(i, closeAt);
      el._innerHTML = inner;
      i = closeAt === -1 ? source.length : closeAt + closeTag.length;
      continue;
    }

    // 空元素不入栈
    if (!selfClosing && !VOID_TAGS.has(tagName)) stack.push(el);
  }

  return root;
}

class TextNode {
  constructor(text, doc) {
    this.nodeType = 3;
    this.textContent = text;
    this.ownerDocument = doc;
    this.parentNode = null;
  }
  get isConnected() {
    return Boolean(this.parentNode);
  }
}

/* ------------------------------------------------------------------ */
/* Document                                                            */
/* ------------------------------------------------------------------ */

export class Document {
  constructor() {
    this._byId = new Map();
    this._listeners = new Map();
    this.documentElement = new Element('html', this);
    this.head = new Element('head', this);
    this.body = new Element('body', this);
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.title = '';
    this._readyState = 'complete';
  }

  _index(el) {
    if (el.id) this._byId.set(el.id, el);
    for (const child of collectElements(el.childNodes)) {
      if (child.id) this._byId.set(child.id, child);
    }
  }

  createElement(tag) {
    return new Element(tag, this);
  }
  createTextNode(text) {
    return new TextNode(String(text), this);
  }
  getElementById(id) {
    return this._byId.get(id) ?? null;
  }
  querySelector(selector) {
    const text = String(selector).trim();
    /**
     * 仅当选择器是**裸 id**（`#foo`）时才走 id 快速查表。
     *
     * 早期实现是 `if (selector.startsWith('#'))`，于是 `#list .item` 这类
     * 复合选择器会直接把 `#list` 本身返回，**后代部分被静默忽略**——
     * 查询"看起来成功"，拿到却是错误的节点，测试会因此得出错误结论。
     */
    if (/^#[\w-]+$/.test(text)) {
      const found = this._byId.get(text.slice(1));
      if (found) return found;
    }
    return this.documentElement.querySelector(text) ?? this.body.querySelector(text);
  }
  querySelectorAll(selector) {
    const out = new NodeList();
    for (const el of this.documentElement.querySelectorAll(selector)) out.push(el);
    for (const el of this.body.querySelectorAll(selector)) if (!out.includes(el)) out.push(el);
    return out;
  }
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(handler);
  }
  removeEventListener(type, handler) {
    this._listeners.get(type)?.delete(handler);
  }
  dispatchEvent(event) {
    for (const handler of this._listeners.get(event.type) ?? []) handler({ target: this, ...event });
    return true;
  }
  execCommand() {
    return false;
  }
  get activeElement() {
    return this.body;
  }
}

/* ------------------------------------------------------------------ */
/* 安装到 globalThis                                                   */
/* ------------------------------------------------------------------ */

/**
 * 安装一份最小可用的浏览器环境。
 * @param {{ hash?: string, url?: string, html?: string }} [options]
 *   html —— 页面骨架（通常直接读 web/index.html，这样测试跑在**真实结构**上）
 * @returns {{ document: Document, window: object, settle: (ms?: number) => Promise<void>, uninstall: () => void }}
 */
export function installDom(options = {}) {
  const doc = new Document();
  const url = options.url ?? 'http://127.0.0.1:8787/';
  const hash = options.hash ?? '#/analyze';

  const listeners = new Map();
  const localStorageData = new Map();

  // 把页面骨架挂进 body，并建立 id 索引
  if (options.html) {
    const nodes = parseHTML(options.html, doc);
    for (const node of nodes) {
      if (node instanceof Element) doc.body.appendChild(node);
      else doc.body.childNodes.push(node);
    }
    // 递归补索引（parseHTML 只在 appendChild 时索引了顶层）
    const indexAll = (el) => {
      if (el.id) doc._byId.set(el.id, el);
      for (const child of collectElements(el.childNodes)) {
        if (child.id) doc._byId.set(child.id, child);
        indexAll(child);
      }
    };
    indexAll(doc.body);
  }

  const win = {
    document: doc,
    location: { hash, href: `${url}${hash}`, pathname: '/', protocol: 'http:', origin: url.replace(/\/$/, '') },
    matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
    addEventListener(type, handler) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(handler);
    },
    removeEventListener(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    dispatchEvent(event) {
      for (const handler of listeners.get(event.type) ?? []) handler(event);
      return true;
    },
    scrollTo() {},
    scrollY: 0,
    print() {},
    localStorage: {
      getItem: (k) => (localStorageData.has(k) ? localStorageData.get(k) : null),
      setItem: (k, v) => localStorageData.set(k, String(v)),
      removeItem: (k) => localStorageData.delete(k),
      clear: () => localStorageData.clear(),
    },
    confirm: () => true,
    alert() {},
    getComputedStyle: () => ({ getPropertyValue: () => '' }),
    URL: globalThis.URL,
  };

  const saved = {};
  const define = (name, value) => {
    saved[name] = Object.getOwnPropertyDescriptor(globalThis, name);
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };

  /**
   * `history` 桩（第 123 轮补）。
   *
   * 知识库视图的 `syncUrl()` 用 `history.replaceState` 把筛选写回地址栏——
   * **不加历史记录、也不触发 `hashchange`**（浏览器语义如此，正因如此才不会
   * 「敲一个字整页重绘一次」）。桩必须照这个语义来：只改 `location.hash`，
   * 不派发事件；否则测试里的行为与真机不一致，测了等于没测。
   */
  win.history = {
    replaceState(_state, _title, url) {
      if (typeof url === 'string' && url.includes('#')) win.location.hash = url.slice(url.indexOf('#'));
    },
    pushState(_state, _title, url) {
      if (typeof url === 'string' && url.includes('#')) win.location.hash = url.slice(url.indexOf('#'));
    },
    back() {},
    forward() {},
  };

  define('document', doc);
  define('window', win);
  define('location', win.location);
  define('history', win.history);
  define('navigator', { clipboard: { writeText: async () => {} } });
  define('localStorage', win.localStorage);
  define('MutationObserver', class {
    observe() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  });
  define('FileReader', class {});
  define('requestAnimationFrame', (fn) => setTimeout(() => fn(Date.now()), 0));
  define('cancelAnimationFrame', (id) => clearTimeout(id));
  define('confirm', () => true);
  define('matchMedia', win.matchMedia);

  /**
   * FormData 桩。
   * Node 内置的 FormData 构造函数要求真实的 HTMLFormElement，
   * 传入桩元素会抛 "Argument 1 could not be converted to: undefined"。
   * 这里按表单内带 name 的控件收集键值，行为与浏览器一致。
   */
  define(
    'FormData',
    class FormDataStub {
      constructor(form) {
        this._data = new Map();
        if (!form || typeof form.querySelectorAll !== 'function') return;
        for (const control of form.querySelectorAll('[name]')) {
          const name = control.getAttribute('name');
          if (!name) continue;
          const type = (control.getAttribute('type') ?? '').toLowerCase();
          if (type === 'checkbox' || type === 'radio') {
            if (control.checked) this._data.set(name, control.value);
            continue;
          }
          this._data.set(name, control.value);
        }
      }
      get(name) {
        return this._data.has(name) ? this._data.get(name) : null;
      }
      has(name) {
        return this._data.has(name);
      }
      set(name, value) {
        this._data.set(String(name), String(value));
      }
      append(name, value) {
        this._data.set(String(name), String(value));
      }
      delete(name) {
        this._data.delete(name);
      }
      getAll(name) {
        return this._data.has(name) ? [this._data.get(name)] : [];
      }
      *entries() {
        yield* this._data.entries();
      }
      *keys() {
        yield* this._data.keys();
      }
      *values() {
        yield* this._data.values();
      }
      forEach(fn, thisArg) {
        for (const [k, v] of this._data) fn.call(thisArg, v, k, this);
      }
      [Symbol.iterator]() {
        return this._data.entries();
      }
    },
  );

  return {
    document: doc,
    window: win,
    /** 让挂起的微任务/定时器跑完 */
    async settle(ms = 60) {
      for (let i = 0; i < 4; i += 1) {
        await new Promise((r) => setTimeout(r, ms));
      }
    },
    uninstall() {
      for (const [name, descriptor] of Object.entries(saved)) {
        if (descriptor) Object.defineProperty(globalThis, name, descriptor);
        else delete globalThis[name];
      }
    },
  };
}
