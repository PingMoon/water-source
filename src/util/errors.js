/**
 * errors.js —— 统一错误类型
 *
 * 为什么要单独一个文件：调用方需要区分「输入不合法」「违反不变量」「IO 失败」
 * 三类，才能决定是拒绝、重试还是告警。混成一个 Error 就只能靠字符串匹配。
 */

export class WhaleError extends Error {
  constructor(code, message, detail = null) {
    super(message);
    this.name = 'WhaleError';
    this.code = code;
    this.detail = detail;
  }
}

/** 输入不合法（调用方传错东西） */
export class ValidationError extends WhaleError {
  constructor(message, detail) { super('validation', message, detail); this.name = 'ValidationError'; }
}

/** 违反不变量（架构层禁止的事被尝试了） */
export class InvariantError extends WhaleError {
  constructor(message, detail) { super('invariant', message, detail); this.name = 'InvariantError'; }
}

/** 存储层失败（磁盘、锁、损坏） */
export class StoreError extends WhaleError {
  constructor(message, detail) { super('store', message, detail); this.name = 'StoreError'; }
}
