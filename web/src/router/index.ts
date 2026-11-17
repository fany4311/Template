import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';

/**
 * 前端（web）路由 —— 最小壳。
 *
 * 只有两个页面：登录页、登录成功页。
 * 没有「动态菜单注册」这一层 —— 那是后台端 web_admin 的机制。
 * 将来 web 长出业务页面时，可直接照抄 web_admin/src/router/index.ts 的动态路由做法。
 */
const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { public: true, title: '登录' },
    },
    {
      path: '/',
      name: 'home',
      component: () => import('../views/HomeView.vue'),
      meta: { title: '首页' },
    },
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      redirect: '/',
    },
  ],
});

router.beforeEach((to) => {
  const auth = useAuthStore();

  document.title = to.meta.title
    ? `${to.meta.title as string} - Template 管理平台`
    : 'Template 管理平台';

  if (to.name === 'login') {
    return auth.token ? { path: '/' } : true;
  }

  if (!auth.token) {
    return { path: '/login', query: { redirect: to.fullPath } };
  }

  return true;
});

export default router;
