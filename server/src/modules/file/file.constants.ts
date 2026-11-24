/**
 * 文件模块常量。
 *
 * 安全策略集中在此，避免散落在 controller / service：
 * - 大小上限
 * - 扩展名白名单 / 黑名单
 * - MIME 白名单（Magic Number 检测后比对）
 */

/** 单文件大小上限：10MB */
export const MAX_FILE_SIZE = 10 * 1024 * 1024;

/**
 * 文件模块的 RBAC 权限码。
 *
 * 只给「管理端动作」配权限码：上传 / 绑定 / 下载属于登录用户的基础能力，
 * 具体能不能碰某个业务对象的附件由 `FileBizRegistry` 判定，
 * 单独再配一套权限码会和业务权限重叠、还容易漏配。
 */
export const FILE_PERMISSIONS = {
  /** 管理端文件列表（同时作为「可读任意文件」的管理员标识） */
  LIST: 'system:file:list',
  /** 删除任意文件 */
  REMOVE: 'system:file:remove',
} as const;

/** 单次请求最多文件数 */
export const MAX_FILES_PER_REQUEST = 5;

/**
 * 临时文件保留时长（未绑定任何业务对象则回收）。
 *
 * 用户上传后放弃提交是常态（传错、看到预览不满意、关掉弹窗）。
 * 2 小时足够覆盖「上传 → 填表 → 提交」的正常操作窗口，
 * 又不至于让废弃文件占着存储过夜。
 */
export const TEMP_FILE_TTL_HOURS = 2;

/**
 * 危险扩展名黑名单（第一道：明确拒绝）。
 *
 * 注意：黑名单**不能单独依赖** —— 改名即可绕过。真正的防线是下面的
 * MIME 白名单 + Magic Number 检测（见 file.security.ts）。
 * 这里保留是因为：无 Magic Number 的脚本类文件（如 shell）能绕过类型检测，
 * 需要扩展名先挡一层。
 */
export const FORBIDDEN_EXTENSIONS: ReadonlySet<string> = new Set([
  // Windows 可执行 / 库 / 安装包
  'exe',
  'dll',
  'sys',
  'scr',
  'com',
  'pif',
  'cpl',
  'msi',
  'msp',
  'msc',
  'bat',
  'cmd',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'ps1',
  'psm1',
  'hta',
  'reg',
  'lnk',
  'inf',
  // Linux / Unix 可执行与脚本
  'sh',
  'bash',
  'zsh',
  'run',
  'bin',
  'elf',
  'so',
  'ko',
  // 跨平台脚本 / 解释器
  'php',
  'php3',
  'php4',
  'php5',
  'phtml',
  'py',
  'pyc',
  'pl',
  'rb',
  'jar',
  'class',
  'war',
  'asp',
  'aspx',
  'jsp',
  'cgi',
  // 容器 / 磁盘镜像
  'iso',
  'img',
  'vhd',
  'vhdx',
  'vmdk',
  // 快捷方式式钓鱼
  'url',
  'scf',
  'application',
]);

/**
 * 允许的扩展名白名单（第二道：只放行常见办公/图片/压缩/文本）。
 *
 * 白名单优于黑名单：新增格式必须显式加进来，默认拒绝。
 */
export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set([
  // 图片
  'jpg',
  'jpeg',
  'png',
  'gif',
  'webp',
  'bmp',
  // 文档
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'txt',
  'csv',
  'md',
  // 压缩包
  'zip',
  'rar',
  '7z',
  'tar',
  'gz',
  // 音视频（隐患整改佐证常用）
  'mp4',
  'mp3',
  'wav',
]);

/**
 * Magic Number 检测后的 MIME 白名单。
 *
 * `file-type` 覆盖数千种格式，这里只放行业务需要的。
 * 文本类（txt/csv/md）没有 Magic Number，靠 `fallbackToMimetype` 兜底，
 * 但会被 `TextContentValidator` 再过一遍（拒绝 `#!` / `<?php` 等脚本头）。
 */
export const ALLOWED_MIME_PATTERN =
  /^(image\/(jpeg|png|gif|webp|bmp)|application\/(pdf|zip|x-rar-compressed|vnd\.rar|7z-compressed|x-7z-compressed|x-tar|gzip|vnd\.openxmlformats-officedocument\.(wordprocessingml\.document|spreadsheetml\.sheet|presentationml\.presentation)|vnd\.ms-(word|excel|powerpoint)|msword|vnd\.ms-office)|text\/(plain|csv|markdown)|video\/(mp4|quicktime)|audio\/(mpeg|wav|x-wav))$/i;

/** 依赖 fallbackToMimetype 的文本类扩展名（Magic Number 检测不到） */
export const TEXT_EXTENSIONS: ReadonlySet<string> = new Set([
  'txt',
  'csv',
  'md',
]);

/**
 * 文本文件内容黑名单：命中即拒。
 *
 * 场景：`evil.sh` 改名 `evil.txt` 上传 —— 没有 Magic Number，
 * `file-type` 返回 undefined，走 fallback 就会被当成 text/plain 放行。
 * 这里靠内容特征再挡一层。
 */
export const TEXT_CONTENT_BLOCKLIST: readonly RegExp[] = [
  /^#!\s*\//, // shebang：#!/bin/sh、#!/usr/bin/env python
  /^<\?php/i, // PHP 短标签
  /^<%\s*(?:@|import|=)/i, // JSP / ASP 模板
  /^\s*<script[\s>]/i, // 纯 HTML 脚本
];
