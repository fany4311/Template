import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { authApi } from '../api/auth';
import { tokenStorage } from '../api/http';
import type { Profile } from '../api/types';
import { matchPermission } from '../utils/permission';

/**
 * 后台准入权限码：只有超管/管理员持有。
 *
 * 名字刻意**不落在 `system:` 域**下：管理员的授权是 `*:*:*,!system:*`，
 * `!system:*` 会把整个 system 域挡掉 —— 若用 `system:console:access`，
 * 连管理员都进不来后台。
 */
export const CONSOLE_ACCESS_PERM = 'console:access';

/**
 * 登录态：token + 当前用户档案（角色/权限/数据范围）。
 * 权限判定与后端同源（同一套 deny 优先的通配规则），用于菜单与按钮显隐。
 */
export const useAuthStore = defineStore('auth', () => {
  const token = ref(tokenStorage.get());
  const profile = ref<Profile | null>(null);

  const permissions = computed(() => profile.value?.permissions ?? []);
  /** 角色编号（level）数组：程序判据用它（编号不可改） */
  const roles = computed(() => profile.value?.roles ?? []);
  /** 角色名称数组，与 roles 同序 —— 只用于展示（名称可改） */
  const roleNames = computed(() => profile.value?.roleNames ?? []);
  const displayName = computed(
    () => profile.value?.nickname || profile.value?.username || '',
  );

  function hasPermission(required: string): boolean {
    return matchPermission(permissions.value, required);
  }

  /** 能否进后台。**必须在 fetchProfile() 之后判定**，档案未加载时恒为 false。 */
  const canAccessConsole = computed(() =>
    matchPermission(permissions.value, CONSOLE_ACCESS_PERM),
  );

  async function login(
    username: string,
    password: string,
    captcha?: { uuid?: string; code?: string },
  ): Promise<void> {
    const result = await authApi.login({
      username,
      password,
      captchaUuid: captcha?.uuid,
      captchaCode: captcha?.code,
    });
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
    canAccessConsole,
    login,
    fetchProfile,
    logout,
    reset,
  };
});
