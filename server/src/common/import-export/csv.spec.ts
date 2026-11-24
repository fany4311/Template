import { describe, expect, it } from 'vitest';
import {
  CSV_MAX_ROWS,
  decodeCsv,
  encodeCsv,
  exportRows,
  readRows,
  type CsvColumn,
} from './csv.js';

interface Row {
  id: number;
  name: string;
  status: number;
  remark: string;
}

const columns: CsvColumn<Row>[] = [
  { header: 'ID', field: 'id' },
  { header: '名称', field: 'name' },
  {
    header: '状态',
    field: 'status',
    format: (row) => (row.status === 1 ? '正常' : '停用'),
    parse: (cell) => (cell === '正常' || cell === '1' ? '1' : '0'),
  },
  { header: '备注', field: 'remark' },
];

describe('encodeCsv', () => {
  it('带 BOM 与 CRLF，逗号/引号/换行会被转义', () => {
    const csv = encodeCsv(
      ['a', 'b'],
      [
        ['x,1', 'he said "hi"'],
        ['line\nbreak', ' y '],
      ],
    );
    expect(csv.startsWith('\uFEFF')).toBe(true);
    expect(csv).toContain('\r\n');
    expect(csv).toContain('"x,1"');
    expect(csv).toContain('"he said ""hi"""');
    expect(csv).toContain('"line\nbreak"');
  });
});

describe('decodeCsv', () => {
  it('往返一致（含引号、逗号、换行）', () => {
    const rows = [
      ['a,b', 'c"d'],
      ['e\nf', 'g'],
    ];
    expect(decodeCsv(encodeCsv(['h1', 'h2'], rows))).toEqual([
      ['h1', 'h2'],
      ...rows,
    ]);
  });

  it('兼容 LF 与结尾空行', () => {
    expect(decodeCsv('a,b\n1,2\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('引号未闭合要报错', () => {
    expect(() => decodeCsv('a,b\n"1,2')).toThrow(/引号未闭合/);
  });
});

describe('readRows', () => {
  it('按表头名匹配，不依赖列顺序；状态归一为 1/0', () => {
    const text = '备注,状态,名称,ID\nr1,正常,n1,1\nr2,停用,n2,2\n';
    expect(readRows(text, columns)).toEqual([
      { id: '1', name: 'n1', status: '1', remark: 'r1' },
      { id: '2', name: 'n2', status: '0', remark: 'r2' },
    ]);
  });

  it('缺表头直接报错（防错列静默入错字段）', () => {
    expect(() => readRows('ID,名称\n1,n1\n', columns)).toThrow(/缺少表头/);
  });

  it('跳过纯空行', () => {
    const text = 'ID,名称,状态,备注\n1,n1,正常,r\n,,\n';
    expect(readRows(text, columns)).toHaveLength(1);
  });

  it('超过上限报错', () => {
    const line = '1,n1,正常,r';
    const text =
      'ID,名称,状态,备注\n' +
      Array.from({ length: CSV_MAX_ROWS + 1 }, () => line).join('\n');
    expect(() => readRows(text, columns)).toThrow(/最多导入/);
  });
});

describe('exportRows', () => {
  it('使用 format 输出中文标签', () => {
    const csv = exportRows<Row>(
      [{ id: 1, name: 'n', status: 0, remark: '' }],
      columns,
    );
    expect(csv).toContain('ID,名称,状态,备注');
    expect(csv).toContain('1,n,停用,');
  });
});
