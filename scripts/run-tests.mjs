#!/usr/bin/env node
/**
 * 测试入口
 * ========
 * 说明：`node --test` 与 run({ files }) 都会为每个测试文件派生一个子进程，而部分受限
 * 沙箱环境禁止管道形式的进程派生（spawn EPERM）。本入口直接 import 测试模块，让用例
 * 注册到**同一进程**的根测试运行器，再用无参 run() 执行——既保留标准 node:test 写法与
 * 报告输出，又不依赖子进程，任何环境都能跑。
 *
 * 运行：node scripts/run-tests.mjs   或   npm test
 */

import { run } from 'node:test';
import { spec } from 'node:test/reporters';

const TEST_MODULES = ['./test-core.mjs'];

for (const mod of TEST_MODULES) {
  await import(mod);
}

const stream = run({ concurrency: 1, timeout: 30_000 });

let failures = 0;
stream.on('test:fail', (data) => {
  // 同进程 run() 会为「测试文件」这一虚拟节点额外发出一次 fail 事件
  // （name 形如 scripts\test-core.mjs，且不带 testType）。只统计真正的测试用例。
  const isTestCase = typeof data?.testType === 'string' && data.testType.length > 0;
  if (!isTestCase) return;
  failures += 1;
});

stream.compose(spec).pipe(process.stdout);

stream.on('end', () => {
  process.exitCode = failures > 0 ? 1 : 0;
});
