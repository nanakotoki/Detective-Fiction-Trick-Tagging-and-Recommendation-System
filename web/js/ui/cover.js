/**
 * 封面渲染与「版本一览」（第 166 轮起，第 169 轮扩成多版本）
 * ======================================================
 * 库里的封面是**本地文件**，放在 `web/covers/`：
 *   · `<作品 id>.webp`                —— **主图**，取豆瓣上最新的一版，书卡与档案页大图都用它；
 *   · `<作品 id>-<豆瓣条目 id>.webp`   —— **其他版本**，只在档案页的「版本一览」里出现。
 * 有哪些版本、每版的出版年与出版社，在 `data/covers-editions.json` 里（按需加载，不进启动包）。
 *
 * 两条取舍：
 *   1. **没有封面时不发任何请求**，直接画本地占位图——若改成「先试着加载、失败再兜底」，
 *      全库几百部缺封面的作品会让每页控制台刷一串 404；
 *   2. 「看大图」优先用豆瓣的 `l` 档（1080px）**按需**加载，失败（离线／被挡）就退回本地这张 s 档 ——
 *      既不把上百 MB 的大图塞进仓库，也不至于点开只有 270px。
 */

import { COVER_PLACEHOLDER, coverCredit, coverUrl } from '../core/covers.js';
import { html, modal, qs, raw } from './dom.js';

/** 把豆瓣的 s 档图片地址换成 l 档（同一张图的大图），失败时前端会退回本地文件 */
function toLargePic(url) {
  return String(url || '').replace('/view/subject/s/', '/view/subject/l/');
}

/** 本地版本图片地址：主图是 `<id>.webp`，其他版本是 `<id>-<条目 id>.webp` */
export function editionUrl(bookId, edition) {
  const file = edition?.file || `${bookId}.webp`;
  return new URL(`../../covers/${file}`, import.meta.url).href;
}

/**
 * 一个版本的图片地址。
 *
 * 只有本地文件的版本（豆瓣来的）走 `web/covers/`；
 * **只存链接的版本**（微信读书来的，`remote: true`）直接用对方 CDN 的地址——
 * 那条 CDN 允许直接外链（实测无 referer 也 200），所以几百 MB 的电子版封面不必进仓库。
 */
export function editionImage(bookId, edition) {
  if (edition?.remote) return edition.pic || COVER_PLACEHOLDER;
  return edition?.file ? new URL(`../../covers/${edition.file}`, import.meta.url).href : coverUrl(bookId) || COVER_PLACEHOLDER;
}

/**
 * 一块封面。
 *
 * @param {object} book 作品记录
 * @param {{size?: 'card'|'hero'|'mini', link?: boolean, badge?: boolean}} [options]
 *   size：卡片缩略图 / 详情页大图 / 列表小图；link：是否点封面进详情页；badge：是否标出版年
 */
export function coverBlock(book, options = {}) {
  const { size = 'card', link = true, badge = size !== 'mini' } = options;
  const url = coverUrl(book.id);
  const credit = coverCredit(book.id);
  const year = credit?.year || '';
  const alt = url ? `《${book.title}》封面` : `暂未找到《${book.title}》的封面`;
  const img = html`<img
    class="cover-img"
    src="${url || COVER_PLACEHOLDER}"
    alt="${alt}"
    loading="lazy"
    decoding="async"
    width="270"
    height="400"
  />`;
  const cls = `cover cover-${size}${url ? '' : ' cover-none'}`;
  const title = url ? `《${book.title}》${year ? ` · ${year} 年版` : ''}` : `《${book.title}》暂未找到封面`;
  /** 出版年角标：用户要求「标上出版日期」，一眼能看出这张图是哪个版本 */
  const yearTag = badge && year ? html`<span class="cover-year">${year}</span>` : '';
  if (!link) {
    return html`<div class="${cls}" title="${title}" data-cover-open="${encodeURIComponent(book.id)}">
      ${img}${yearTag}
    </div>`;
  }
  return html`<a
    class="${cls}"
    href="#/book/${encodeURIComponent(book.id)}"
    title="${title}"
    tabindex="-1"
    aria-hidden="true"
    >${img}${yearTag}</a
  >`;
}

/**
 * 详情页「封面来源」一行。
 *
 * 这一行的意义不在好看，而在**可复核**：点进那条豆瓣条目就能看到同一张图与同一版信息，
 * 弱链接（只按题名吻合）会明说自己是弱链接。
 */
export function coverCreditLine(book) {
  const credit = coverCredit(book.id);
  if (!credit) {
    return html`<p class="cover-credit">
      封面：<span class="muted">暂未找到（已试过豆瓣检索与条目页）</span>
    </p>`;
  }
  const year = credit.year ? ` · ${credit.year} 年版` : '';
  const inner = credit.subjectId
    ? html`<a href="${credit.url}" target="_blank" rel="noopener noreferrer">豆瓣条目 ${credit.subjectId}</a>`
    : html`<span>豆瓣</span>`;
  return html`<p class="cover-credit">封面：${inner}${year} · ${credit.how}</p>`;
}

/* ------------------------------------------------------------------ */
/* 版本一览                                                            */
/* ------------------------------------------------------------------ */

let editionsPromise = null;

/**
 * 按需加载版本清单（`data/covers-editions.json`）。
 *
 * 用 fetch 而不是编进启动模块：这份文件会随版本数增长，而知识库列表、标签页等页面根本用不到。
 * 取不到（离线／静态托管没带上 data/）就返回空表——**页面少一块「版本一览」，但不该报错**。
 */
export function loadEditions() {
  if (!editionsPromise) {
    const url = new URL('../../../data/covers-editions.json', import.meta.url);
    editionsPromise = fetch(url)
      .then((res) => (res.ok ? res.json() : null))
      .catch(() => null);
  }
  return editionsPromise;
}

/**
 * 某部作品的版本清单（含本地图片地址与「哪个是主图／哪个是本库所收」）。
 * 返回 `null` 表示**清单没读到**（离线／静态托管没带 data/），返回 `[]` 表示
 * 「读到了，但这部作品只有已存的那一版」——两者在页面上给的话不一样。
 */
export async function editionsOf(bookId) {
  const data = await loadEditions();
  if (!data) return null;
  const list = data?.books?.[bookId] || [];
  return list.map((e) => ({
    ...e,
    url: editionImage(bookId, e),
    // 大图：本地版去豆瓣取 l 档；只存链接的版本本来就有大图档（微信读书 t9_）
    largeUrl: e.remote ? e.largePic || e.pic || '' : e.pic ? toLargePic(e.pic) : '',
  }));
}

/**
 * 点开看大图：一个能左右翻版本的灯箱。
 *
 * 大图优先走豆瓣的 `l` 档（按需加载、失败自动退回本地 s 档），所以仓库里不必存大图。
 */
export function openCoverViewer(book, editions, startIndex = 0) {
  if (!editions.length) return;
  let index = Math.min(Math.max(0, startIndex), editions.length - 1);

  const renderBody = () => {
    const e = editions[index];
    const collected = e.collected ? ' · 本库所收版本' : '';
    const publisher = [e.publisher, e.translator ? `${e.translator} 译` : ''].filter(Boolean).join(' · ');
    const source = e.remote ? ` · 封面来自${e.source || '微信读书'}` : '';
    return html`
      <div class="cover-viewer">
        <div class="cover-viewer-stage">
          <img class="cover-viewer-img" src="${e.url}" alt="《${book.title}》${e.year || ''} 版封面" />
        </div>
        <div class="cover-viewer-meta">
          <strong>《${book.title}》</strong>
          <p class="small">${e.year ? `${e.year} 年版` : '出版年未标'}${publisher ? ` · ${publisher}` : ''}${raw(collected)}</p>
          <p class="small muted">
            第 ${String(index + 1)} / ${String(editions.length)} 版${e.primary ? ' · 封面用的是这一版' : ''}${raw(source)}
            ${e.subjectId ? raw(html` · <a href="${e.remote ? `https://weread.qq.com/web/search/global?keyword=${encodeURIComponent(book.title)}` : `https://book.douban.com/subject/${e.subjectId}/`}" target="_blank" rel="noopener noreferrer">${e.remote ? '微信读书' : `豆瓣条目 ${e.subjectId}`}</a>`) : ''}
          </p>
        </div>
      </div>
    `;
  };

  const { close, root } = modal({
    title: `封面 · 《${book.title}》`,
    body: renderBody(),
    actions: [
      {
        label: '◀ 上一版',
        variant: 'btn-ghost',
        close: false,
        onClick: () => {
          index = (index - 1 + editions.length) % editions.length;
          repaint();
        },
      },
      {
        label: '下一版 ▶',
        variant: 'btn-ghost',
        close: false,
        onClick: () => {
          index = (index + 1) % editions.length;
          repaint();
        },
      },
      { label: '关闭' },
    ],
  });

  /** 重画当前版本；顺便把大图接上（加载失败就留着本地那张） */
  function repaint() {
    const body = qs('.modal-body', root);
    if (!body) return;
    body.innerHTML = renderBody();
    upgradeToLarge(body);
  }

  /**
   * 试着把 `s` 档换成 `l` 档大图：换成功就替换，失败（离线／豆瓣防盗链）保持本地图不动。
   * 用 `new Image()` 预加载而不是直接换 `src`，避免用户先看到一张裂图。
   */
  function upgradeToLarge(scope) {
    const img = qs('.cover-viewer-img', scope || root);
    const big = editions[index].largeUrl;
    if (!img || !big) return;
    // 非浏览器环境（视图测试用的 DOM 桩）没有 Image，跳过大图升级即可
    if (typeof Image === 'undefined') return;
    const probe = new Image();
    probe.onload = () => {
      if (img.isConnected) img.src = big;
    };
    probe.src = big;
  }

  const onKey = (event) => {
    if (!root.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (event.key === 'ArrowLeft') {
      index = (index - 1 + editions.length) % editions.length;
      repaint();
    } else if (event.key === 'ArrowRight') {
      index = (index + 1) % editions.length;
      repaint();
    }
  };
  document.addEventListener('keydown', onKey);
  upgradeToLarge(root);
  return { close, root };
}

/**
 * 档案页的「版本一览」：每个版本一张小图 + 出版年 + 出版社，点开看大图。
 *
 * @param {object} book
 * @param {Array} editions `editionsOf()` 的结果
 */
export function renderEditionGallery(book, editions) {
  if (!editions.length) {
    return html`<p class="muted">豆瓣上这部作品没有关联到其他版本，暂时只有这一张封面。</p>`;
  }  return html`
    <p class="small muted" style="margin-bottom:var(--space-3)">
      共保存 ${String(editions.length)} 个版本的封面（外面显示的是<strong>最新的一版</strong>）；
      点任意一张可以<strong>看大图</strong>，也能左右翻版本。
    </p>
    <div class="edition-grid">
      ${editions.map(
        (e, i) => html`
          <button
            type="button"
            class="edition-card${e.primary ? ' is-primary' : ''}"
            data-edition-index="${String(i)}"
            title="看大图：${e.year || '出版年未标'}${e.publisher ? ` · ${e.publisher}` : ''}"
          >
            <img src="${e.url}" alt="《${book.title}》${e.year || ''} 版封面" loading="lazy" decoding="async" />
            <span class="edition-meta">
              <span class="edition-year">${e.year || '出版年未标'}</span>
              ${e.publisher ? html`<span class="edition-pub">${e.publisher}</span>` : ''}
              ${e.translator ? html`<span class="edition-pub">${e.translator} 译</span>` : ''}
              ${e.primary ? html`<span class="badge badge-ok">封面用这版</span>` : ''}
              ${e.collected ? html`<span class="badge">本库所收</span>` : ''}
              ${e.remote ? html`<span class="badge">${e.source || '微信读书'}</span>` : ''}
            </span>
          </button>
        `,
      )}
    </div>
  `;
}
