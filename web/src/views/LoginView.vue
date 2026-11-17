<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { authApi } from '../api/auth';
import { ApiError } from '../api/http';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const route = useRoute();
const router = useRouter();

/** 验证码由后端 CAPTCHA_ENABLED 控制；前端用同名环境变量决定是否展示 */
const captchaEnabled = import.meta.env.VITE_CAPTCHA_ENABLED === 'true';

const loading = ref(false);
const errorMsg = ref('');
const captchaImg = ref('');
const captchaUuid = ref('');

const captchaSrc = computed(() =>
  captchaImg.value
    ? `data:image/svg+xml;utf8,${encodeURIComponent(captchaImg.value)}`
    : '',
);

const form = reactive({
  username: '',
  password: '',
  captchaCode: '',
});

const redirect = computed(() => {
  const target = route.query.redirect;
  return typeof target === 'string' && target.startsWith('/') ? target : '/';
});

async function refreshCaptcha(): Promise<void> {
  if (!captchaEnabled) return;
  try {
    const data = await authApi.captcha();
    captchaImg.value = data.img;
    captchaUuid.value = data.uuid;
    form.captchaCode = '';
  } catch {
    captchaImg.value = '';
  }
}

async function handleSubmit(): Promise<void> {
  errorMsg.value = '';

  if (!form.username.trim() || !form.password) {
    errorMsg.value = '请输入用户名和密码';
    return;
  }

  loading.value = true;
  try {
    await auth.login({
      username: form.username.trim(),
      password: form.password,
      captchaUuid: captchaUuid.value || undefined,
      captchaCode: form.captchaCode || undefined,
    });
    await router.replace(redirect.value);
  } catch (error) {
    // 拦截器只负责网络/业务异常；JS 运行时错误必须在这里暴露，
    // 否则表现为「点了按钮没反应、控制台也干净」，无从排查。
    if (error instanceof ApiError) {
      errorMsg.value = error.message;
    } else {
      console.error('[login] 未预期错误', error);
      errorMsg.value = '登录失败：客户端异常，请查看控制台';
    }
    await refreshCaptcha();
  } finally {
    loading.value = false;
  }
}

onMounted(refreshCaptcha);
</script>

<template>
  <div class="login-page">
    <form class="login-card" @submit.prevent="handleSubmit">
      <h2 class="login-title">Template 管理平台</h2>
      <p class="login-subtitle">校内自建安全管理与应急平台</p>

      <p v-if="errorMsg" class="form-error">{{ errorMsg }}</p>

      <div class="field">
        <label for="username">用户名</label>
        <input
          id="username"
          v-model="form.username"
          type="text"
          autocomplete="username"
          placeholder="请输入用户名"
        />
      </div>

      <div class="field">
        <label for="password">密码</label>
        <input
          id="password"
          v-model="form.password"
          type="password"
          autocomplete="current-password"
          placeholder="请输入密码"
        />
      </div>

      <div v-if="captchaEnabled" class="field">
        <label for="captcha">验证码</label>
        <div style="display: flex; gap: 8px; align-items: center">
          <input
            id="captcha"
            v-model="form.captchaCode"
            type="text"
            placeholder="请输入验证码"
          />
          <img
            v-if="captchaImg"
            :src="captchaSrc"
            alt="验证码"
            style="height: 38px; cursor: pointer; border-radius: 4px"
            @click="refreshCaptcha"
          />
        </div>
      </div>

      <button class="btn" type="submit" :disabled="loading">
        {{ loading ? '登录中…' : '登 录' }}
      </button>
    </form>
  </div>
</template>
