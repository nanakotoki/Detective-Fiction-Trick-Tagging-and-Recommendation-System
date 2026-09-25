/**
 * JSON 文件持久化
 * ================
 * 零依赖实现：原子写入（先写临时文件再重命名）+ 进程内串行队列，
 * 避免并发写入导致数据损坏。
 */

import fs from 'node:fs/promises';
import path from 'node:path';

export class JsonStore {
  /**
   * @param {string} filePath
   * @param {*} initial 文件不存在时的初始内容
   */
  constructor(filePath, initial = null) {
    this.filePath = filePath;
    this.initial = initial;
    this.queue = Promise.resolve();
  }

  /** 读取；文件不存在时返回 initial 的深拷贝 */
  async read() {
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return this.initial === null ? null : structuredClone(this.initial);
      }
      if (error instanceof SyntaxError) {
        throw new Error(`数据文件损坏（JSON 解析失败）：${this.filePath}`);
      }
      throw error;
    }
  }

  /** 原子写入，串行执行 */
  async write(data) {
    const run = async () => {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      const payload = `${JSON.stringify(data, null, 2)}\n`;
      await fs.writeFile(tmp, payload, 'utf8');
      await fs.rename(tmp, this.filePath);
      return data;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  /** 读取-修改-写入（在队列内完成，保证一致性） */
  async update(mutator) {
    const run = async () => {
      const current = await this.read();
      const next = await mutator(current);
      if (next === undefined) return current;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(tmp, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
      await fs.rename(tmp, this.filePath);
      return next;
    };
    this.queue = this.queue.then(run, run);
    return this.queue;
  }

  async exists() {
    try {
      await fs.access(this.filePath);
      return true;
    } catch {
      return false;
    }
  }
}
