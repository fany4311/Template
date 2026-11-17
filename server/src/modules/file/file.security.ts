import { FileTypeValidator, FileValidator } from '@nestjs/common';
import {
  ALLOWED_EXTENSIONS,
  ALLOWED_MIME_PATTERN,
  FORBIDDEN_EXTENSIONS,
  TEXT_CONTENT_BLOCKLIST,
  TEXT_EXTENSIONS,
} from './file.constants.js';

/** 从原始文件名取小写扩展名（不含点）；无扩展名返回 '' */
export function extOf(filename: string): string {
  const base = basename(filename);
  const idx = base.lastIndexOf('.');
  if (idx <= 0 || idx === base.length - 1) return '';
  return base.slice(idx + 1).toLowerCase();
}

/**
 * 取文件名最后一段（同时兼容 `/` 与 `\`）。
 *
 * 浏览器在部分老版本会带上完整路径（Windows 的 `C:\Users\x\a.pdf`），
 * 不处理会把路径写进标题。
 */
export function basename(filename: string): string {
  const normalized = filename.replace(/\\/g, '/');
  const idx = normalized.lastIndexOf('/');
  return idx === -1 ? normalized : normalized.slice(idx + 1);
}

/** 文件名清洗：去路径、去控制字符、压缩空白、限长 */
export function sanitizeFileName(filename: string): string {
  const base = basename(filename)
    // 控制字符（含换行）会破坏 Content-Disposition 头
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!base || base === '.' || base === '..') return 'unnamed';
  // 保留扩展名截断：总长 200，给数据库 varchar(255) 留余量
  if (base.length <= 200) return base;
  const ext = extOf(base);
  const keep = 200 - (ext ? ext.length + 1 : 0);
  return ext ? `${base.slice(0, keep)}.${ext}` : base.slice(0, 200);
}

/** 扩展名是否被明确禁止 */
export function isForbiddenExt(filename: string): boolean {
  return FORBIDDEN_EXTENSIONS.has(extOf(filename));
}

/** 扩展名是否在白名单内（无扩展名视为不允许） */
export function isAllowedExt(filename: string): boolean {
  const ext = extOf(filename);
  return !!ext && ALLOWED_EXTENSIONS.has(ext);
}

/** 是否为依赖 mimetype 兜底的文本类文件 */
export function isTextExt(filename: string): boolean {
  return TEXT_EXTENSIONS.has(extOf(filename));
}

/**
 * 文本内容是否命中脚本特征。
 *
 * 只检查前 512 字节，够用且不会读大文件。
 * 返回命中的正则（未命中返回 null），便于日志记录命中原因。
 */
export function matchTextBlocklist(buffer?: Buffer): RegExp | null {
  if (!buffer || buffer.length === 0) return null;
  const head = buffer.subarray(0, 512).toString('utf8');
  return TEXT_CONTENT_BLOCKLIST.find((re) => re.test(head)) ?? null;
}

// ---------------------------------------------------------------------------
// 自定义 FileValidator：与内置 MaxFileSizeValidator / FileTypeValidator 组合使用
// ---------------------------------------------------------------------------

/**
 * 扩展名校验器（白名单 + 黑名单）。
 *
 * 为什么内置 `FileTypeValidator` 不够：
 * 它只看内容（Magic Number / mimetype），**完全不看文件名**。
 * - `evil.sh` 内容无 Magic Number → 走 mimetype 兜底被当文本放行
 * - 用户上传 `报告.pdf.exe`，内容若是 PDF 也会通过类型检测
 *
 * 这台校验器负责「文件名维度」，与类型检测互补。
 */
export class FileExtValidator extends FileValidator<
  { errorMessage?: string },
  Express.Multer.File
> {
  constructor(options: { errorMessage?: string } = {}) {
    super(options);
  }

  async isValid(file?: Express.Multer.File): Promise<boolean> {
    if (!file?.originalname) return false;
    if (isForbiddenExt(file.originalname)) return false;
    return isAllowedExt(file.originalname);
  }

  buildErrorMessage(file?: Express.Multer.File): string {
    if (this.validationOptions?.errorMessage) {
      return this.validationOptions.errorMessage;
    }
    if (file?.originalname && isForbiddenExt(file.originalname)) {
      return `禁止上传该类型文件（.${extOf(file.originalname)}）`;
    }
    return '不支持的文件类型，仅允许图片、文档、压缩包与音视频';
  }
}

/**
 * 文本内容校验器：拒绝改了扩展名的脚本。
 *
 * 只对文本类扩展名生效（txt/csv/md），其它类型直接通过 ——
 * 二进制文件的内容检测交给 `FileTypeValidator`。
 */
export class TextContentValidator extends FileValidator<
  { errorMessage?: string },
  Express.Multer.File
> {
  constructor(options: { errorMessage?: string } = {}) {
    super(options);
  }

  async isValid(file?: Express.Multer.File): Promise<boolean> {
    if (!file?.originalname || !isTextExt(file.originalname)) return true;
    return matchTextBlocklist(file.buffer) === null;
  }

  buildErrorMessage(): string {
    return (
      this.validationOptions?.errorMessage ??
      '文件内容包含脚本特征，已拒绝（请勿将脚本改名为文本文件上传）'
    );
  }
}

/** 文本类扩展名 → 规范 MIME（客户端声明不可信，服务端定） */
const TEXT_MIME: Readonly<Record<string, string>> = {
  txt: 'text/plain',
  csv: 'text/csv',
  md: 'text/markdown',
};

/**
 * 内容类型校验器：文本类看内容，二进制类看 Magic Number。
 *
 * 为什么不能只用内置 `FileTypeValidator`：
 * 它检测不到 Magic Number 时只能回退到**客户端声明的 mimetype**。
 * CSV/TXT/MD 本来就没有文件头，浏览器/命令行/移动端给出的 MIME 五花八门
 * （`application/octet-stream`、`application/vnd.ms-excel`、空串……），
 * 一旦回退就等于「信客户端」，而这正是要避免的。
 *
 * 所以文本类走内容判定：命中脚本特征即拒，并把 mimetype 规范成服务端认定的值；
 * 二进制类仍交给 `file-type`（数千种格式，含 Office 系列），保持强检测。
 */
export class FileContentTypeValidator extends FileValidator<
  { errorMessage?: string },
  Express.Multer.File
> {
  private readonly binary: FileTypeValidator;

  constructor(options: { errorMessage?: string } = {}) {
    super(options);
    this.binary = new FileTypeValidator({
      fileType: ALLOWED_MIME_PATTERN,
      // 文本类已在本类前置分支处理，走到这里的都该有 Magic Number
      fallbackToMimetype: false,
      overrideMimeType: true,
    });
  }

  async isValid(file?: Express.Multer.File): Promise<boolean> {
    if (!file?.originalname) return false;

    if (isTextExt(file.originalname)) {
      const blocked = matchTextBlocklist(file.buffer);
      if (blocked) return false;
      file.mimetype = TEXT_MIME[extOf(file.originalname)] ?? 'text/plain';
      return true;
    }

    return this.binary.isValid(file);
  }

  buildErrorMessage(file?: Express.Multer.File): string {
    if (this.validationOptions?.errorMessage) {
      return this.validationOptions.errorMessage;
    }
    if (file?.originalname && isTextExt(file.originalname)) {
      return '文件内容包含脚本特征，已拒绝（请勿将脚本改名为文本文件上传）';
    }
    return '文件实际内容与声明的类型不符，或该类型不在允许范围内';
  }
}
