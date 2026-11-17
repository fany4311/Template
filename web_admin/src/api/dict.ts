import { request } from './http';
import type { DictDataItem, DictOption, DictTypeItem, PageResult } from './types';

export interface DictTypeCreateBody {
  dictName: string;
  dictType: string;
  status?: number;
  remark?: string;
}

export interface DictDataCreateBody {
  dictType: string;
  dictLabel: string;
  dictValue: string;
  dictSort?: number;
  tagType?: string;
  status?: number;
  remark?: string;
}

export const dictApi = {
  pageType: (params: object): Promise<PageResult<DictTypeItem>> =>
    request.get<PageResult<DictTypeItem>>('/dict/type', params),
  createType: (body: DictTypeCreateBody): Promise<DictTypeItem> =>
    request.post<DictTypeItem>('/dict/type', body),
  updateType: (id: number, body: Partial<DictTypeCreateBody>): Promise<DictTypeItem> =>
    request.put<DictTypeItem>(`/dict/type/${id}`, body),
  removeType: (id: number): Promise<boolean> =>
    request.delete<boolean>(`/dict/type/${id}`),

  pageData: (params: object): Promise<PageResult<DictDataItem>> =>
    request.get<PageResult<DictDataItem>>('/dict/data', params),
  createData: (body: DictDataCreateBody): Promise<DictDataItem> =>
    request.post<DictDataItem>('/dict/data', body),
  updateData: (id: number, body: Partial<DictDataCreateBody>): Promise<DictDataItem> =>
    request.put<DictDataItem>(`/dict/data/${id}`, body),
  removeData: (id: number): Promise<boolean> =>
    request.delete<boolean>(`/dict/data/${id}`),

  /** 前端下拉选项（登录即可） */
  options: (dictType: string): Promise<DictOption[]> =>
    request.get<DictOption[]>(`/dict/options/${dictType}`),
};
