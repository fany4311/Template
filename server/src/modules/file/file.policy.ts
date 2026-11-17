import {
  ALLOWED_EXTENSIONS,
  MAX_FILE_SIZE,
  MAX_FILES_PER_REQUEST,
} from './file.constants.js';
import { extOf } from './file.security.js';

/**
 * 收件策略（accept policy）。
 *
 * 分两层，这是为本项目后续「Excel 导入学员」这类场景预留的机制，**当前不实现业务**：
 *
 * - **全局策略**：底座默认允许的扩展名 / 大小 / 数量（file.constants.ts）
 * - **业务覆盖**：业务模块向 `FileBizRegistry` 注册时给出更严的子集
 *   例：`{ bizType: 'studentImport', accept: { extensions: ['xlsx'], maxSize: 5MB } }`
 *
 * 合并规则是**取交集、取更小值** —— 业务只能收紧不能放宽。默认拒绝优于默认放行：
 * 放宽权限的错误只在生产暴露，收紧的错误在联调时立刻暴露。
 */
export interface FileAcceptPolicy {
  /** 允许的扩展名（小写、不含点）；缺省沿用全局白名单 */
  extensions?: readonly string[];
  /** 单文件大小上限（字节）；缺省沿用全局上限 */
  maxSize?: number;
  /** 单次请求最多文件数；缺省沿用全局上限 */
  maxFiles?: number;
}

/** 合并后的策略（所有字段都有值，可直接用于校验） */
export interface ResolvedAcceptPolicy {
  extensions: ReadonlySet<string>;
  maxSize: number;
  maxFiles: number;
}

/** 全局策略：没有业务上下文时（先上传、后绑定）使用 */
export function resolveGlobalAcceptPolicy(): ResolvedAcceptPolicy {
  return {
    extensions: ALLOWED_EXTENSIONS,
    maxSize: MAX_FILE_SIZE,
    maxFiles: MAX_FILES_PER_REQUEST,
  };
}

/**
 * 合并业务覆盖与全局策略。
 *
 * 只收紧：`maxSize` / `maxFiles` 取较小值，`extensions` 取交集。
 * 业务给出空扩展名数组视为「不允许任何文件」而不是「不限制」—— fail-closed。
 */
export function resolveAcceptPolicy(
  override?: FileAcceptPolicy,
): ResolvedAcceptPolicy {
  const global = resolveGlobalAcceptPolicy();
  if (!override) return global;

  const extensions = override.extensions
    ? new Set(
        override.extensions
          .map((ext) => ext.toLowerCase().replace(/^\./, ''))
          .filter((ext) => global.extensions.has(ext)),
      )
    : global.extensions;

  return {
    extensions,
    maxSize: Math.min(override.maxSize ?? global.maxSize, global.maxSize),
    maxFiles: Math.min(override.maxFiles ?? global.maxFiles, global.maxFiles),
  };
}

/** 扩展名是否被策略接受 */
export function acceptsExtension(
  policy: ResolvedAcceptPolicy,
  filename: string,
): boolean {
  const ext = extOf(filename);
  return !!ext && policy.extensions.has(ext);
}
