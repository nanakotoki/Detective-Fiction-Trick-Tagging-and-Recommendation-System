/**
 * 应用入口 —— 路由、外壳状态与视图挂载
 * =====================================
 * 视图按需动态加载（代码分割），首屏只加载诡计分析所需的模块。
 */

import { store } from './core/store.js';
import {
  applySensitiveAttributes,
  isSensitive,
  loadSensitiveMode,
  onSensitiveChange,
  setSensitive,
  toggleSensitive,
} from './core/sensitive.js';
import { applyStoredTheme, qs, qsa, toast, toggleTheme } from './ui/dom.js';
import { scrollKey, shouldRestoreScroll } from './core/scroll-memory.js';

/** 路由表 */
const ROUTES = {
  analyze: { title: '诡计分析', load: () => import('./views/analyze.js') },
  library: { title: '知识库', load: () => import('./views/library.js') },
  countries: { title: '作者国别', load: () => import('./views/countries.js') },
  authors: { title: '作者总览', load: () => import('./views/authors.js') },
  tags: { title: '标签体系', load: () => import('./views/tags.js') },
  compare: { title: '作品对比', load: () => import('./views/compare.js') },
  manage: { title: '添加小说', load: () => import('./views/manage.js') },
  book: { title: '书籍档案', load: () => import('./views/book.js') },
  about: { title: '关于本系统', load: () => import('./views/about.js') },
};

const DEFAULT_ROUTE = 'analyze';
const BASE_TITLE = '推理小说诡计标签分析与推荐系统';

/** 解析 location.hash → { name, params } */
export function parseHash(hash = location.hash) {
  const clean = String(hash ?? '').replace(/^#\/?/, '');
  const [pathPart, queryPart] = clean.split('?');
  const segments = pathPart.split('/').filter(Boolean);
  const name = segments[0] || DEFAULT_ROUTE;
  const params = Object.fromEntries(new URLSearchParams(queryPart ?? ''));
  return { name: ROUTES[name] ? name : DEFAULT_ROUTE, segments, params };
}

function navigate(path) {
  const next = path.startsWith('#') ? path : `#/${path.replace(/^\//, '')}`;
  if (location.hash === next) renderRoute();
  else location.hash = next;
}

/* ------------------------------------------------------------------ */
/* 应用上下文                                                          */
/* ------------------------------------------------------------------ */

const state = {
  currentView: null,
  dispose: null,
};

const ctx = {
  store,
  navigate,
  toast,
  /** 当前视图的局部状态容器（视图重绘时保留） */
  memory: new Map(),

  /** 触发当前视图重绘 */
  refresh() {
    renderRoute({ keepScroll: true });
  },

  /** 重新加载数据源后重绘 */
  async reloadData() {
    await store.reload();
    renderRoute({ keepScroll: true });
  },

  /** 更新顶部状态角标与页脚统计 */
  updateStatus() {
    const status = store.status();
    const chip = qs('#store-status');
    if (chip) {
      chip.dataset.mode = status.mode;
      const text = qs('.status-text', chip);
      if (text) {
        text.textContent =
          status.mode === 'api'
            ? `服务器模式 · ${status.total} 本`
            : `本地模式 · ${status.total} 本`;
      }
      chip.title =
        status.mode === 'api'
          ? `数据保存于服务器（所有访问者共享）。最近同步：${status.lastSyncedAt ?? '—'}`
          : '数据保存在本机浏览器。如需多人共享与服务器持久化，请运行 npm start 启动后端。';
    }

    const footer = qs('#footer-stats');
    if (footer) {
      const modeLabel = status.mode === 'api' ? '服务器模式' : '本地模式';
      footer.textContent = `知识库收录 ${status.total} 部作品${status.userBooks ? `（含自建 ${status.userBooks} 部）` : ''} · ${modeLabel}`;
    }
  },
};

/* ------------------------------------------------------------------ */
/* 路由渲染                                                            */
/* ------------------------------------------------------------------ */

let renderToken = 0;

/**
 * 每条路由记住的滚动位置（第 187 轮）。
 *
 * 用户反馈：「知识库翻到很后面，点进一本书，看完返回就回到最上面了，又得重新翻。」
 * 这里负责把位置记下来，并在**回到原来那条列表**时还回去；判断条件住在
 * `core/scroll-memory.js`（纯函数，带单测）。
 */
const scrollMemory = new Map();
/** 上一次真正渲染出来的路由（记忆键 + 视图名），用来判断「从哪来、到哪去」 */
let lastRendered = { key: null, view: null };
/** 浏览器前进／后退会把 popstate 置起（hashchange 紧随其后），据此区分「往回走」与「主动点导航」 */
let pendingPop = false;

async function renderRoute({ keepScroll = false } = {}) {
  const token = ++renderToken;
  const route = parseHash();
  const main = qs('#main');
  if (!main) return;

  const routeKey = scrollKey(location.hash);
  const prev = lastRendered;
  // 离开之前先把位置记下来；详情页本身不留位置（不会有人指望返回详情页时停在半路）
  if (prev.key && prev.view && prev.view !== 'book') scrollMemory.set(prev.key, window.scrollY);
  const savedScroll = scrollMemory.get(routeKey);
  const restoreScroll = shouldRestoreScroll({
    prevView: prev.view,
    prevKey: prev.key,
    nextView: route.name,
    nextKey: routeKey,
    isPop: pendingPop,
    saved: savedScroll ?? null,
  });
  pendingPop = false;

  // 卸载上一个视图，释放事件监听
  try {
    state.dispose?.();
  } catch (error) {
    console.error('[app] 视图卸载异常', error);
  }
  state.dispose = null;

  // 顶部导航高亮
  const navKey = route.name === 'book' ? 'library' : route.name;
  for (const link of qsa('.mainnav a')) {
    if (link.dataset.nav === navKey) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }

  const scrollY = window.scrollY;
  const definition = ROUTES[route.name];

  // 敏感模式横幅常驻在 #main 之外（见 index.html），
  // 这样重绘视图不会把它冲掉，也不会引起横幅闪烁。
  const banner = qs('.sensitive-banner');
  if (banner) banner.setAttribute('aria-hidden', String(!isSensitive()));

  main.innerHTML = `
    <div class="loading-placeholder">
      <div class="spinner" aria-hidden="true"></div>
      <p>正在加载「${definition.title}」…</p>
    </div>`;

  try {
    // 注意：加载函数在 ROUTES[route.name].load 上，route 本身只是
    // parseHash() 解析出的 { name, segments, params }，不含 load。
    const mod = await definition.load();
    if (token !== renderToken) return; // 已被更新的导航取代

    if (typeof mod?.render !== 'function') {
      throw new Error(`视图模块「${route.name}」没有导出 render() 函数`);
    }

    const result = await mod.render({ ...ctx, route, main });
    if (token !== renderToken) return;

    if (typeof result === 'function') state.dispose = result;
    else if (result && typeof result.dispose === 'function') state.dispose = result.dispose;

    state.currentView = route.name;
    document.title = `${definition.title} · ${BASE_TITLE}`;
    if (keepScroll) {
      window.scrollTo({ top: scrollY, behavior: 'auto' });
    } else if (restoreScroll) {
      /**
       * 回到原来那条列表：把偏移还回去。补一次 rAF 再定位一次——
       * 封面是懒加载的，首帧里部分卡片还没撑开高度，只定位一次可能差几十像素。
       */
      window.scrollTo({ top: savedScroll, behavior: 'auto' });
      globalThis.requestAnimationFrame?.(() => window.scrollTo({ top: savedScroll, behavior: 'auto' }));
    } else {
      window.scrollTo({ top: 0, behavior: 'auto' });
    }
    lastRendered = { key: routeKey, view: route.name };
  } catch (error) {
    if (token !== renderToken) return;
    console.error('[app] 视图渲染失败', error);
    main.innerHTML = `
      <div class="notice notice-error">
        <strong>页面加载失败</strong>
        <p>${String(error?.message ?? error)}</p>
        <p class="small">如果是模块加载错误，请确认通过 HTTP 访问本页（例如运行 <code>npm start</code> 后打开 http://127.0.0.1:8787）。直接双击 index.html（file://）会因浏览器安全策略无法加载 ES 模块。</p>
      </div>`;
    toast(String(error?.message ?? error), { type: 'error', title: '渲染失败' });
  }
}

/**
 * 把写模式贴到 `<body>` 上（第 197 轮）。
 *
 * 站点从"整站密码"走向"对外开放"之后，写权限改成两种：`token`（要管理员令牌）
 * 与 `off`（纯只读）。这里负责把状态摆到 DOM 上：
 *   · `data-write-mode` —— 服务端给的模式（open / token / off），信息性
 *   · `data-write-ui`   —— 当前这个访客该不该看到写入口（令牌模式下没存过令牌就是 hidden）
 *
 * 视图内部的写按钮则各自按 `store.showWriteUi` 决定渲染与否。
 *
 * 导出是为了测试能直接驱动它（视图测试里会临时把 store 切到只读态）。
 */
export function applyWriteMode() {
  const body = document.body;
  if (!body?.dataset) return;
  body.dataset.writeMode = store.readOnly ? 'off' : store.writeMode;
  body.dataset.writeUi = store.showWriteUi ? 'show' : 'hidden';
}

/** 同步开关按钮的视觉与无障碍状态 */function syncSensitiveSwitch() {
  const btn = qs('#sensitive-toggle');
  if (!btn) return;
  btn.setAttribute('aria-checked', String(isSensitive()));
  btn.title = isSensitive()
    ? '敏感模式已开启：不显示任何诡计标签与分析信息。点击切回普通模式。'
    : '开启敏感模式：连诡计标签都不显示，只保留书名、简介、评价与阅读提示，完全不必担心被剧透。';
}

/* ------------------------------------------------------------------ */
/* 启动                                                                */
/* ------------------------------------------------------------------ */

async function bootstrap() {
  applyStoredTheme();
  loadSensitiveMode();
  applySensitiveAttributes();

  qs('#theme-toggle')?.addEventListener('click', () => {
    const theme = toggleTheme();
    toast(theme === 'dark' ? '已切换到深色主题' : '已切换到浅色主题', { type: 'info', duration: 1600 });
  });

  // 敏感模式开关：放在顶栏常驻，普通模式下也可见，随时可切
  qs('#sensitive-toggle')?.addEventListener('click', () => {
    const on = toggleSensitive();
    toast(
      on
        ? '已开启敏感模式：诡计标签与分析信息全部隐藏，你可以放心浏览。'
        : '已切回普通模式：重新显示诡计标签与匹配依据。',
      { type: on ? 'ok' : 'info', duration: 3600, title: on ? '敏感模式' : '普通模式' },
    );
  });
  syncSensitiveSwitch();

  // 模式变化时重绘当前视图（渲染结果随模式不同而不同）
  onSensitiveChange(() => {
    syncSensitiveSwitch();
    renderRoute({ keepScroll: true });
  });

  window.addEventListener('popstate', () => {
    // 浏览器前进／后退：这是「往回走」，应当把原来的位置还回去
    pendingPop = true;
  });
  window.addEventListener('hashchange', () => renderRoute());

  // 键盘快捷键：/ 聚焦搜索，g 系列导航
  document.addEventListener('keydown', (event) => {
    const tag = document.activeElement?.tagName ?? '';
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.activeElement?.isContentEditable;
    if (event.key === '/' && !typing) {
      const search = qs('#global-search') ?? qs('input[type="search"]');
      if (search) {
        event.preventDefault();
        search.focus();
        search.select?.();
      }
    }
  });

  try {
    await store.init();
  } catch (error) {
    console.error('[app] 知识库初始化失败', error);
  }

  applyWriteMode();

  ctx.updateStatus();
  store.subscribe((event) => {
    if (event === 'change') ctx.updateStatus();
  });

  if (!location.hash) location.hash = `#/${DEFAULT_ROUTE}`;
  await renderRoute();
}

bootstrap();
