<script setup lang="ts">
import type { MenuItem } from '../api/types';

/** 递归渲染菜单树：M=目录（子菜单）、C=菜单（可点击） */
defineProps<{ items: MenuItem[] }>();
</script>

<template>
  <template v-for="item in items" :key="item.id">
    <el-sub-menu
      v-if="item.children?.length"
      :index="item.path || `group-${item.id}`"
    >
      <template #title>
        <span>{{ item.name }}</span>
      </template>
      <SideMenu :items="item.children" />
    </el-sub-menu>
    <!-- 只有 C（页面）且带 path 才算可点击；目录无子项时不渲染，
         避免出现「点进去 404」的空气节点 -->
    <el-menu-item v-else-if="item.type === 'C' && item.path" :index="item.path">
      <span>{{ item.name }}</span>
    </el-menu-item>
  </template>
</template>
