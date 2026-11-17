import ElementPlus from 'element-plus';
import zhCn from 'element-plus/es/locale/lang/zh-cn';
import 'element-plus/dist/index.css';
// Element Plus 暗色变量（html.dark 时生效）：不引入的话暗色只有自定义壳变色
import 'element-plus/theme-chalk/dark/css-vars.css';
import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { onUnauthorized } from './api/http';
import { permission } from './directives/perm';
import router, { resetMenuRoutes } from './router';
import { useAuthStore } from './stores/auth';
import { useMenuStore } from './stores/menu';
import { useThemeStore } from './stores/theme';
import './styles/theme.css';
import './styles/index.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);
app.use(ElementPlus, { locale: zhCn });
app.directive('perm', permission);

// 首屏立即套用本地主题，避免白底闪一下再变深色
useThemeStore(pinia).init();

/** 401 统一处理：清空登录态并回登录页（拦截器已清 token） */
onUnauthorized(() => {
  useAuthStore(pinia).reset();
  useMenuStore(pinia).reset();
  resetMenuRoutes();
  if (router.currentRoute.value.path !== '/login') {
    void router.replace('/login');
  }
});

app.mount('#app');
