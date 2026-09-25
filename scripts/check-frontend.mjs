/**
 * 前端模块图检查
 * ==============
 * 无浏览器环境下，用 Node 直接加载每一个前端模块，抓出：
 *   - 语法错误
 *   - import 路径错误
 *   - 顶层立即执行代码里对 document / window 的非法访问
 * 并在 jsdom 不可用时，用最小 DOM 桩验证 views 模块的导出结构。
 *
 * 运行：node scripts/check-frontend.mjs
 */

import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT, 'web');

const C = { reset: '\u001b[0m', bold: '\u001b[1m', dim: '\u001b[2m', red: '\u001b[31m', green: '\u001b[32m', yellow: '\u001b[33m', cyan: '\u001b[36m' };
const color = (t, c) => (process.stdout.isTTY ? `${c}${t}${C.reset}` : String(t));

/** 递归收集 web/js 下的所有 .js */
function collect(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, acc);
    else if (entry.name.endsWith('.js')) acc.push(full);
  }
  return acc;
}

/** 极简 DOM 桩：足够让模块顶层代码不抛错，也能读取 querySelector 返回 null */
function installDomStub() {
  const noop = () => {};
  const makeEl = () => ({
    style: {},
    dataset: {},
    classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    children: [],
    appendChild: noop,
    removeChild: noop,
    remove: noop,
    addEventListener: noop,
    removeEventListener: noop,
    setAttribute: noop,
    removeAttribute: noop,
    getAttribute: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    closest: () => null,
    focus: noop,
    click: noop,
    select: noop,
    innerHTML: '',
    textContent: '',
    value: '',
    isConnected: true,
  });

  globalThis.document = {
    documentElement: { dataset: {} },
    body: makeEl(),
    head: makeEl(),
    createElement: makeEl,
    createTextNode: makeEl,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: noop,
    removeEventListener: noop,
    getElementById: () => null,
    execCommand: () => false,
  };
  globalThis.window = {
    matchMedia: () => ({ matches: false, addEventListener: noop, removeEventListener: noop }),
    addEventListener: noop,
    removeEventListener: noop,
    scrollTo: noop,
    scrollY: 0,
    location: { hash: '', href: 'http://localhost/' },
    print: noop,
    localStorage: undefined,
  };
  globalThis.MutationObserver = class {
    observe() {}
    disconnect() {}
  };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.FileReader = class {};
  globalThis.FormData = class {
    get() {
      return null;
    }
  };
  // Node 18+ 已把 navigator / location 定义为只读存取器，需要用 defineProperty 覆盖
  const define = (name, value) => {
    try {
      Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
    } catch {
      /* 某些环境不允许覆盖，忽略即可 */
    }
  };

  define('document', globalThis.document);
  define('window', globalThis.window);
  define('location', globalThis.window.location);
  define('navigator', { clipboard: null });
  define('MutationObserver', globalThis.MutationObserver);
  define('requestAnimationFrame', globalThis.requestAnimationFrame);
  define('FileReader', globalThis.FileReader);
  define('FormData', globalThis.FormData);
  define('confirm', () => false);
}

async function main() {
  installDomStub();

  const files = collect(path.join(WEB_DIR, 'js')).sort();
  const failures = [];

  console.log('');
  console.log(color('  前端模块图检查', C.bold));
  console.log(color('  ────────────────────────────────────────────', C.dim));
  console.log(`  待检查模块 ${files.length} 个`);
  console.log('');

  const coreFiles = files.filter((f) => f.includes(`${path.sep}core${path.sep}`));
  const viewFiles = files.filter((f) => f.includes(`${path.sep}views${path.sep}`));
  const uiFiles = files.filter((f) => f.includes(`${path.sep}ui${path.sep}`));

  const load = async (file, { expectExports = [] } = {}) => {
    const rel = path.relative(WEB_DIR, file).replace(/\\/g, '/');
    try {
      const mod = await import(pathToFileURL(file).href);
      const missing = expectExports.filter((name) => !(name in mod));
      if (missing.length) {
        failures.push({ file: rel, reason: `缺少导出：${missing.join(', ')}` });
        console.log(`  ${color('✗', C.red)} ${rel} —— 缺少导出：${missing.join(', ')}`);
      } else {
        console.log(`  ${color('✓', C.green)} ${rel}${color(`  (${Object.keys(mod).length} 个导出)`, C.dim)}`);
      }
      return mod;
    } catch (error) {
      failures.push({ file: rel, reason: error.message });
      console.log(`  ${color('✗', C.red)} ${rel}`);
      console.log(`      ${color(error.message, C.red)}`);
      return null;
    }
  };

  console.log(color('  core（浏览器与 Node 共用）', C.dim));
  for (const file of coreFiles) await load(file);

  console.log('');
  console.log(color('  ui', C.dim));
  for (const file of uiFiles) await load(file, { expectExports: ['html', 'esc', 'render', 'toast', 'modal', 'copyText', 'download'] });

  console.log('');
  console.log(color('  views（按需加载）', C.dim));
  for (const file of viewFiles) await load(file, { expectExports: ['render'] });

  // app.js 会自启动（bootstrap），动态 import 会触发 DOM 操作，这里只做「不执行」的语法检查
  console.log('');
  console.log(color('  入口与全量语法检查', C.dim));
  const appPath = path.join(WEB_DIR, 'js', 'app.js');

  /**
   * 不执行地编译 ESM 源码。
   * 优先用 vm.SourceTextModule（需 --experimental-vm-modules）；
   * 该标志默认关闭，因此退化方案是派生一个带标志的子进程来编译目标文件。
   */
  const syntaxCheck = (file, rel) => {
    const source = fs.readFileSync(file, 'utf8');
    if (typeof vm.SourceTextModule === 'function') {
      // eslint-disable-next-line no-new
      new vm.SourceTextModule(source, { identifier: rel });
      return null;
    }

    const probe = `
      const vm = require('node:vm');
      const fs = require('node:fs');
      const source = fs.readFileSync(process.argv[1], 'utf8');
      new vm.SourceTextModule(source, { identifier: process.argv[2] });
    `;
    const result = spawnSync(process.execPath, ['--experimental-vm-modules', '--no-warnings', '-e', probe, file, rel], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (result.status === 0) return null;
    return (result.stderr ?? '').trim().split('\n').slice(0, 6).join('\n');
  };

  let syntaxFailures = 0;
  for (const file of [...files, appPath]) {
    const rel = path.relative(WEB_DIR, file).replace(/\\/g, '/');
    const error = syntaxCheck(file, rel);
    if (error) {
      syntaxFailures += 1;
      failures.push({ file: rel, reason: `语法错误：${error}` });
      console.log(`  ${color('✗', C.red)} ${rel} —— ${error}`);
    }
  }
  if (!syntaxFailures) {
    console.log(`  ${color('✓', C.green)} 全部 ${files.length + 1} 个模块语法检查通过（含 js/app.js，未执行 bootstrap）`);
  }

  // 检查 HTML 中引用的资源是否都存在
  console.log('');
  console.log(color('  index.html 资源引用', C.dim));
  const htmlPath = path.join(WEB_DIR, 'index.html');
  const htmlSource = fs.readFileSync(htmlPath, 'utf8');
  const refs = [...htmlSource.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith('http') && !r.startsWith('#'));
  for (const ref of refs) {
    const target = path.join(WEB_DIR, ref);
    if (fs.existsSync(target)) {
      console.log(`  ${color('✓', C.green)} ${ref}`);
    } else {
      failures.push({ file: 'index.html', reason: `引用的资源不存在：${ref}` });
      console.log(`  ${color('✗', C.red)} ${ref} —— 文件不存在`);
    }
  }

  // 检查 data/books 下的文件能否被前端静态加载（路径正确性）
  console.log('');
  console.log(color('  数据文件可达性', C.dim));
  // 种子清单是自动生成的，JSON 引用集中在 seed-files.js 中
  const seedFilesPath = path.join(WEB_DIR, 'js', 'core', 'seed-files.js');
  if (!fs.existsSync(seedFilesPath)) {
    failures.push({ file: 'js/core/seed-files.js', reason: '种子清单不存在，请运行 npm run gen:seed' });
    console.log(`  ${color('✗', C.red)} js/core/seed-files.js —— 不存在（请运行 npm run gen:seed）`);
  } else {
    const seedSource = fs.readFileSync(seedFilesPath, 'utf8');
    const seedRefs = [...seedSource.matchAll(/from '([^']+\.json)'/g)].map((m) => m[1]);
    if (!seedRefs.length) {
      failures.push({ file: 'js/core/seed-files.js', reason: '清单中没有任何 JSON 引用' });
      console.log(`  ${color('✗', C.red)} js/core/seed-files.js —— 没有登记任何数据文件`);
    }
    for (const ref of seedRefs) {
      const target = path.resolve(path.join(WEB_DIR, 'js', 'core'), ref);
      if (fs.existsSync(target)) {
        console.log(`  ${color('✓', C.green)} ${path.relative(ROOT, target).replace(/\\/g, '/')}`);
      } else {
        failures.push({ file: 'js/core/seed-files.js', reason: `引用的数据文件不存在：${ref}` });
        console.log(`  ${color('✗', C.red)} ${ref} —— 文件不存在`);
      }
    }

    // 反向检查：data/books 下有文件却没被登记
    const booksDir = path.join(ROOT, 'data', 'books');
    if (fs.existsSync(booksDir)) {
      const onDisk = fs.readdirSync(booksDir).filter((f) => f.endsWith('.json') && !f.startsWith('_'));
      const registered = new Set(seedRefs.map((r) => path.basename(r)));
      const missing = onDisk.filter((f) => !registered.has(f));
      for (const file of missing) {
        failures.push({ file: 'data/books', reason: `${file} 未被种子清单登记（运行 npm run gen:seed 可修复）` });
        console.log(`  ${color('✗', C.red)} ${file} —— 未被清单登记`);
      }
      if (!missing.length) console.log(`  ${color('✓', C.green)} 清单与 data/books/ 完全同步（${onDisk.length} 个文件）`);
    }
  }

  console.log('');
  if (failures.length) {
    console.log(color(`  ✗ 发现 ${failures.length} 个问题`, C.red + C.bold));
    for (const f of failures) console.log(`    ${color('✗', C.red)} ${f.file} —— ${f.reason}`);
    console.log('');
    process.exit(1);
  }
  console.log(color('  ✓ 前端模块图完整，所有模块均可加载', C.green + C.bold));
  console.log('');
}

main().catch((error) => {
  console.error(color(`\n✗ 检查脚本异常：${error.stack ?? error.message}\n`, C.red));
  process.exit(1);
});
