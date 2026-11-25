import { ElMessage } from 'element-plus';
import {
  createRouter,
  createWebHistory,
  type RouteRecordRaw,
} from 'vue-router';
import type { MenuItem } from '../api/types';
import { menuApi } from '../api/menu';
import AppLayout from '../layouts/AppLayout.vue';
import { useAuthStore } from '../stores/auth';
import { useMenuStore } from '../stores/menu';

/**
 * 路由分两层：
 * 1) 静态：登录页、布局壳、403（无权限）、404。
 * 2) 动态：登录后按 `/menu/pages` 注册**全部** C 型页面；
 *    侧边栏仍用 `/menu/routes`（只含当前用户有权限的）。
 *
 * 为什么路由用「全部页面」而不用「有权限的」：
 * 只注册有权限的路由时，无权限的地址在路由表里不存在 → 命中 catch-all →
 * 渲染「404 页面不存在」。这句话是错的：页面存在，只是你没权限。
 * 现在全套注册，无权限由守卫读 `meta.perm` 拦下 → 渲染 403；真不存在的路径仍是 404。
 * 权限边界不会因此变松：前端路由只是 UI，后端每个接口都有 `@RequiresPermissions`。
 */
const viewModules = import.meta.glob('../views/**/*.vue');
const NotFoundView = () => import('../views/NotFoundView.vue');
const ForbiddenView = () => import('../views/ForbiddenView.vue');

function resolveView(component: string) {
  const key = `../views/${component}.vue`;
  return viewModules[key] ?? NotFoundView;
}

const routes: RouteRecordRaw[] = [
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/LoginView.vue'),
    meta: { public: true, title: '登录' },
  },
  {
    path: '/',
    name: 'layout',
    component: AppLayout,
    children: [
      {
        path: '/403',
        name: 'forbidden',
        component: ForbiddenView,
        meta: { title: '没有访问权限' },
      },
    ],
  },
  {
    path: '/:pathMatch(.*)*',
    name: 'not-found',
    component: NotFoundView,
    meta: { public: true, title: '页面不存在' },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

/** 已注册的动态路由名（登出时清理，避免脏路由残留） */
const dynamicRouteNames: string[] = [];

/**
 * 注册全部 C 型页面（扁平列表，不递归）。
 * 传入的应当是 `/menu/pages` 的结果（**全量**，不是当前用户可见菜单）。
 */
export function registerMenuRoutes(pages: MenuItem[]): void {
  for (const item of pages) {
    if (item.type !== 'C' || !item.path || !item.component) continue;
    const name = `menu-${item.id}`;
    if (router.hasRoute(name)) continue;
    router.addRoute('layout', {
      path: item.path,
      name,
      component: resolveView(item.component),
      meta: {
        title: item.name,
        perm: item.perms || undefined,
        icon: item.icon || undefined,
      },
    });
    dynamicRouteNames.push(name);
  }
}

export function resetMenuRoutes(): void {
  for (const name of dynamicRouteNames.splice(0)) {
    if (router.hasRoute(name)) router.removeRoute(name);
  }
}

router.beforeEach(async (to) => {
  const auth = useAuthStore();

  document.title = to.meta.title
    ? `${to.meta.title as string} - Template 管理平台`
    : 'Template 管理平台';

  // 登录页：已登录则回首页
  if (to.name === 'login') {
    return auth.token ? { path: '/' } : true;
  }

  // 未登录：public 页面放行，其余带去登录页
  if (!auth.token) {
    /**
     * catch-all（`not-found`）也标了 public —— 那是给**已登录**用户刷新深链用的：
     * 动态路由注册前，`/system/user` 只能匹配到 catch-all。
     * 但未登录时放行它，用户看到的是「页面不存在」，而不是登录页。
     * 深链本就是"登录后要去的地址"，所以这里带 redirect 去登录更合理。
     */
    if (to.meta.public && to.name !== 'not-found') return true;
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  /**
   * 已登录：先把动态路由注册好，**再**判断 public / 权限。
   *
   * 顺序很关键。刷新（F5）时 URL 先于动态路由被解析，`/system/user` 这类深链会
   * 先命中 `/:pathMatch(.*)*` 这个 catch-all；而它带 `meta.public: true`，
   * 若把 public 判断放在前面，守卫会直接放行并渲染 404 —— 这就是「刷新 404」的成因。
   */
  const menu = useMenuStore();
  if (!auth.profile || !menu.loaded) {
    try {
      if (!auth.profile) await auth.fetchProfile();

      /**
       * 后台准入：只有带 `console:access` 的账号能进后台（当前 = 超管 + 管理员）。
       * 判定只看**权限码**，不看角色名 —— 角色名可以随便改，权限码是契约。
       * 普通业务用户该去 web（前端 8084），不是这里。
       *
       * 必须放在 fetchProfile() 之后：档案未加载时 permissions 是空数组，
       * 提前判会把所有人生生踢出去。
       *
       * 注意这只是**前端顺手挡一下**：前端守卫是可以绕过的，真正敏感的操作
       * 后台每个接口都有 `@RequiresPermissions` 兜底。
       */
      if (!auth.canAccessConsole) {
        auth.reset();
        menu.reset();
        resetMenuRoutes();
        ElMessage.error('该账号没有后台访问权限');
        return { path: '/login' };
      }

      // 侧边栏用「有权限的树」，路由用「全部页面」：两件事不能混
      if (!menu.loaded) {
        const [pages] = await Promise.all([menuApi.pages(), menu.load()]);
        registerMenuRoutes(pages);
      }
    } catch {
      auth.reset();
      menu.reset();
      resetMenuRoutes();
      return { path: '/login', query: { redirect: to.fullPath } };
    }
    // 路由表刚变了：按 **路径** 重新解析本次导航。
    // 不能整体展开 `to`（它带着上一轮的 name='not-found'，会按名字解析回去导致死循环），
    // 也不会有循环风险：重进守卫时 menu.loaded 已为 true，本分支不再进入。
    return { path: to.fullPath, replace: true };
  }

  // 其余 public 页面（404）放行
  if (to.meta.public) return true;

  // 根路径 → 第一个可见叶子菜单；一个都没有 → 403（而不是白屏）
  if (to.path === '/') {
    const leaf = menu.firstLeaf();
    return leaf?.path ? { path: leaf.path } : { name: 'forbidden' };
  }

  /**
   * 权限校验：路由已全量注册，所以「页面存在但无权限」在这里被拦下，
   * 渲染 403 而不是 404。真正不存在的路径仍然走 catch-all → 404。
   */
  const perm = to.meta.perm as string | undefined;
  if (perm && !auth.hasPermission(perm)) {
    ElMessage.error('没有访问权限');
    return { name: 'forbidden' };
  }

  return true;
});

export default router;
