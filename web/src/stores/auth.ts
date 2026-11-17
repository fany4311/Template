import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi, type LoginBody } from '../api/auth';
import { tokenStorage } from '../api/http';
import type { Profile } from '../api/types';
import { matchPermission } from '../utils/permission';

/**
 * 登录态：token + 当前用户档案。
 *
 * ⚠️ 与后台端 web_admin 的区别：这里**不做后台准入判定**（没有 `console:access` 检查）。
 * 前端（web）面向普通业务用户，任何有账号的人都能登录；
 * 后台（web_admin）才要求 `console:access` 权限。
 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref(tokenStorage.get());
  const profile = ref<Profile | null>(null);

  const permissions = computed(() => profile.value?.permissions ?? []);
  /** 角色编号（level）数组：程序判据用它 */
  const roles = computed(() => profile.value?.roles ?? []);
  /** 角色名称数组，与 roles 同序 —— 只用于展示 */
  const roleNames = computed(() => profile.value?.roleNames ?? []);
  const displayName = computed(
    () => profile.value?.nickname || profile.value?.username || '',
  );

  function hasPermission(required: string): boolean {
    return matchPermission(permissions.value, required);
  }

  async function login(body: LoginBody): Promise<void> {
    const result = await authApi.login(body);
    tokenStorage.set(result.token);
    token.value = result.token;
    profile.value = null;
    await fetchProfile();
  }

  async function fetchProfile(): Promise<Profile> {
    const data = await authApi.profile();
    profile.value = data;
    return data;
  }

  function reset(): void {
    tokenStorage.clear();
    token.value = '';
    profile.value = null;
  }

  async function logout(): Promise<void> {
    try {
      await authApi.logout();
    } finally {
      reset();
    }
  }

  return {
    token,
    profile,
    permissions,
    roles,
    roleNames,
    displayName,
    hasPermission,
    login,
    fetchProfile,
    logout,
    reset,
  };
});
