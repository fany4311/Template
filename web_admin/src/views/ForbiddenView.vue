<script setup lang="ts">
import { useRouter } from 'vue-router';
import { useMenuStore } from '../stores/menu';

const router = useRouter();
const menu = useMenuStore();

/** 回到第一个有权限的页面；一个都没有就回登录页（不该发生，兜底） */
async function back(): Promise<void> {
  const leaf = menu.firstLeaf();
  await router.replace(leaf?.path ?? '/login');
}
</script>

<template>
  <div class="forbidden">
    <h1>403</h1>
    <p>没有访问权限</p>
    <p class="forbidden-hint">
      当前账号未被授予该页面的权限。如需访问，请联系管理员分配角色。
    </p>
    <el-button type="primary" @click="back">返回首页</el-button>
  </div>
</template>

<style scoped>
.forbidden {
  padding: 80px 0;
  text-align: center;
}
.forbidden h1 {
  margin: 0;
  font-size: 72px;
  color: var(--el-color-warning);
}
.forbidden p {
  margin: 8px 0;
  color: var(--el-text-color-regular);
}
.forbidden-hint {
  margin-bottom: 24px;
  font-size: 13px;
  color: var(--el-text-color-secondary);
}
</style>
