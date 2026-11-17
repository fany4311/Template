import { ApiException } from '../exceptions/api.exception.js';

/**
 * CSV 编解码 + 列映射（导入导出共用）。
 *
 * ## 为什么是 CSV 不是 xlsx
 * xlsx 要引入 exceljs/xlsx（新增依赖需审批、且体积不小）。本项目 95% 的场景是
 * 「导出列表给领导看」「导入一批名单」，CSV 带 UTF-8 BOM 后 Excel / WPS 双击能正常打开，
 * 中文不乱码。真要带样式/公式/多 sheet 时再单独评估。
 *
 * ## 约定
 * - 导出：BOM + CRLF（Excel 友好，Windows 换行不串行）
 * - 导入：按**表头名**匹配，不依赖列顺序；缺表头直接报错，避免「错列静默入错字段」
 * - 单次上限：导出/导入都 5000 行（CSV_MAX_ROWS），超了让人先缩小范围
 */

export const CSV_MAX_ROWS = 5000;

/** 导入失败明细的最大条数：5000 行全错时别把响应撑爆 */
export const CSV_MAX_FAILED = 200;

export interface CsvColumn<T> {
  /** 表头（用户看到的列名） */
  header: string;
  /** 对应字段（导入时写回这个键） */
  field: keyof T & string;
  /** 导出时的格式化（如状态 1 → 正常） */
  format?: (row: T) => string;
  /** 导入时的归一（如 正常 → '1'），返回字符串交给 Zod 校验 */
  parse?: (cell: string) => string;
}

export interface ImportFailure {
  /** CSV 行号（含表头，1 起；与 Excel 行号对齐，便于用户定位） */
  row: number;
  message: string;
}

export interface ImportResult {
  total: number;
  ok: number;
  failed: ImportFailure[];
  /** failed 超过 CSV_MAX_FAILED 时为 true（只展示前 N 条） */
  failedTruncated: boolean;
}

function escapeCell(value: string): string {
  if (/[",\r\n]/.test(value) || /^\s|\s$/.test(value)) {
    return '"' + value.replace(/"/g, '""') + '"';
  }
  return value;
}

/** 生成 CSV 文本（含 BOM + CRLF） */
export function encodeCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(escapeCell).join(','));
  return '\uFEFF' + lines.join('\r\n') + '\r\n';
}

/**
 * 解析 CSV 文本。支持：BOM、CRLF/LF、引号内含逗号/换行、双引号转义。
 * 引号未闭合视为格式错误（比「猜一个」安全）。
 */
export function decodeCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i] as string;

    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      cell += ch;
      i += 1;
      continue;
    }

    if (ch === '"') {
      quoted = true;
      i += 1;
      continue;
    }
    if (ch === ',') {
      row.push(cell);
      cell = '';
      i += 1;
      continue;
    }
    if (ch === '\r' || ch === '\n') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
      i += 1;
      continue;
    }

    cell += ch;
    i += 1;
  }

  if (quoted) throw new ApiException('CSV 格式错误：引号未闭合', 400);
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** 按列定义把实体数组编成 CSV */
export function exportRows<T extends object>(rows: T[], columns: CsvColumn<T>[]): string {
  const header = columns.map((col) => col.header);
  const body = rows.map((row) =>
    columns.map((col) => {
      if (col.format) return col.format(row);
      const value = (row as Record<string, unknown>)[col.field];
      return value === null || value === undefined ? '' : String(value);
    }),
  );
  return encodeCsv(header, body);
}

/**
 * 按列定义把 CSV 文本读成「字段 → 字符串」的记录数组。
 * 这里只做「表头校验 + 单元格归一」，类型/业务校验交给调用方的 Zod schema。
 */
export function readRows<T>(
  text: string,
  columns: CsvColumn<T>[],
): Record<string, string>[] {
  const table = decodeCsv(text);
  if (table.length === 0) throw new ApiException('CSV 内容为空', 400);

  const header = (table[0] ?? []).map((cell) => cell.trim());
  const indexOf = new Map<string, number>();
  header.forEach((name, index) => {
    if (name && !indexOf.has(name)) indexOf.set(name, index);
  });

  const missing = columns.filter((col) => !indexOf.has(col.header)).map((col) => col.header);
  if (missing.length > 0) {
    throw new ApiException('CSV 缺少表头：' + missing.join('、'), 400);
  }

  const records: Record<string, string>[] = [];
  for (const cells of table.slice(1)) {
    if (cells.every((cell) => cell.trim() === '')) continue; // 跳过纯空行
    const record: Record<string, string> = {};
    for (const col of columns) {
      const index = indexOf.get(col.header) as number;
      const raw = (cells[index] ?? '').trim();
      record[col.field] = col.parse ? col.parse(raw) : raw;
    }
    records.push(record);
  }

  if (records.length > CSV_MAX_ROWS) {
    throw new ApiException('一次最多导入 ' + CSV_MAX_ROWS + ' 行，请拆分文件', 400);
  }
  return records;
}
