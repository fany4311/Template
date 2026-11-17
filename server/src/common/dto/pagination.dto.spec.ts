import { describe, expect, it } from 'vitest';
import { paginationSchema } from './pagination.dto.js';

describe('paginationSchema', () => {
  it('缺省时使用默认分页', () => {
    const r = paginationSchema.parse({});
    expect(r).toEqual({ pageNum: 1, pageSize: 10 });
  });

  it('字符串数字会强制转换', () => {
    const r = paginationSchema.parse({ pageNum: '3', pageSize: '20' });
    expect(r).toEqual({ pageNum: 3, pageSize: 20 });
  });

  it('pageSize 超上限应校验失败', () => {
    expect(paginationSchema.safeParse({ pageSize: 999 }).success).toBe(false);
  });
});
