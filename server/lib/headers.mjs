/**
 * 安全响应头与跨源策略（第 193 轮）
 * ================================
 * 背景：用户部署前问了一句「我们这个网站的安全性如何」。自查除了查出「谜底保险库能从
 * `/data/**` 下走」那个真漏（§192），还顺手把**浏览器侧的两层默认防线**补齐了：
 *
 *   1. **CORS 不再是 `*`**。原来是 `access-control-allow-origin: *` + 无鉴权，
 *      等于「任何网站都能从访客的浏览器里往这台服务写数据」——同源请求根本不需要 CORS 头，
 *      所以默认**一个都不发**；真要跨源（例如前端放 3000、接口放 8787）得显式
 *      `--cors http://localhost:3000` 或环境变量 `DSH_CORS_ORIGINS` 白名单。
 *   2. **状态变更请求要过同源检查**（CSRF）。CORS 只挡「读响应」，挡不住「发请求」——
 *      一个 `<form>` 或 `fetch(..., {mode:'no-cors'})` 依然能把 POST 打到本机服务上。
 *      所以 POST/PUT/DELETE 若带了 `Origin`/`Referer` 且与请求 Host 不同源，直接 403。
 *      浏览器一定会带 Origin，而 curl／脚本通常不带——于是「浏览器里被别的站点借用」被挡住，
 *      而命令行工具照常可用。
 *   3. **一组安全响应头**（CSP 等）。CSP 里把封面要用到的两个外部图床显式列进 `img-src`：
 *      豆瓣 CDN（`*.doubanio.com`）与微信读书 CDN（`cdn.weread.qq.com`、
 *      `*.image.myqcloud.com` 等）——**不加就会把「点开看大图」和版本一览的外链封面全掐掉**。
 */

/** 封面可能用到的外部图床（豆瓣 = 大图／版本图；微信读书 = 只存链接的版本图） */
const IMAGE_HOSTS = [
  'https://*.doubanio.com',
  'https://cdn.weread.qq.com',
  'https://res.weread.qq.com',
  'https://rescdn.qqmail.com',
  'https://*.image.myqcloud.com',
  'https://*.file.myqcloud.com',
];

/** 内容安全策略：只允许同源脚本，图片额外放行上面两个图床 */
function contentSecurityPolicy() {
  return [
    "default-src 'self'",
    "script-src 'self'",
    // 样式里大量使用 style="…" 属性（书卡、报告、灯箱都靠它），必须允许内联样式
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${IMAGE_HOSTS.join(' ')}`,
    "font-src 'self'",
    // 前端只与同源接口打交道（/api/**、/data/covers-editions.json）
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

/**
 * 每个响应都该带的安全头。
 * @param {import('node:http').IncomingMessage} [req]
 */
export function securityHeaders(req = null) {
  const headers = {
    'content-security-policy': contentSecurityPolicy(),
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    // 出站链接（豆瓣条目、微信读书）不需要知道我们看了哪一页
    'referrer-policy': 'no-referrer',
    'permissions-policy': 'geolocation=(), camera=(), microphone=(), payment=()',
  };
  // 只在确实走 HTTPS 时声明 HSTS（TLS 一般由反代终结，所以看转发头）
  const proto = String(req?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim().toLowerCase();
  if (proto === 'https') headers['strict-transport-security'] = 'max-age=15552000; includeSubDomains';
  return headers;
}

/** 解析允许的跨源来源（`--cors a,b` 或 `DSH_CORS_ORIGINS=a,b`），默认空 = 只允许同源 */
export function parseAllowedOrigins(argv = [], env = {}) {
  const fromArgv = (() => {
    const i = argv.indexOf('--cors');
    return i >= 0 ? String(argv[i + 1] ?? '') : '';
  })();
  const raw = [fromArgv, env.DSH_CORS_ORIGINS ?? ''].filter(Boolean).join(',');
  return raw
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);
}

/** 请求来源（Origin 优先，其次 Referer 的源），拿不到返回 '' */
export function originOf(req) {
  const origin = String(req?.headers?.origin ?? '').trim();
  if (origin) return origin.replace(/\/+$/, '');
  const referer = String(req?.headers?.referer ?? '').trim();
  if (!referer) return '';
  try {
    return new URL(referer).origin;
  } catch {
    return '';
  }
}

/** 请求自己的源（据 Host 拼出来；没有 Host 时按本机处理） */
export function selfOrigin(req) {
  const host = String(req?.headers?.host ?? '').trim();
  if (!host) return '';
  const proto = String(req?.headers?.['x-forwarded-proto'] ?? '').split(',')[0].trim() || 'http';
  return `${proto}://${host}`;
}

/** 这个来源被允许吗（同源，或在显式白名单里） */
export function isAllowedOrigin(origin, req, allowedOrigins = []) {
  if (!origin) return true; // 非浏览器客户端（curl／脚本）不带 Origin
  const self = selfOrigin(req);
  if (self && origin === self) return true;
  return allowedOrigins.includes(origin);
}

/**
 * 只在该发的时候发 CORS 头：**别再用 `*`**。
 * 同源请求浏览器根本不看这些头，所以默认返回空对象。
 */
export function corsHeaders(req, allowedOrigins = []) {
  const origin = String(req?.headers?.origin ?? '').trim();
  if (!origin) return {};
  if (!allowedOrigins.includes(origin.replace(/\/+$/, ''))) return {};
  return {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}
