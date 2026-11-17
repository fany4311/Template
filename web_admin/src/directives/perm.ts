import type { Directive, DirectiveBinding } from 'vue';
import { useAuthStore } from '../stores/auth';

/**
 * 按钮级权限指令：`v-perm="'system:user:add'"` 或 `v-perm="['a', 'b']"`（满足任一）。
 * 无权限时直接移除节点。
 */
function apply(el: HTMLElement, binding: DirectiveBinding<string | string[]>): void {
  const auth = useAuthStore();
  const required = Array.isArray(binding.value) ? binding.value : [binding.value];
  const allowed = required.some((perm) => auth.hasPermission(perm));
  if (!allowed) el.remove();
}

export const permission: Directive<HTMLElement, string | string[]> = {
  mounted: apply,
  updated: apply,
};
