import { onUnmounted } from 'vue';

/**
 * 按「标签」让数据失效 —— 就是一个极简版的 `queryKey` + `invalidateQueries`。
 *
 * ## 解决什么
 * 后台里同一份数据被多处使用：部门树既给部门页用，也给用户页的「所属部门」下拉用；
 * 角色列表既给角色页用，也给用户页的「分配角色」用。
 *
 * 在部门页新增一个部门之后，用户页那个下拉**不会知道**——
 * 它只在页面挂载时加载过一次。用户要么刷新整页，要么以为"没生效"。
 *
 * 这里给数据打标签，谁改了数据就 `invalidate('dept')`，
 * 所有订阅了 `dept` 的地方自己重新拉一遍。**不用重建页面，也不用记住谁依赖谁。**
 *
 * ## 和 TanStack Query 的差别
 * 只借它的思路，不引入它的缓存层：本项目的列表状态由 `useCrud` 管，
 * 再叠一层缓存只会产生两套真相。这里只做「失效通知」，数据仍由各页面自己持有。
 *
 * ## 用法
 * ```ts
 * // 消费方：数据变了就重新加载
 * useRefetch(['dept', 'role'], async () => { await Promise.all([loadDeptTree(), loadRoles()]); });
 *
 * // 变更方：改完数据通知一声
 * await deptApi.create({ ...form });
 * await invalidate('dept');
 * ```
 */

type Handler = () => void | Promise<unknown>;

const registry = new Map<string, Set<Handler>>();

/**
 * 订阅若干标签。
 * @returns 取消订阅函数（`useRefetch` 会在卸载时自动调用）
 */
export function subscribe(tags: string[], handler: Handler): () => void {
  const registered: string[] = [];
  for (const tag of tags) {
    let set = registry.get(tag);
    if (!set) {
      set = new Set<Handler>();
      registry.set(tag, set);
    }
    set.add(handler);
    registered.push(tag);
  }
  return () => {
    for (const tag of registered) {
      const set = registry.get(tag);
      if (!set) continue;
      set.delete(handler);
      if (set.size === 0) registry.delete(tag); // 页面走了就别留着闭包
    }
  };
}

/** 让订阅了这些标签的所有地方重新加载。串行执行，避免同时打满接口 */
export async function invalidate(...tags: string[]): Promise<void> {
  const handlers = new Set<Handler>();
  for (const tag of tags) {
    registry.get(tag)?.forEach((h) => handlers.add(h));
  }
  for (const handler of handlers) {
    await handler();
  }
}

/**
 * 组件内使用：挂载即订阅，卸载自动退订。
 * `handler` 里抛错不影响其它订阅者（各自的数据各自负责）。
 */
export function useRefetch(tags: string[], handler: Handler): void {
  const off = subscribe(tags, handler);
  onUnmounted(off);
}
