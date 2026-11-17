import { createPinia } from 'pinia';
import { createApp } from 'vue';
import App from './App.vue';
import { onUnauthorized } from './api/http';
import router from './router';
import { useAuthStore } from './stores/auth';
import './styles/index.css';

const app = createApp(App);
const pinia = createPinia();

app.use(pinia);
app.use(router);

/** 401 统一处理：清空登录态并回登录页（拦截器已清 token） */
onUnauthorized(() => {
  useAuthStore(pinia).reset();
  if (router.currentRoute.value.path !== '/login') {
    void router.replace('/login');
  }
});

app.mount('#app');
