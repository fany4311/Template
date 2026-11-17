import { defineStore } from 'pinia';
import { ref } from 'vue';
import { menuApi } from '../api/menu';
import type { MenuItem } from '../api/types';

/**
 * 动态菜单：登录后由后端返回「当前用户可见」的菜单树。
 * 菜单既驱动侧边栏渲染，也驱动路由注册（见 router/index.ts）。
 */
export const useMenuStore = defineStore('menu', () => {
  const tree = ref<MenuItem[]>([]);
  const loaded = ref(false);

  async function load(): Promise<MenuItem[]> {
    tree.value = await menuApi.routes();
    loaded.value = true;
    return tree.value;
  }

  /** 第一个可跳转的叶子菜单（登录后默认落点） */
  function firstLeaf(): MenuItem | null {
    const walk = (items: MenuItem[]): MenuItem | null => {
      for (const item of items) {
        if (item.type === 'C' && item.path) return item;
        const found = walk(item.children ?? []);
        if (found) return found;
      }
      return null;
    };
    return walk(tree.value);
  }

  function reset(): void {
    tree.value = [];
    loaded.value = false;
  }

  return { tree, loaded, load, firstLeaf, reset };
});
