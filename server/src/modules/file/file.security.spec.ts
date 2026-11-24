import type { Express } from 'express';
import {
  FileContentTypeValidator,
  FileExtValidator,
  extOf,
  isAllowedExt,
  isForbiddenExt,
  matchTextBlocklist,
  sanitizeFileName,
} from './file.security.js';
import {
  acceptsExtension,
  resolveAcceptPolicy,
  resolveGlobalAcceptPolicy,
} from './file.policy.js';
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE } from './file.constants.js';

/** 造一个最小 multer 文件对象（只填校验用到的字段） */
function fakeFile(
  originalname: string,
  buffer: Buffer,
  mimetype = 'application/octet-stream',
): Express.Multer.File {
  return {
    fieldname: 'file',
    originalname,
    encoding: '7bit',
    mimetype,
    size: buffer.length,
    buffer,
  } as Express.Multer.File;
}

/**
 * 完整最小 PNG（8×8，75 字节）。
 *
 * 不能只用 12 字节的文件头：`file-type` 需要读到 IHDR 块才认 png，
 * 只给 magic number 会返回 undefined，测试就变成「测 file-type」而不是测我们的逻辑。
 */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC',
  'base64',
);
const MZ = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x00, 0x00]);

describe('文件安全：文件名处理', () => {
  it('extOf 取小写扩展名，忽略路径与无扩展名', () => {
    expect(extOf('a.PDF')).toBe('pdf');
    expect(extOf('C:\\Users\\x\\报告.docx')).toBe('docx');
    expect(extOf('no-ext')).toBe('');
    expect(extOf('.bashrc')).toBe('');
    expect(extOf('trailing.')).toBe('');
  });

  it('sanitizeFileName 去路径、去控制字符、限长', () => {
    expect(sanitizeFileName('C:\\Users\\x\\a.pdf')).toBe('a.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('a\nb.txt')).toBe('ab.txt');
    expect(sanitizeFileName('  ')).toBe('unnamed');

    const long = `${'a'.repeat(300)}.pdf`;
    const out = sanitizeFileName(long);
    expect(out.length).toBeLessThanOrEqual(200);
    expect(out.endsWith('.pdf')).toBe(true);
  });

  it('扩展名白名单 / 黑名单互补', () => {
    expect(isForbiddenExt('evil.exe')).toBe(true);
    expect(isForbiddenExt('evil.sh')).toBe(true);
    expect(isAllowedExt('report.pdf')).toBe(true);
    // 黑名单优先：即使某天误加进白名单也必须拒
    expect(isForbiddenExt('a.Ps1')).toBe(true);
    expect(isAllowedExt('noext')).toBe(false);
  });

  it('文本内容黑名单只命中脚本特征', () => {
    expect(
      matchTextBlocklist(Buffer.from('#!/bin/sh\nrm -rf /\n')),
    ).not.toBeNull();
    expect(matchTextBlocklist(Buffer.from('<?php echo 1;'))).not.toBeNull();
    expect(matchTextBlocklist(Buffer.from('sku,name\n1,foo\n'))).toBeNull();
    expect(matchTextBlocklist(Buffer.alloc(0))).toBeNull();
  });
});

describe('文件安全：校验器', () => {
  it('FileExtValidator 拦黑名单、放白名单', async () => {
    const v = new FileExtValidator();
    expect(await v.isValid(fakeFile('a.pdf', Buffer.from('%PDF-')))).toBe(true);
    expect(await v.isValid(fakeFile('a.exe', MZ))).toBe(false);
    expect(await v.isValid(fakeFile('noext', Buffer.from('x')))).toBe(false);
    expect(await v.isValid(undefined)).toBe(false);
  });

  it('FileContentTypeValidator：二进制看 Magic Number', async () => {
    const v = new FileContentTypeValidator();
    const png = fakeFile('a.png', PNG, 'application/octet-stream');
    expect(await v.isValid(png)).toBe(true);
    // 覆盖客户端声明：MIME 被修正成真实类型
    expect(png.mimetype).toBe('image/png');

    // 改名成 jpg 的 exe（MZ 头）必须拒
    expect(await v.isValid(fakeFile('a.jpg', MZ, 'image/jpeg'))).toBe(false);

    // 无法识别的字节 → fail-closed
    expect(
      await v.isValid(
        fakeFile('a.png', Buffer.from('not-a-real-png'), 'image/png'),
      ),
    ).toBe(false);
  });

  it('FileContentTypeValidator：文本类看内容而不是客户端 MIME', async () => {
    const v = new FileContentTypeValidator();

    // curl 常把 csv 声明成 octet-stream，仍应通过并规范化 MIME
    const csv = fakeFile(
      'a.csv',
      Buffer.from('sku,name\n1,foo\n'),
      'application/octet-stream',
    );
    expect(await v.isValid(csv)).toBe(true);
    expect(csv.mimetype).toBe('text/csv');

    // 脚本改名 .txt 必须拒
    expect(
      await v.isValid(
        fakeFile('a.txt', Buffer.from('#!/bin/sh\nrm -rf /'), 'text/plain'),
      ),
    ).toBe(false);
  });
});

describe('文件安全：收件策略', () => {
  it('全局策略用常量默认值', () => {
    const p = resolveGlobalAcceptPolicy();
    expect(p.maxSize).toBe(MAX_FILE_SIZE);
    expect(p.extensions).toBe(ALLOWED_EXTENSIONS);
  });

  it('业务覆盖只能收紧，不能放宽', () => {
    const p = resolveAcceptPolicy({
      extensions: ['xlsx', 'exe'],
      maxSize: MAX_FILE_SIZE * 10,
      maxFiles: 999,
    });
    // exe 不在全局白名单 → 交集后消失
    expect(p.extensions.has('xlsx')).toBe(true);
    expect(p.extensions.has('exe')).toBe(false);
    // 超上限的请求被压回全局上限
    expect(p.maxSize).toBe(MAX_FILE_SIZE);
    expect(p.maxFiles).toBeLessThanOrEqual(999);
  });

  it('未注册业务策略时沿用全局', () => {
    expect(resolveAcceptPolicy(undefined)).toEqual(resolveGlobalAcceptPolicy());
  });

  it('acceptsExtension 按策略判定', () => {
    const onlyXlsx = resolveAcceptPolicy({ extensions: ['xlsx'] });
    expect(acceptsExtension(onlyXlsx, 'a.xlsx')).toBe(true);
    expect(acceptsExtension(onlyXlsx, 'a.png')).toBe(false);
    expect(acceptsExtension(onlyXlsx, 'noext')).toBe(false);
  });
});
