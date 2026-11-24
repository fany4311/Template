<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { useAuthStore } from '../stores/auth';

/**
 * 登录成功页 —— 最小壳的全部内容。
 *
 * 存在的意义：证明「登录 → 拿档案 → 带 token 请求」这条链路通了，
 * 并给 Nginx / PM2 的部署规划一个可验证的落点。
 * 业务页面从零开始加：照抄 web_admin 的动态菜单 + 权限指令那套机制。
 */
const auth = useAuthStore();
const router = useRouter();

const loading = ref(false);

async function handleLogout(): Promise<void> {
  loading.value = true;
  try {
    await auth.logout();
    await router.replace('/login');
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  // 刷新页面后 token 还在，但档案是内存态 —— 补一次
  if (auth.token && !auth.profile) {
    try {
      await auth.fetchProfile();
    } catch {
      // 401 已由拦截器清 token 并跳登录页
    }
  }
});
</script>

<template>
  <div class="home-page">
    <h1>✅ 登录成功</h1>

    <div class="home-meta">
      <div>你好，<strong>{{ auth.displayName || '未命名用户' }}</strong></div>
      <div>
        角色：<code>{{
          auth.roleNames.length ? auth.roleNames.join('、') : '无'
        }}</code>
      </div>
      <div>
        权限码：<code>{{
          auth.permissions.length ? auth.permissions.length + ' 条' : '无'
        }}</code>
      </div>
    </div>

    <div class="home-actions">
      <button class="btn-inline" :disabled="loading" @click="handleLogout">
        退出登录
      </button>
    </div>
  </div>
</template>
