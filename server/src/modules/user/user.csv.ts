import { z } from 'zod';
import type { CsvColumn } from '../../common/import-export/csv.js';
import type { User } from './entities/user.entity.js';

/**
 * 用户 CSV 契约。
 *
 * 导出与导入用**两套列**：
 * - 导出给人看：不带密码、不带部门 id（id 对人没意义）
 * - 导入给人填：部门用**名称**（管理员不会去查 dept_id），初始密码可选
 *
 * 密码绝不导出：一旦导出成明文，文件流转到哪都说不清。
 */
export const USER_EXPORT_COLUMNS: CsvColumn<User>[] = [
  { header: '账号', field: 'username' },
  { header: '昵称', field: 'nickname' },
  { header: '手机号', field: 'phone' },
  { header: '邮箱', field: 'email' },
  { header: '岗位', field: 'post' },
  {
    header: '状态',
    field: 'status',
    format: (row) => (row.status === 1 ? '正常' : '停用'),
    parse: (cell) => (cell === '停用' || cell === '0' ? '0' : '1'),
  },
];

/** 导入列：与导出不同，允许「部门」和「初始密码」两列 */
export interface UserImportRow {
  username: string;
  nickname: string;
  deptName: string;
  phone: string;
  post: string;
  initialPassword: string;
}

export const USER_IMPORT_COLUMNS: CsvColumn<UserImportRow>[] = [
  { header: '账号', field: 'username' },
  { header: '昵称', field: 'nickname' },
  { header: '部门', field: 'deptName' },
  { header: '手机号', field: 'phone' },
  { header: '岗位', field: 'post' },
  { header: '初始密码', field: 'initialPassword' },
];

export const userImportRowSchema = z.object({
  username: z
    .string()
    .trim()
    .min(2, '账号至少 2 位')
    .max(50, '账号不超过 50 位'),
  nickname: z.string().trim().max(50, '昵称不超过 50 位').default(''),
  deptName: z.string().trim().max(100).default(''),
  phone: z.string().trim().max(20, '手机号不超过 20 位').default(''),
  post: z.string().trim().max(64, '岗位不超过 64 位').default(''),
  initialPassword: z.string().default(''),
});
