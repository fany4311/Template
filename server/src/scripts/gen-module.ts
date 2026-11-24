import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

/**
 * gen:module —— 按字段清单生成「带权限 + 审计 + 分页 + 导入导出」的 CRUD 模块。
 *
 * 为什么生成而不是运行时插件：底座不做微内核；生成物是普通代码，改动自由。
 *
 * 用法：pnpm gen:module notice --label "通知公告" --field "title:string:标题,content:text:内容"
 *      可选：--menu-parent /monitor（挂到已存在的父菜单下）
 *            --unique code（该字段建唯一键，并在服务层前置查重）
 *      加 --dry-run 只列文件。
 * 字段类型：string | text | int | decimal | bool | datetime | dict:<字典类型> | file
 *   file 类型不建列：走 sys_file 多态绑定（FileBizRegistry），前端用 BizFiles 组件读写。
 * 生成后仍需人工：pnpm authz:sync、pnpm migration:run、给角色授权。
 * 字段名会直接做列名，避开 MySQL 保留字。
 */

const ROOT = resolve(import.meta.dirname, '../../..');
const SERVER = resolve(ROOT, 'server');
const WEB_ADMIN = resolve(ROOT, 'web_admin');

type FieldType =
  | 'string'
  | 'text'
  | 'int'
  | 'decimal'
  | 'bool'
  | 'datetime'
  | 'dict'
  | 'file';

interface Field {
  name: string;
  label: string;
  type: FieldType;
  dictType?: string;
  column: string;
}

interface Ctx {
  slug: string;
  Name: string;
  camel: string;
  upper: string;
  label: string;
  table: string;
  perm: string;
  fields: Field[];
  ts: string;
  ts2: string;
  /** --menu-parent：父菜单 path（如 /monitor）；不传则建根菜单 */
  menuParent?: string;
  /** --unique：建唯一键的字段（只在服务层做友好查重，并发兜底仍靠数据库） */
  unique?: Field;
}

const SLUG_RE = /^[a-z][a-z0-9]{1,19}$/;

function die(msg: string): never {
  console.error('✗ ' + msg);
  process.exit(1);
}

function cap(v: string): string {
  return v.charAt(0).toUpperCase() + v.slice(1);
}
function pascal(v: string): string {
  return v.split(/[-_]/).filter(Boolean).map(cap).join('');
}
function camelName(v: string): string {
  const p = pascal(v);
  return p.charAt(0).toLowerCase() + p.slice(1);
}
function snake(v: string): string {
  return v.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());
}
function q(v: string): string {
  return "'" + v.replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
}
function block(lines: string[]): string {
  return lines.join('\n');
}

function parseArgs(argv: string[]): {
  slug: string;
  label: string;
  fields: Field[];
  dryRun: boolean;
  menuParent?: string;
  uniqueName?: string;
} {
  let slug = '';
  let label = '';
  let raw = '';
  let dryRun = false;
  let menuParent: string | undefined;
  let uniqueName: string | undefined;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === '--dry-run') {
      dryRun = true;
      continue;
    }
    if (arg === '--label') {
      label = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg === '--field') {
      raw = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg === '--menu-parent') {
      menuParent = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg === '--unique') {
      uniqueName = argv[i + 1] ?? '';
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) die('未知参数：' + arg);
    if (slug) die('只能给一个 slug');
    slug = arg;
  }
  if (!slug || !SLUG_RE.test(slug))
    die('slug 不合法（小写字母开头，仅 a-z0-9，长度 2-20）');
  if (!label) die('缺少 --label');
  if (!raw) die('缺少 --field');
  const allowed: FieldType[] = [
    'string',
    'text',
    'int',
    'decimal',
    'bool',
    'datetime',
    'dict',
    'file',
  ];
  const fields: Field[] = [];
  for (const seg of raw.split(',')) {
    const text = seg.trim();
    if (!text) continue;
    const parts = text.split(':').map((p) => p.trim());
    const name = parts[0] ?? '';
    let type = parts[1] ?? 'string';
    let dictType: string | undefined;
    let fieldLabel = '';
    if (type.startsWith('dict:')) {
      dictType = type.slice(5);
      type = 'dict';
      fieldLabel = parts[2] ?? name;
    } else if (type === 'dict') {
      dictType = parts[2] ?? '';
      fieldLabel = parts[3] ?? name;
    } else fieldLabel = parts[2] ?? name;
    if (!allowed.includes(type as FieldType)) die('字段类型不支持：' + type);
    if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) die('字段名不合法：' + name);
    if (type === 'dict' && !dictType) die('dict 字段必须给字典类型：' + name);
    if (fields.some((f) => f.name === name)) die('字段重复：' + name);
    fields.push({
      name,
      label: fieldLabel,
      type: type as FieldType,
      dictType,
      column: snake(name),
    });
  }
  if (fields.length === 0) die('字段列表为空');
  if (fields.length > 30) die('字段超过 30 个，建议拆分模块');
  if (!fields.some((f) => f.type !== 'file')) {
    die('至少需要一个非 file 字段：file 只生成附件绑定，不能单独成表');
  }

  if (menuParent !== undefined) {
    if (!menuParent) die('--menu-parent 需要给父菜单 path（如 /monitor）');
    if (!menuParent.startsWith('/'))
      die('--menu-parent 必须以 / 开头（菜单 path，不是 id）：' + menuParent);
    if (menuParent.length > 1 && menuParent.endsWith('/'))
      menuParent = menuParent.slice(0, -1);
  }

  if (uniqueName) {
    const field = fields.find((f) => f.name === uniqueName);
    if (!field) die('--unique 指向的字段不存在：' + uniqueName);
    if (field.type === 'file')
      die('file 字段没有列，不能做 --unique：' + uniqueName);
  }

  return { slug, label, fields, dryRun, menuParent, uniqueName };
}

/** 参与列/契约生成的字段（file 走 sys_file 绑定，不建列） */
function columnFields(ctx: Ctx): Field[] {
  return ctx.fields.filter((f) => f.type !== 'file');
}

function fileFields(ctx: Ctx): Field[] {
  return ctx.fields.filter((f) => f.type === 'file');
}

// ── 字段 → 代码片段 ─────────────────────────────────────────────

function entityDecorator(f: Field): string {
  switch (f.type) {
    case 'text':
      return (
        '@Column({ name: ' +
        q(f.column) +
        ", type: 'text', comment: " +
        q(f.label) +
        ' })'
      );
    case 'int':
      return (
        '@Column({ name: ' +
        q(f.column) +
        ", type: 'int', default: 0, comment: " +
        q(f.label) +
        ' })'
      );
    case 'decimal':
      return (
        '@Column({ name: ' +
        q(f.column) +
        ", type: 'decimal', precision: 12, scale: 2, default: 0, comment: " +
        q(f.label) +
        ' })'
      );
    case 'bool':
      return (
        '@Column({ name: ' +
        q(f.column) +
        ", type: 'tinyint', width: 1, default: 0, comment: " +
        q(f.label + '（1是 0否）') +
        ' })'
      );
    case 'datetime':
      return (
        '@Column({ name: ' +
        q(f.column) +
        ", type: 'datetime', nullable: true, comment: " +
        q(f.label) +
        ' })'
      );
    case 'dict':
      return (
        '@Column({ name: ' +
        q(f.column) +
        ', length: 100, default: ' +
        q('') +
        ', comment: ' +
        q(f.label + '（字典 ' + (f.dictType ?? '') + '）') +
        ' })'
      );
    default:
      return (
        '@Column({ name: ' +
        q(f.column) +
        ', length: 255, default: ' +
        q('') +
        ', comment: ' +
        q(f.label) +
        ' })'
      );
  }
}

function entityType(f: Field): string {
  if (f.type === 'int' || f.type === 'decimal' || f.type === 'bool')
    return 'number';
  if (f.type === 'datetime') return 'Date | null';
  return 'string';
}

function zodCreate(f: Field): string {
  switch (f.type) {
    case 'text':
      return "z.string().max(20000).default('')";
    case 'int':
      return 'z.coerce.number().int().default(0)';
    case 'decimal':
      return 'z.coerce.number().default(0)';
    case 'bool':
      return 'z.coerce.number().int().min(0).max(1).default(0)';
    case 'datetime':
      return 'z.coerce.date().nullish()';
    case 'dict':
      return "z.string().max(100).default('')";
    default:
      return 'z.string().trim().min(1, ' + q('请输入' + f.label) + ').max(255)';
  }
}

function zodResponse(f: Field): string {
  if (f.type === 'int' || f.type === 'decimal' || f.type === 'bool')
    return 'z.number()';
  if (f.type === 'datetime') return 'z.iso.datetime().nullable()';
  return 'z.string()';
}

function sqlColumn(f: Field): string {
  const comment = ' COMMENT ' + q(f.label) + ',';
  switch (f.type) {
    case 'text':
      return f.column + ' text NOT NULL' + comment;
    case 'int':
      return f.column + ' int NOT NULL DEFAULT 0' + comment;
    case 'decimal':
      return f.column + ' decimal(12,2) NOT NULL DEFAULT 0.00' + comment;
    case 'bool':
      return f.column + ' tinyint(1) NOT NULL DEFAULT 0' + comment;
    case 'datetime':
      return f.column + ' datetime DEFAULT NULL' + comment;
    case 'dict':
      return f.column + ' varchar(100) NOT NULL DEFAULT ' + q('') + comment;
    default:
      return f.column + ' varchar(255) NOT NULL DEFAULT ' + q('') + comment;
  }
}

function csvColumn(f: Field): string {
  let extra = '';
  if (f.type === 'bool')
    extra =
      ', format: (row) => (row.' +
      f.name +
      " === 1 ? '是' : '否'), parse: (cell) => (cell === '是' || cell === '1' ? '1' : '0')";
  else if (f.type === 'datetime')
    extra =
      ', format: (row) => (row.' +
      f.name +
      ' ? row.' +
      f.name +
      ".toISOString() : '')";
  return '  { header: ' + q(f.label) + ', field: ' + q(f.name) + extra + ' },';
}

function formColumn(f: Field): string {
  const head = '  { prop: ' + q(f.name) + ', label: ' + q(f.label);
  if (f.type === 'text') return head + ", type: 'textarea', rows: 3 },";
  if (f.type === 'int' || f.type === 'decimal')
    return head + ", type: 'number' },";
  if (f.type === 'bool')
    return (
      head +
      ", type: 'switch', activeValue: 1, inactiveValue: 0, activeText: '是', inactiveText: '否' },"
    );
  if (f.type === 'datetime')
    return head + ", placeholder: 'YYYY-MM-DD HH:mm:ss' },";
  if (f.type === 'dict')
    return (
      head +
      ", type: 'select', options: dictOptions[" +
      q(f.dictType ?? '') +
      "] ?? [], placeholder: '请选择' },"
    );
  return head + ' },';
}

function tableColumn(f: Field): string {
  if (f.type === 'bool' || f.type === 'datetime')
    return (
      '  { label: ' + q(f.label) + ', width: 120, slot: ' + q(f.name) + ' },'
    );
  return (
    '  { prop: ' + q(f.name) + ', label: ' + q(f.label) + ', minWidth: 140 },'
  );
}

function jsType(f: Field): string {
  if (f.type === 'int' || f.type === 'decimal' || f.type === 'bool')
    return 'number';
  if (f.type === 'datetime') return 'string | null';
  return 'string';
}
// ── 文件模板 ───────────────────────────────────────────────────

function entityFile(ctx: Ctx): string {
  const unique = ctx.unique;
  return block([
    unique
      ? "import { Column, Entity, Index } from 'typeorm';"
      : "import { Column, Entity } from 'typeorm';",
    "import { BaseEntity } from '../../../common/entities/base.entity.js';",
    '',
    '/** ' +
      ctx.label +
      '实体（' +
      ctx.table +
      ' 表）。由 gen:module 生成：改字段请同步追加迁移。 */',
    ...(unique
      ? [
          "@Index('uk_" +
            ctx.table +
            '_' +
            unique.column +
            "', ['" +
            unique.name +
            "'], { unique: true })",
        ]
      : []),
    "@Entity('" + ctx.table + "')",
    'export class ' + ctx.Name + ' extends BaseEntity {',
    ...columnFields(ctx).map(
      (f) =>
        '  ' +
        entityDecorator(f) +
        '\n  ' +
        f.name +
        '!: ' +
        entityType(f) +
        ';\n',
    ),
    '}',
  ]);
}

function dtoFile(ctx: Ctx): string {
  return block([
    "import { z } from 'zod';",
    "import { filterString, paginationSchema } from '../../../common/dto/pagination.dto.js';",
    "import { updateSchemaOf } from '../../../common/dto/update-schema.util.js';",
    '',
    '/** 创建' + ctx.label + ' */',
    'export const create' + ctx.Name + 'Schema = z.object({',
    ...columnFields(ctx).map((f) => '  ' + f.name + ': ' + zodCreate(f) + ','),
    '});',
    'export type Create' +
      ctx.Name +
      'Input = z.infer<typeof create' +
      ctx.Name +
      'Schema>;',
    '',
    '/** 更新（全部可选） */',
    'export const update' +
      ctx.Name +
      'Schema = updateSchemaOf(create' +
      ctx.Name +
      'Schema);',
    'export type Update' +
      ctx.Name +
      'Input = z.infer<typeof update' +
      ctx.Name +
      'Schema>;',
    '',
    '/** 查询（分页 + 关键字） */',
    'export const query' + ctx.Name + 'Schema = paginationSchema.extend({',
    '  keyword: filterString(100),',
    '});',
    'export type Query' +
      ctx.Name +
      'Input = z.infer<typeof query' +
      ctx.Name +
      'Schema>;',
    '',
    '/** 导出条件（与列表同筛选，不分页） */',
    'export const export' +
      ctx.Name +
      'Schema = z.object({ keyword: filterString(100) });',
    'export type Export' +
      ctx.Name +
      'Query = z.infer<typeof export' +
      ctx.Name +
      'Schema>;',
  ]);
}

function responseFile(ctx: Ctx): string {
  return block([
    "import { z } from 'zod';",
    '',
    '/** ' + ctx.label + '（响应契约，openapi 同源） */',
    'export const ' + ctx.camel + 'ResponseSchema = z.object({',
    '  id: z.number(),',
    '  createTime: z.iso.datetime(),',
    '  updateTime: z.iso.datetime(),',
    ...columnFields(ctx).map(
      (f) => '  ' + f.name + ': ' + zodResponse(f) + ',',
    ),
    '});',
  ]);
}

function csvFile(ctx: Ctx): string {
  return block([
    "import { z } from 'zod';",
    "import type { CsvColumn } from '../../common/import-export/csv.js';",
    'import type { ' +
      ctx.Name +
      " } from './entities/" +
      ctx.slug +
      ".entity.js';",
    '',
    '/** ' + ctx.label + '的 CSV 契约：导出列 + 导入归一 + 逐行校验。 */',
    'export const ' +
      ctx.upper +
      '_CSV_COLUMNS: CsvColumn<' +
      ctx.Name +
      '>[] = [',
    ...columnFields(ctx).map(csvColumn),
    '];',
    '',
    'export const ' + ctx.camel + 'ImportRowSchema = z.object({',
    ...columnFields(ctx).map((f) => '  ' + f.name + ': ' + zodCreate(f) + ','),
    '});',
  ]);
}

function serviceFile(ctx: Ctx): string {
  const cols = columnFields(ctx);
  const first =
    cols.find((f) => f.type === 'string' || f.type === 'text') ??
    (cols[0] as Field);
  const where = q('(r.' + first.name + ' LIKE :kw)');
  const kwParam = "{ kw: '%' + query.keyword + '%' }";
  return block([
    "import { Injectable, NotFoundException } from '@nestjs/common';",
    "import { InjectRepository } from '@nestjs/typeorm';",
    "import { TransactionHost } from '@nestjs-cls/transactional';",
    "import type { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';",
    "import { Repository } from 'typeorm';",
    "import { buildPageResult, type PageResult } from '../../common/dto/pagination.dto.js';",
    "import { ApiException } from '../../common/exceptions/api.exception.js';",
    ...(fileFields(ctx).length
      ? ["import type { FileBizContext } from '../file/file-biz.registry.js';"]
      : []),
    'import {',
    '  CSV_MAX_FAILED,',
    '  CSV_MAX_ROWS,',
    '  type ImportFailure,',
    '  type ImportResult,',
    "} from '../../common/import-export/csv.js';",
    'import { ' +
      ctx.camel +
      "ImportRowSchema } from './" +
      ctx.slug +
      ".csv.js';",
    'import {',
    '  type Create' + ctx.Name + 'Input,',
    '  type Export' + ctx.Name + 'Query,',
    '  type Query' + ctx.Name + 'Input,',
    '  type Update' + ctx.Name + 'Input,',
    "} from './dto/" + ctx.slug + ".dto.js';",
    'import { ' + ctx.Name + " } from './entities/" + ctx.slug + ".entity.js';",
    '',
    "const MSG_NOT_FOUND = '记录不存在';",
    '',
    '/** ' +
      ctx.label +
      '服务（gen:module 生成：分页 / CRUD / 导出 / 逐行导入）。 */',
    '@Injectable()',
    'export class ' + ctx.Name + 'Service {',
    '  constructor(',
    '    @InjectRepository(' + ctx.Name + ')',
    '    private readonly repo: Repository<' + ctx.Name + '>,',
    '    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,',
    '  ) {}',
    '',
    ...(fileFields(ctx).length
      ? [
          '  /** 附件可见性：与列表同一套规则（本模块未做数据范围，存在即可见） */',
          '  async canAccess(_ctx: FileBizContext, id: number): Promise<boolean> {',
          '    const row = await this.repo.findOneBy({ id });',
          '    return !!row;',
          '  }',
          '',
        ]
      : []),
    ...(ctx.unique
      ? [
          '  /** 唯一字段前置查重：给出人话错误，并发兜底仍靠数据库唯一键 */',
          '  private async assertUnique(value: unknown, excludeId?: number): Promise<void> {',
          '    const dup = await this.repo.findOne({ where: { ' +
            ctx.unique.name +
            ': value } as never });',
          '    if (dup && dup.id !== excludeId) throw new ApiException(' +
            q(ctx.unique.label + '已存在') +
            ');',
          '  }',
          '',
        ]
      : []),
    '  async page(query: Query' +
      ctx.Name +
      'Input): Promise<PageResult<' +
      ctx.Name +
      '>> {',
    "    const qb = this.repo.createQueryBuilder('r');",
    '    if (query.keyword) {',
    '      qb.andWhere(' + where + ', ' + kwParam + ');',
    '    }',
    "    qb.orderBy('r.id', 'DESC')",
    '      .skip((query.pageNum - 1) * query.pageSize)',
    '      .take(query.pageSize);',
    '    const [list, total] = await qb.getManyAndCount();',
    '    return buildPageResult(list, total);',
    '  }',
    '',
    '  async detail(id: number): Promise<' + ctx.Name + '> {',
    '    const row = await this.repo.findOneBy({ id });',
    '    if (!row) throw new NotFoundException(MSG_NOT_FOUND);',
    '    return row;',
    '  }',
    '',
    '  async create(dto: Create' +
      ctx.Name +
      'Input): Promise<' +
      ctx.Name +
      '> {',
    ...(ctx.unique
      ? ['    await this.assertUnique(dto.' + ctx.unique.name + ');']
      : []),
    '    return this.txHost.withTransaction(async () => {',
    '      const repo = this.txHost.tx.getRepository(' + ctx.Name + ');',
    '      return repo.save(repo.create(dto as Partial<' + ctx.Name + '>));',
    '    });',
    '  }',
    '',
    '  async update(id: number, dto: Update' +
      ctx.Name +
      'Input): Promise<' +
      ctx.Name +
      '> {',
    ...(ctx.unique
      ? [
          '    if (dto.' +
            ctx.unique.name +
            ' !== undefined) await this.assertUnique(dto.' +
            ctx.unique.name +
            ', id);',
        ]
      : []),
    '    return this.txHost.withTransaction(async () => {',
    '      const repo = this.txHost.tx.getRepository(' + ctx.Name + ');',
    '      const row = await repo.findOneBy({ id });',
    '      if (!row) throw new NotFoundException(MSG_NOT_FOUND);',
    '      Object.assign(row, dto);',
    '      return repo.save(row);',
    '    });',
    '  }',
    '',
    '  async remove(id: number): Promise<boolean> {',
    '    return this.txHost.withTransaction(async () => {',
    '      const repo = this.txHost.tx.getRepository(' + ctx.Name + ');',
    '      const row = await repo.findOneBy({ id });',
    '      if (!row) throw new NotFoundException(MSG_NOT_FOUND);',
    '      await repo.softDelete(id);',
    '      return true;',
    '    });',
    '  }',
    '',
    '  /** 导出：超上限报错而不是静默截断 */',
    '  async exportRows(query: Export' +
      ctx.Name +
      'Query): Promise<' +
      ctx.Name +
      '[]> {',
    "    const qb = this.repo.createQueryBuilder('r');",
    '    if (query.keyword) {',
    '      qb.andWhere(' + where + ', ' + kwParam + ');',
    '    }',
    "    const rows = await qb.orderBy('r.id', 'ASC').limit(CSV_MAX_ROWS + 1).getMany();",
    '    if (rows.length > CSV_MAX_ROWS) {',
    "      throw new ApiException('单次最多导出 ' + CSV_MAX_ROWS + ' 行，请先按关键字缩小范围');",
    '    }',
    '    return rows;',
    '  }',
    '',
    '  /** 逐行导入：部分成功，失败按行号返回（见 docs/通用管理域.md 2.5） */',
    '  async importRows(records: Record<string, string>[]): Promise<ImportResult> {',
    '    const failed: ImportFailure[] = [];',
    '    let ok = 0;',
    '    let failedTruncated = false;',
    '',
    '    const pushFailure = (row: number, message: string): void => {',
    '      if (failed.length < CSV_MAX_FAILED) failed.push({ row, message });',
    '      else failedTruncated = true;',
    '    };',
    '',
    '    for (let index = 0; index < records.length; index += 1) {',
    '      const rowNo = index + 2;',
    '      const parsed = ' +
      ctx.camel +
      'ImportRowSchema.safeParse(records[index]);',
    '      if (!parsed.success) {',
    "        pushFailure(rowNo, parsed.error.issues[0]?.message ?? '格式不正确');",
    '        continue;',
    '      }',
    '      try {',
    '        await this.repo.insert({ ...parsed.data } as never);',
    '        ok += 1;',
    '      } catch {',
    ...(ctx.unique
      ? [
          "        pushFailure(rowNo, '写入失败：' + " +
            q(ctx.unique.label) +
            " + '可能重复或超长');",
        ]
      : ["        pushFailure(rowNo, '写入失败，请检查字段长度');"]),
    '      }',
    '    }',
    '',
    '    return { total: records.length, ok, failed, failedTruncated };',
    '  }',
    '}',
  ]);
}
function controllerFile(ctx: Ctx): string {
  const p = ctx.perm;
  return block([
    'import {',
    '  Body,',
    '  Controller,',
    '  Delete,',
    '  Get,',
    '  HttpCode,',
    '  HttpStatus,',
    '  Param,',
    '  Post,',
    '  Put,',
    '  Query,',
    '  Res,',
    '  StreamableFile,',
    '  UploadedFile,',
    '  UseInterceptors,',
    "} from '@nestjs/common';",
    "import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';",
    "import { FileInterceptor } from '@nestjs/platform-express';",
    "import type { Response } from 'express';",
    "import { z } from 'zod';",
    "import { Auditable } from '../../common/decorators/auditable.decorator.js';",
    "import { Idempotent } from '../../common/decorators/idempotent.decorator.js';",
    "import { Keep } from '../../common/decorators/keep.decorator.js';",
    "import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';",
    "import { ApiException } from '../../common/exceptions/api.exception.js';",
    "import { exportRows as rowsToCsv, readRows } from '../../common/import-export/csv.js';",
    "import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';",
    'import { ' +
      ctx.upper +
      "_CSV_COLUMNS } from './" +
      ctx.slug +
      ".csv.js';",
    'import {',
    '  create' + ctx.Name + 'Schema,',
    '  export' + ctx.Name + 'Schema,',
    '  query' + ctx.Name + 'Schema,',
    '  update' + ctx.Name + 'Schema,',
    '  type Create' + ctx.Name + 'Input,',
    '  type Export' + ctx.Name + 'Query,',
    '  type Query' + ctx.Name + 'Input,',
    '  type Update' + ctx.Name + 'Input,',
    "} from './dto/" + ctx.slug + ".dto.js';",
    'import { ' +
      ctx.camel +
      "ResponseSchema } from './dto/" +
      ctx.slug +
      ".response.js';",
    'import { ' + ctx.Name + "Service } from './" + ctx.slug + ".service.js';",
    '',
    'const idParamSchema = z.coerce.number().int().positive();',
    '',
    'const importResultSchema = z.object({',
    '  total: z.number(),',
    '  ok: z.number(),',
    '  failed: z.array(z.object({ row: z.number(), message: z.string() })),',
    '  failedTruncated: z.boolean(),',
    '});',
    '',
    '/** ' + ctx.label + '（gen:module 生成，权限码 ' + p + ':*）。',
    ' * 权限码由控制器反射进 sys_permission：生成后记得 pnpm authz:sync。',
    ' */',
    '@ApiTags(' + q(ctx.label) + ')',
    '@ApiBearerAuth()',
    '@Controller(' + q(ctx.slug) + ')',
    'export class ' + ctx.Name + 'Controller {',
    '  constructor(private readonly service: ' + ctx.Name + 'Service) {}',
    '',
    '  @Get()',
    '  @RequiresPermissions(' + q(p + ':list') + ')',
    "  @ApiOperation({ summary: '分页查询" + ctx.label + "' })",
    "  @ApiOkZod('" +
      ctx.Name +
      "Page', pageOf(" +
      ctx.camel +
      "ResponseSchema), '" +
      ctx.label +
      "分页结果 { list, total }')",
    '  page(@Query({ schema: query' +
      ctx.Name +
      'Schema }) query: Query' +
      ctx.Name +
      'Input) {',
    '    return this.service.page(query);',
    '  }',
    '',
    '  @Get(' + q('export') + ')',
    '  @RequiresPermissions(' + q(p + ':export') + ')',
    '  @Auditable({ action: ' +
      q(p + ':export') +
      ', resourceType: ' +
      q(ctx.slug) +
      ' })',
    "  @ApiOperation({ summary: '导出" +
      ctx.label +
      "（CSV，最多 5000 行）' })",
    "  @ApiProduces('text/csv')",
    '  @Keep()',
    '  async exportCsv(',
    '    @Query({ schema: export' +
      ctx.Name +
      'Schema }) query: Export' +
      ctx.Name +
      'Query,',
    '    @Res({ passthrough: true }) res: Response,',
    '  ): Promise<StreamableFile> {',
    '    const rows = await this.service.exportRows(query);',
    "    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');",
    "    res.setHeader('Content-Type', 'text/csv; charset=utf-8');",
    '    res.setHeader(',
    "      'Content-Disposition',",
    '      \'attachment; filename="' + ctx.slug + "-' + date + '.csv\"',",
    '    );',
    '    return new StreamableFile(Buffer.from(rowsToCsv(rows, ' +
      ctx.upper +
      "_CSV_COLUMNS), 'utf8'));",
    '  }',
    '',
    '  @Post(' + q('import') + ')',
    '  @HttpCode(HttpStatus.OK)',
    '  @RequiresPermissions(' + q(p + ':import') + ')',
    '  @Auditable({ action: ' +
      q(p + ':import') +
      ', resourceType: ' +
      q(ctx.slug) +
      ' })',
    "  @UseInterceptors(FileInterceptor('file', { limits: { files: 1, fileSize: 2 * 1024 * 1024 } }))",
    "  @ApiOperation({ summary: '导入" +
      ctx.label +
      "（CSV，逐行返回失败原因）' })",
    "  @ApiOkZod('" +
      ctx.Name +
      "ImportResult', importResultSchema, '导入结果')",
    '  importCsv(@UploadedFile() file?: Express.Multer.File) {',
    "    if (!file) throw new ApiException('请选择要导入的 CSV 文件', 400);",
    "    if (!file.originalname.toLowerCase().endsWith('.csv')) {",
    "      throw new ApiException('只支持 .csv 文件（Excel 请另存为 CSV UTF-8）', 400);",
    '    }',
    "    const records = readRows(file.buffer.toString('utf8'), " +
      ctx.upper +
      '_CSV_COLUMNS);',
    '    return this.service.importRows(records);',
    '  }',
    '',
    '  @Get(' + q(':id') + ')',
    '  @RequiresPermissions(' + q(p + ':query') + ')',
    "  @ApiOperation({ summary: '" + ctx.label + "详情' })",
    "  @ApiOkZod('" +
      ctx.Name +
      "', " +
      ctx.camel +
      "ResponseSchema, '" +
      ctx.label +
      "详情')",
    '  detail(@Param(' + q('id') + ', { schema: idParamSchema }) id: number) {',
    '    return this.service.detail(id);',
    '  }',
    '',
    '  @Post()',
    '  @HttpCode(HttpStatus.OK)',
    '  @RequiresPermissions(' + q(p + ':add') + ')',
    '  @Auditable({ action: ' +
      q(p + ':add') +
      ', resourceType: ' +
      q(ctx.slug) +
      ' })',
    '  @Idempotent({ scope: ' + q(p + ':add') + ' })',
    "  @ApiOperation({ summary: '新建" + ctx.label + "' })",
    "  @ApiOkZod('" +
      ctx.Name +
      "', " +
      ctx.camel +
      "ResponseSchema, '新建后的" +
      ctx.label +
      "')",
    '  create(@Body({ schema: create' +
      ctx.Name +
      'Schema }) dto: Create' +
      ctx.Name +
      'Input) {',
    '    return this.service.create(dto);',
    '  }',
    '',
    '  @Put(' + q(':id') + ')',
    '  @HttpCode(HttpStatus.OK)',
    '  @RequiresPermissions(' + q(p + ':edit') + ')',
    '  @Auditable({ action: ' +
      q(p + ':edit') +
      ', resourceType: ' +
      q(ctx.slug) +
      ", resourceIdParam: 'id' })",
    '  @Idempotent({ scope: ' + q(p + ':edit') + ' })',
    "  @ApiOperation({ summary: '更新" + ctx.label + "' })",
    "  @ApiOkZod('" +
      ctx.Name +
      "', " +
      ctx.camel +
      "ResponseSchema, '更新后的" +
      ctx.label +
      "')",
    '  update(',
    '    @Param(' + q('id') + ', { schema: idParamSchema }) id: number,',
    '    @Body({ schema: update' +
      ctx.Name +
      'Schema }) dto: Update' +
      ctx.Name +
      'Input,',
    '  ) {',
    '    return this.service.update(id, dto);',
    '  }',
    '',
    '  @Delete(' + q(':id') + ')',
    '  @HttpCode(HttpStatus.OK)',
    '  @RequiresPermissions(' + q(p + ':remove') + ')',
    '  @Auditable({ action: ' +
      q(p + ':remove') +
      ', resourceType: ' +
      q(ctx.slug) +
      ", resourceIdParam: 'id' })",
    '  @Idempotent({ scope: ' + q(p + ':remove') + ' })',
    "  @ApiOperation({ summary: '删除" + ctx.label + "（软删除）' })",
    "  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示删除成功')",
    '  remove(@Param(' + q('id') + ', { schema: idParamSchema }) id: number) {',
    '    return this.service.remove(id);',
    '  }',
    '}',
  ]);
}

function moduleFile(ctx: Ctx): string {
  const withFile = fileFields(ctx).length > 0;
  return block([
    "import { Module } from '@nestjs/common';",
    "import { TypeOrmModule } from '@nestjs/typeorm';",
    ...(withFile
      ? ["import { FileModule } from '../file/file.module.js';"]
      : []),
    ...(withFile
      ? [
          'import { ' +
            ctx.Name +
            "FileHandler } from './adapters/" +
            ctx.slug +
            "-file.handler.js';",
        ]
      : []),
    'import { ' +
      ctx.Name +
      "Controller } from './" +
      ctx.slug +
      ".controller.js';",
    'import { ' + ctx.Name + "Service } from './" + ctx.slug + ".service.js';",
    'import { ' + ctx.Name + " } from './entities/" + ctx.slug + ".entity.js';",
    '',
    '/** ' + ctx.label + '模块（gen:module 生成）。 */',
    '@Module({',
    '  imports: [TypeOrmModule.forFeature([' +
      ctx.Name +
      '])' +
      (withFile ? ', FileModule' : '') +
      '],',
    '  controllers: [' + ctx.Name + 'Controller],',
    '  providers: [' +
      ctx.Name +
      'Service' +
      (withFile ? ', ' + ctx.Name + 'FileHandler' : '') +
      '],',
    '})',
    'export class ' + ctx.Name + 'Module {}',
  ]);
}

function createMigration(ctx: Ctx): string {
  return block([
    "import type { MigrationInterface, QueryRunner } from 'typeorm';",
    '',
    '/** ' +
      ctx.label +
      '建表（gen:module 生成）。已跑迁移不可改，字段调整请追加新迁移。 */',
    'export class Create' +
      ctx.Name +
      ctx.ts +
      ' implements MigrationInterface {',
    "  name = 'Create" + ctx.Name + ctx.ts + "';",
    '',
    '  public async up(queryRunner: QueryRunner): Promise<void> {',
    '    const sql = [',
    "      'CREATE TABLE IF NOT EXISTS " + ctx.table + " (',",
    "      '  id int NOT NULL AUTO_INCREMENT,',",
    "      '  create_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6),',",
    "      '  update_time datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),',",
    "      '  delete_time datetime(6) DEFAULT NULL,',",
    ...columnFields(ctx).map((f) => '      "  ' + sqlColumn(f) + '",'),
    "      '  PRIMARY KEY (id),',",
    ...(ctx.unique
      ? [
          "      '  UNIQUE KEY uk_" +
            ctx.table +
            '_' +
            ctx.unique.column +
            ' (' +
            ctx.unique.column +
            "),',",
        ]
      : []),
    "      '  KEY idx_" + ctx.table + "_create_time (create_time)',",
    '      ") ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT=\'' +
      ctx.label +
      '\'",',
    "    ].join('\\n');",
    '    await queryRunner.query(sql);',
    '  }',
    '',
    '  public async down(queryRunner: QueryRunner): Promise<void> {',
    "    await queryRunner.query('DROP TABLE IF EXISTS " + ctx.table + "');",
    '  }',
    '}',
  ]);
}

function seedMigration(ctx: Ctx): string {
  const menuPath = (ctx.menuParent ? ctx.menuParent : '') + '/' + ctx.slug;
  return block([
    "import type { MigrationInterface, QueryRunner } from 'typeorm';",
    '',
    '/** ' + ctx.label + '菜单（gen:module 生成）。',
    ' * 只建菜单、不自动授权：业务权限给谁是人的决定。',
    ' * 幂等：按 path 判重。' +
      (ctx.menuParent
        ? '父菜单：' +
          ctx.menuParent +
          '（不存在直接报错，不静默退化成根菜单）。'
        : ''),
    ' */',
    'export class Seed' +
      ctx.Name +
      'Setup' +
      ctx.ts2 +
      ' implements MigrationInterface {',
    "  name = 'Seed" + ctx.Name + 'Setup' + ctx.ts2 + "';",
    '',
    '  public async up(queryRunner: QueryRunner): Promise<void> {',
    '    const parentPath = ' + q(ctx.menuParent ?? '') + ';',
    '    const parent = parentPath',
    '      ? ((await queryRunner.query(',
    "          'SELECT id, ancestors FROM sys_menu WHERE path = ? AND delete_time IS NULL LIMIT 1',",
    '          [parentPath],',
    '        )) as Array<{ id: number; ancestors: string }>)',
    '      : [];',
    '    if (parentPath && parent.length === 0) {',
    '      throw new Error(' +
      q(
        '父菜单不存在：' +
          (ctx.menuParent ?? '') +
          '（--menu-parent 只认已存在的 path）',
      ) +
      ');',
    '    }',
    '    const parentId = parent[0]?.id ?? null;',
    "    const ancestors = parent[0] ? parent[0].ancestors + ',' + parent[0].id : '0';",
    '',
    '    const sql = [',
    "      'INSERT INTO sys_menu',",
    "      '  (parent_id, name, type, path, component, perms, icon, sort, visible, status, ancestors)',",
    "      \"SELECT ?, ?, 'C', ?, ?, ?, 'Document', 20, 1, 1, ?\",",
    "      'WHERE NOT EXISTS (SELECT 1 FROM sys_menu WHERE path = ?)',",
    "    ].join('\\n');",
    '    await queryRunner.query(sql, [',
    '      parentId,',
    '      ' + q(ctx.label) + ',',
    '      ' + q(menuPath) + ',',
    '      ' + q(ctx.slug + '/' + ctx.Name + 'View') + ',',
    '      ' + q(ctx.perm + ':list') + ',',
    '      ancestors,',
    '      ' + q(menuPath) + ',',
    '    ]);',
    '  }',
    '',
    '  public async down(queryRunner: QueryRunner): Promise<void> {',
    '    await queryRunner.query(' +
      q('DELETE FROM sys_menu WHERE path = ?') +
      ', [' +
      q(menuPath) +
      ']);',
    '  }',
    '}',
  ]);
}

/** 附件适配器：把「谁能看这个业务对象的附件」交回本模块 */
function handlerFile(ctx: Ctx): string {
  const fields = fileFields(ctx).map((f) => q(f.name));
  return block([
    "import { Injectable, type OnModuleInit } from '@nestjs/common';",
    'import {',
    '  FileBizRegistry,',
    '  type FileBizContext,',
    '  type FileBizHandler,',
    "} from '../../file/file-biz.registry.js';",
    'import { ' + ctx.Name + "Service } from '../" + ctx.slug + ".service.js';",
    '',
    '/** ' +
      ctx.label +
      '附件接入（gen:module 生成）。允许的用途：' +
      fileFields(ctx)
        .map((f) => f.name)
        .join(' / ') +
      '。',
    ' * 文件模块按 bizType 查到这里，判定权不写在底座里。',
    ' */',
    '@Injectable()',
    'export class ' +
      ctx.Name +
      'FileHandler implements FileBizHandler, OnModuleInit {',
    '  constructor(',
    '    private readonly registry: FileBizRegistry,',
    '    private readonly service: ' + ctx.Name + 'Service,',
    '  ) {}',
    '',
    '  /** 与业务列表同一套可见性判定：附件权限必须与业务对象同源 */',
    '  canAccess(ctx: FileBizContext, bizId: string): Promise<boolean> {',
    '    return this.service.canAccess(ctx, Number(bizId));',
    '  }',
    '',
    '  readonly fields = [' + fields.join(', ') + '] as const;',
    '',
    '  onModuleInit(): void {',
    '    this.registry.register(' + q(ctx.slug) + ', this);',
    '  }',
    '}',
  ]);
}
function apiFile(ctx: Ctx): string {
  return block([
    "import { downloadCsv } from '../utils/download';",
    "import { request } from './http';",
    '',
    '/** ' +
      ctx.label +
      '（与后端响应契约对齐；跑过 openapi:dump 后可换成 types.ts 的生成类型） */',
    'export interface ' + ctx.Name + 'Item {',
    '  id: number;',
    '  createTime: string;',
    '  updateTime: string;',
    ...columnFields(ctx).map((f) => '  ' + f.name + ': ' + jsType(f) + ';'),
    '}',
    '',
    'export interface ' + ctx.Name + 'Body {',
    ...columnFields(ctx).map((f) => '  ' + f.name + '?: ' + jsType(f) + ';'),
    '}',
    '',
    'export interface ' + ctx.Name + 'ImportResult {',
    '  total: number;',
    '  ok: number;',
    '  failed: Array<{ row: number; message: string }>;',
    '  failedTruncated: boolean;',
    '}',
    '',
    'export const ' + ctx.camel + 'Api = {',
    '  page: (params: object): Promise<{ list: ' +
      ctx.Name +
      'Item[]; total: number }> =>',
    "    request.get('/" + ctx.slug + "', params),",
    '  create: (body: ' + ctx.Name + 'Body): Promise<' + ctx.Name + 'Item> =>',
    "    request.post('/" + ctx.slug + "', body),",
    '  update: (id: number, body: Partial<' +
      ctx.Name +
      'Body>): Promise<' +
      ctx.Name +
      'Item> =>',
    "    request.put('/" + ctx.slug + "/' + id, body),",
    '  remove: (id: number): Promise<boolean> =>',
    "    request.delete('/" + ctx.slug + "/' + id),",
    '  exportCsv: (params: { keyword?: string }): Promise<void> => {',
    "    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');",
    "    return downloadCsv('/" +
      ctx.slug +
      "/export', params, '" +
      ctx.label +
      "-' + stamp + '.csv');",
    '  },',
    '  importCsv: (file: File): Promise<' + ctx.Name + 'ImportResult> => {',
    '    const form = new FormData();',
    "    form.append('file', file);",
    "    return request.post('/" + ctx.slug + "/import', form);",
    '  },',
    '};',
  ]);
}

function viewFile(ctx: Ctx): string {
  const dictFields = ctx.fields.filter((f) => f.type === 'dict');
  const attachFields = fileFields(ctx);
  const titleField =
    columnFields(ctx).find((f) => f.type === 'string')?.name ?? 'id';
  const dictTypes = Array.from(
    new Set(dictFields.map((f) => f.dictType ?? '')),
  );
  const boolFields = ctx.fields.filter((f) => f.type === 'bool');
  const dateFields = ctx.fields.filter((f) => f.type === 'datetime');
  const requiredStrings = ctx.fields.filter((f) => f.type === 'string');

  const lines: string[] = [
    '<script setup lang="ts">',
    "import { Download, Plus, Refresh, Search, Upload } from '@element-plus/icons-vue';",
    "import { ElMessage, type FormRules } from 'element-plus';",
    'import { computed, ' +
      (dictFields.length ? 'onMounted, ' : '') +
      "reactive, ref } from 'vue';",
    'import { ' +
      ctx.camel +
      'Api, type ' +
      ctx.Name +
      'Body, type ' +
      ctx.Name +
      "Item } from '../../api/" +
      ctx.slug +
      "';",
  ];
  if (dictFields.length)
    lines.push("import { dictApi } from '../../api/dict';");
  lines.push(
    ...(attachFields.length
      ? ["import BizFiles from '../../components/BizFiles.vue';"]
      : []),
    "import DataTable, { type TableColumn } from '../../components/DataTable.vue';",
    "import FormDialog, { type FormColumn } from '../../components/FormDialog.vue';",
    "import ImportDialog from '../../components/ImportDialog.vue';",
    "import { useCrud } from '../../composables/useCrud';",
    '',
    '/** ' +
      ctx.label +
      '（gen:module 生成：列表 + 新建/编辑 + 导入导出）。 */',
    'type Query = { pageNum: number; pageSize: number; keyword: string };',
    '',
    'const fmtTime = (value?: string | null): string =>',
    "  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';",
    '',
    'const { query, rows, total, loading, reload, search, reset, remove } = useCrud<',
    '  ' + ctx.Name + 'Item,',
    '  Query',
    '>({',
    '  api: ' + ctx.camel + 'Api,',
    "  query: { pageNum: 1, pageSize: 10, keyword: '' },",
    "  removeText: () => '确认删除该" + ctx.label + "？',",
    '});',
    '',
  );

  if (dictFields.length) {
    lines.push(
      '// 字典字段的选项：一次性拉取，formColumns 直接消费',
      'const dictOptions = reactive<Record<string, Array<{ label: string; value: string }>>>({});',
      '',
      'async function loadDicts(): Promise<void> {',
      ...dictTypes.map(
        (d) =>
          '  dictOptions[' + q(d) + '] = await dictApi.options(' + q(d) + ');',
      ),
      '}',
      '',
    );
  }

  lines.push(
    'const columns: TableColumn[] = [',
    ...columnFields(ctx).map(tableColumn),
    "  { label: '创建时间', width: 170, slot: 'createTime' },",
    '];',
    '',
    'const dialogVisible = ref(false);',
    "const dialogMode = ref<'create' | 'edit'>('create');",
    'const editingId = ref<number | null>(null);',
    'const submitting = ref(false);',
    'const importVisible = ref(false);',
    'const exporting = ref(false);',
    '',
    'const EMPTY: ' + ctx.Name + 'Body = {',
    ...columnFields(ctx).map(
      (f) =>
        '  ' +
        f.name +
        ': ' +
        (f.type === 'int' || f.type === 'decimal' || f.type === 'bool'
          ? '0'
          : f.type === 'datetime'
            ? 'null'
            : q('')) +
        ',',
    ),
    '};',
    '',
    'const form = reactive<' + ctx.Name + 'Body>({ ...EMPTY });',
    '',
    'const formColumns = computed<FormColumn[]>(() => [',
    ...columnFields(ctx).map(formColumn),
    ']);',
    '',
    'const rules: FormRules = {',
    ...requiredStrings.map(
      (f) =>
        '  ' +
        f.name +
        ': [{ required: true, message: ' +
        q('请输入' + f.label) +
        ", trigger: 'blur' }],",
    ),
    '};',
    '',
    'function openCreate(): void {',
    "  dialogMode.value = 'create';",
    '  editingId.value = null;',
    '  Object.assign(form, EMPTY);',
    '  dialogVisible.value = true;',
    '}',
    '',
    'function openEdit(row: ' + ctx.Name + 'Item): void {',
    "  dialogMode.value = 'edit';",
    '  editingId.value = row.id;',
    '  Object.assign(form, {',
    ...columnFields(ctx).map((f) => '    ' + f.name + ': row.' + f.name + ','),
    '  });',
    '  dialogVisible.value = true;',
    '}',
    '',
    'async function submitForm(): Promise<void> {',
    '  submitting.value = true;',
    '  try {',
    "    if (dialogMode.value === 'create') {",
    '      await ' + ctx.camel + 'Api.create({ ...form });',
    "      ElMessage.success('创建成功');",
    '    } else if (editingId.value !== null) {',
    '      await ' + ctx.camel + 'Api.update(editingId.value, { ...form });',
    "      ElMessage.success('更新成功');",
    '    }',
    '    dialogVisible.value = false;',
    '    await reload();',
    '  } catch {',
    '    // 已提示',
    '  } finally {',
    '    submitting.value = false;',
    '  }',
    '}',
    '',
    'async function handleExport(): Promise<void> {',
    '  exporting.value = true;',
    '  try {',
    '    await ' +
      ctx.camel +
      'Api.exportCsv({ keyword: query.keyword || undefined });',
    '  } catch {',
    '    // 已提示',
    '  } finally {',
    '    exporting.value = false;',
    '  }',
    '}',
    '',
  );

  if (dictFields.length) {
    lines.push('onMounted(() => {', '  void loadDicts();', '});', '');
  }

  if (attachFields.length) {
    lines.push(
      'const fileVisible = ref(false);',
      'const fileTarget = ref<' + ctx.Name + 'Item | null>(null);',
      '',
      'function openFiles(row: ' + ctx.Name + 'Item): void {',
      '  fileTarget.value = row;',
      '  fileVisible.value = true;',
      '}',
      '',
      'const fileTitle = computed(() =>',
      "  '附件 - ' + (fileTarget.value ? String(fileTarget.value." +
        titleField +
        ") : ''),",
      ');',
      '',
    );
  }

  lines.push(
    '</script>',
    '',
    '<template>',
    '  <div>',
    '    <el-card shadow="never" class="page-card">',
    '      <div class="page-toolbar">',
    '        <el-input v-model="query.keyword" placeholder="关键字" clearable style="width: 200px" @keyup.enter="search" />',
    '        <el-button :icon="Search" type="primary" @click="search">查询</el-button>',
    '        <el-button :icon="Refresh" @click="reset">重置</el-button>',
    '        <div class="page-toolbar-right">',
    '          <el-button v-perm="' +
      q(ctx.perm + ':export') +
      '" :icon="Download" :loading="exporting" @click="handleExport">导出</el-button>',
    '          <el-button v-perm="' +
      q(ctx.perm + ':import') +
      '" :icon="Upload" @click="importVisible = true">导入</el-button>',
    '          <el-button v-perm="' +
      q(ctx.perm + ':add') +
      '" :icon="Plus" type="primary" @click="openCreate">新建</el-button>',
    '        </div>',
    '      </div>',
    '',
    '      <DataTable',
    '        v-model:page="query.pageNum"',
    '        v-model:page-size="query.pageSize"',
    '        :columns="columns"',
    '        :rows="rows"',
    '        :loading="loading"',
    '        :total="total"',
    '        @change="reload"',
    '      >',
  );

  for (const f of boolFields) {
    lines.push(
      '        <template #' + f.name + '="{ row }">',
      '          <el-tag :type="row.' +
        f.name +
        " === 1 ? 'success' : 'info'\" size=\"small\">",
      '            {{ row.' + f.name + " === 1 ? '是' : '否' }}",
      '          </el-tag>',
      '        </template>',
      '',
    );
  }
  for (const f of dateFields) {
    lines.push(
      '        <template #' +
        f.name +
        '="{ row }">{{ fmtTime(row.' +
        f.name +
        ') }}</template>',
      '',
    );
  }

  lines.push(
    '        <template #createTime="{ row }">{{ fmtTime(row.createTime) }}</template>',
    '',
    '        <el-table-column label="操作" width="' +
      (attachFields.length ? 200 : 140) +
      '" fixed="right">',
    '          <template #default="{ row }">',
    '            <el-button v-perm="' +
      q(ctx.perm + ':edit') +
      '" link type="primary" @click="openEdit(row as ' +
      ctx.Name +
      'Item)">编辑</el-button>',
    ...(attachFields.length
      ? [
          '            <el-button link type="primary" @click="openFiles(row as ' +
            ctx.Name +
            'Item)">附件</el-button>',
        ]
      : []),
    '            <el-button v-perm="' +
      q(ctx.perm + ':remove') +
      '" link type="danger" @click="remove(row as ' +
      ctx.Name +
      'Item)">删除</el-button>',
    '          </template>',
    '        </el-table-column>',
    '      </DataTable>',
    '    </el-card>',
    '',
    '    <ImportDialog',
    '      v-model="importVisible"',
    '      title="导入' + ctx.label + '"',
    '      :upload="' + ctx.camel + 'Api.importCsv"',
    '      @done="reload"',
    '    />',
    '',
    '    <FormDialog',
    '      v-model="dialogVisible"',
    "      :title=\"dialogMode === 'create' ? '新建" +
      ctx.label +
      "' : '编辑" +
      ctx.label +
      '\'"',
    '      :model="form"',
    '      :columns="formColumns"',
    '      :rules="rules"',
    '      :saving="submitting"',
    '      @submit="submitForm"',
    '    />',
    '',
    ...(attachFields.length
      ? [
          '    <el-drawer v-model="fileVisible" :title="fileTitle" size="560px">',
          '      <template v-if="fileTarget">',
          ...attachFields.flatMap((f) => [
            '        <div class="attach-block">',
            '          <div class="attach-title">' + f.label + '</div>',
            '          <BizFiles',
            '            biz-type="' + ctx.slug + '"',
            '            :biz-id="fileTarget.id"',
            '            biz-field="' + f.name + '"',
            '          />',
            '        </div>',
          ]),
          '      </template>',
          '    </el-drawer>',
          '',
        ]
      : []),
    '  </div>',
    '</template>',
    '',
    ...(attachFields.length
      ? [
          '<style scoped>',
          '.attach-block + .attach-block {',
          '  margin-top: 20px;',
          '}',
          '',
          '.attach-title {',
          '  margin-bottom: 8px;',
          '  font-weight: 600;',
          '}',
          '</style>',
          '',
        ]
      : []),
  );

  return lines.join('\n');
}

// ── 组装与落盘 ────────────────────────────────────────────────

function buildFiles(ctx: Ctx): Array<{ path: string; content: string }> {
  const dir = resolve(SERVER, 'src/modules/' + ctx.slug);
  const mig = resolve(SERVER, 'src/core/database/migrations');
  return [
    {
      path: resolve(dir, 'entities/' + ctx.slug + '.entity.ts'),
      content: entityFile(ctx),
    },
    {
      path: resolve(dir, 'dto/' + ctx.slug + '.dto.ts'),
      content: dtoFile(ctx),
    },
    {
      path: resolve(dir, 'dto/' + ctx.slug + '.response.ts'),
      content: responseFile(ctx),
    },
    { path: resolve(dir, ctx.slug + '.csv.ts'), content: csvFile(ctx) },
    { path: resolve(dir, ctx.slug + '.service.ts'), content: serviceFile(ctx) },
    {
      path: resolve(dir, ctx.slug + '.controller.ts'),
      content: controllerFile(ctx),
    },
    { path: resolve(dir, ctx.slug + '.module.ts'), content: moduleFile(ctx) },
    ...(fileFields(ctx).length
      ? [
          {
            path: resolve(dir, 'adapters/' + ctx.slug + '-file.handler.ts'),
            content: handlerFile(ctx),
          },
        ]
      : []),
    {
      path: resolve(mig, ctx.ts + '-Create' + ctx.Name + '.ts'),
      content: createMigration(ctx),
    },
    {
      path: resolve(mig, ctx.ts2 + '-Seed' + ctx.Name + 'Setup.ts'),
      content: seedMigration(ctx),
    },
    {
      path: resolve(WEB_ADMIN, 'src/api/' + ctx.slug + '.ts'),
      content: apiFile(ctx),
    },
    {
      path: resolve(
        WEB_ADMIN,
        'src/views/' + ctx.slug + '/' + ctx.Name + 'View.vue',
      ),
      content: viewFile(ctx),
    },
  ];
}

function patchAppModule(ctx: Ctx): void {
  const file = resolve(SERVER, 'src/app.module.ts');
  let text = readFileSync(file, 'utf8');
  const importLine =
    'import { ' +
    ctx.Name +
    "Module } from './modules/" +
    ctx.slug +
    '/' +
    ctx.slug +
    ".module.js';";
  if (text.includes(importLine)) return;
  if (!text.includes('// <gen:import>'))
    die('app.module.ts 缺少 // <gen:import> 锚点');
  if (!text.includes('// <gen:module>'))
    die('app.module.ts 缺少 // <gen:module> 锚点');
  text = text.replace('// <gen:import>', importLine + '\n// <gen:import>');
  text = text.replace(
    '    // <gen:module>',
    '    ' + ctx.Name + 'Module,\n    // <gen:module>',
  );
  writeFileSync(file, text, 'utf8');
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const now = Date.now();
  const ctx: Ctx = {
    slug: args.slug,
    Name: pascal(args.slug),
    camel: camelName(args.slug),
    upper: args.slug.toUpperCase().replace(/-/g, '_'),
    label: args.label,
    table: args.slug,
    perm: args.slug + ':' + args.slug,
    fields: args.fields,
    ts: String(now),
    ts2: String(now + 1),
    menuParent: args.menuParent,
    unique: args.uniqueName
      ? args.fields.find((f) => f.name === args.uniqueName)
      : undefined,
  };

  const files = buildFiles(ctx);
  const conflicts = files.filter((f) => existsSync(f.path));

  if (args.dryRun) {
    console.log('==> 将生成 ' + files.length + ' 个文件：');
    for (const f of files) console.log('   ' + f.path.replace(ROOT + '/', ''));
    if (conflicts.length) {
      console.log('');
      console.log('⚠️  以下文件已存在，实际执行会拒绝：');
      for (const f of conflicts)
        console.log('   ' + f.path.replace(ROOT + '/', ''));
    }
    return;
  }

  if (conflicts.length)
    die(
      '目标文件已存在，先删除或换 slug：\n   ' +
        conflicts.map((f) => f.path).join('\n   '),
    );

  for (const file of files) {
    mkdirSync(dirname(file.path), { recursive: true });
    writeFileSync(file.path, file.content, 'utf8');
  }
  patchAppModule(ctx);

  console.log(
    '==> 已生成 ' +
      files.length +
      ' 个文件（' +
      ctx.slug +
      ' / ' +
      ctx.label +
      '）',
  );
  console.log('');
  console.log('下一步：');
  console.log('  1. cd server && pnpm build         # 类型检查');
  console.log('  2. cd server && pnpm authz:sync     # 权限码落库');
  console.log('  3. cd server && pnpm migration:run  # 建表 + 菜单');
  console.log('  4. 给角色授权（生成器不猜业务权限归属）');
}

main();
