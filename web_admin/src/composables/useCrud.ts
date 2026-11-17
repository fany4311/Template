import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, reactive, ref, type Ref } from 'vue';

/**
 * 列表页的「状态机」：分页 / 加载 / 查询 / 重置 / 删除。
 *
 * ## 为什么只包这一层
 * 列表页 80% 的代码是同一套样板（loading + rows + total + 翻页重置），
 * 但**新增/编辑表单**每个模块差异很大（有的带附件、有的带状态机），
 * 硬抽成通用 CRUD 工厂只会变成一堆 if。所以这里只收「列表」这一半，
 * 表单交给 FormDialog，业务分支留在视图里。
 *
 * ## 竞态
 * 连续点翻页时，先发的请求可能后回来，把新页数据覆盖成旧页。
 * 用自增序号丢弃过期响应 —— 比 debounce 更准（debounce 只是减少请求）。
 */

export interface PagedQuery {
  pageNum: number;
  pageSize: number;
}

export interface PageLike<T> {
  list: T[];
  total: number;
}

/** 主键可能是 number，也可能是序列化成字符串的 bigint（如日志类表） */
export type RowId = number | string;

export interface CrudApi<T extends { id: RowId }, Q> {
  page: (query: Q) => Promise<PageLike<T>>;
  remove?: (id: T['id']) => Promise<unknown>;
}

export interface UseCrudOptions<T extends { id: RowId }, Q extends PagedQuery> {
  api: CrudApi<T, Q>;
  /** 初始查询条件（必须含 pageNum/pageSize）；reset() 会回到这份快照 */
  query: Q;
  /** 删除确认文案 */
  removeText?: (row: T) => string;
  /** 是否在 onMounted 自动加载，默认 true */
  autoLoad?: boolean;
}

export interface UseCrudResult<T extends { id: RowId }, Q extends PagedQuery> {
  query: Q;
  rows: Ref<T[]>;
  total: Ref<number>;
  loading: Ref<boolean>;
  reload: () => Promise<void>;
  search: () => Promise<void>;
  reset: () => Promise<void>;
  remove: (row: T) => Promise<void>;
}

export function useCrud<T extends { id: RowId }, Q extends PagedQuery>(
  options: UseCrudOptions<T, Q>,
): UseCrudResult<T, Q> {
  const initial = { ...options.query };
  const query = reactive({ ...options.query }) as Q;

  const rows = ref([]) as Ref<T[]>;
  const total = ref(0);
  const loading = ref(false);

  let seq = 0;

  async function reload(): Promise<void> {
    const current = ++seq;
    loading.value = true;
    try {
      const result = await options.api.page({ ...query } as Q);
      if (current !== seq) return; // 过期响应：已经有更新的请求发出去了
      rows.value = result.list;
      total.value = result.total;
    } catch {
      // 错误提示由 http 层统一弹出，这里只负责别把 loading 挂死
    } finally {
      if (current === seq) loading.value = false;
    }
  }

  /** 查询：条件变了要回到第 1 页，否则会停在一个空页上 */
  async function search(): Promise<void> {
    query.pageNum = 1;
    await reload();
  }

  async function reset(): Promise<void> {
    Object.assign(query, initial);
    await reload();
  }

  async function remove(row: T): Promise<void> {
    if (!options.api.remove) return;
    const text = options.removeText ? options.removeText(row) : '确认删除该记录？';
    try {
      await ElMessageBox.confirm(text, '提示', { type: 'warning' });
    } catch {
      return;
    }
    try {
      await options.api.remove(row.id);
      ElMessage.success('删除成功');
      // 删掉当前页最后一条时往前退一页，避免停在空页
      if (rows.value.length === 1 && query.pageNum > 1) {
        query.pageNum -= 1;
      }
      await reload();
    } catch {
      // 已提示
    }
  }

  if (options.autoLoad !== false) {
    onMounted(() => {
      void reload();
    });
  }

  return { query, rows, total, loading, reload, search, reset, remove };
}
