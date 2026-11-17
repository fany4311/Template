<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage, type FormInstance, type FormRules } from 'element-plus';
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

const formRef = ref<FormInstance>();
const loading = ref(false);
const captchaImg = ref('');
const captchaUuid = ref('');

/** SVG → data URI（btoa 不能直接在模板里用） */
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

const rules: FormRules = {
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
};

const redirect = computed(() => {
  const target = route.query.redirect;
  return typeof target === 'string' && target.startsWith('/') ? target : '/';
});

async function refreshCaptcha(): Promise<void> {
  if (!captchaEnabled) return;
  const data = await authApi.captcha();
  captchaImg.value = data.img;
  captchaUuid.value = data.uuid;
  form.captchaCode = '';
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  loading.value = true;
  try {
    await auth.login(form.username, form.password, {
      uuid: captchaUuid.value,
      code: form.captchaCode,
    });
    ElMessage.success('登录成功');
    await router.replace(redirect.value);
  } catch (error) {
    // HTTP / 业务异常已由 http 拦截器统一提示；验证码一次有效，失败后刷新。
    // 但拦截器只管网络请求，JS 运行时错误（如浏览器 API 在当前上下文不可用）
    // 必须在这里暴露 —— 否则表现为「点了按钮没反应、控制台也干净」，无从排查。
    if (!(error instanceof ApiError)) {
      console.error('[login] 未预期错误', error);
      ElMessage.error('登录失败：客户端异常，请查看控制台');
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
    <el-card class="login-card" shadow="always">
      <h2 class="login-title">Template 管理平台</h2>
      <p class="login-subtitle">校内自建安全管理与应急平台</p>

      <el-form
        ref="formRef"
        :model="form"
        :rules="rules"
        label-position="top"
        @keyup.enter="handleSubmit"
      >
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" placeholder="请输入用户名" clearable />
        </el-form-item>

        <el-form-item label="密码" prop="password">
          <el-input
            v-model="form.password"
            type="password"
            placeholder="请输入密码"
            show-password
          />
        </el-form-item>

        <el-form-item v-if="captchaEnabled" label="验证码" prop="captchaCode">
          <div class="login-captcha">
            <el-input v-model="form.captchaCode" placeholder="请输入验证码" />
            <img
              v-if="captchaImg"
              :src="captchaSrc"
              alt="验证码"
              class="login-captcha-img"
              @click="refreshCaptcha"
            />
            <el-button :icon="Refresh" circle @click="refreshCaptcha" />
          </div>
        </el-form-item>

        <el-button
          type="primary"
          class="login-submit"
          :loading="loading"
          @click="handleSubmit"
        >
          登 录
        </el-button>
      </el-form>
    </el-card>
  </div>
</template>
