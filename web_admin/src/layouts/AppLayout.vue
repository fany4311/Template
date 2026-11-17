<script setup lang="ts">
import { Setting, SwitchButton } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { authApi } from '../api/auth';
import SideMenu from '../components/SideMenu.vue';
import ThemeDrawer from '../components/ThemeDrawer.vue';
import { resetMenuRoutes } from '../router';
import { useAuthStore } from '../stores/auth';
import { useMenuStore } from '../stores/menu';
import { useThemeStore } from '../stores/theme';

/** 与后端 PASSWORD_MIN_LENGTH 对齐（见 server auth/dto/password.dto.ts） */
const PASSWORD_MIN_LENGTH = 8;

const auth = useAuthStore();
const menu = useMenuStore();
const route = useRoute();
const router = useRouter();

const theme = useThemeStore();
const themeVisible = ref(false);

// 全局默认外观存在 sys_config 的 ui.theme，登录后才可读；
// 读不到（未配置/无权限）就沿用本地偏好与内置默认，不阻断任何操作。
onMounted(() => {
  void theme.loadRemote();
});

const menus = computed(() => menu.tree);
const currentTitle = computed(() => (route.meta.title as string | undefined) ?? '');

async function handleLogout(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认退出登录？', '提示', { type: 'warning' });
  } catch {
    return;
  }
  await goLogin();
}

/** 清本地登录态并跳登录页（登出/改密后共用） */
async function goLogin(): Promise<void> {
  await auth.logout();
  menu.reset();
  resetMenuRoutes();
  await router.replace('/login');
}

// ---------------------------------------------------------------------------
// 修改密码
// 后端改密成功后会立刻使**当前会话**失效，所以这里成功后主动清 token 跳登录页，
// 而不是等下一个请求撞 401（那样会弹一句莫名其妙的「登录已失效」）。
// ---------------------------------------------------------------------------
const pwdVisible = ref(false);
const pwdSubmitting = ref(false);
const pwdFormRef = ref<{ validate: () => Promise<boolean> } | null>(null);
const pwdForm = reactive({ oldPassword: '', newPassword: '', confirmPassword: '' });

const pwdRules = {
  oldPassword: [{ required: true, message: '请输入原密码', trigger: 'blur' }],
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    {
      min: PASSWORD_MIN_LENGTH,
      message: `新密码至少 ${PASSWORD_MIN_LENGTH} 位`,
      trigger: 'blur',
    },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_r: unknown, v: string, cb: (e?: Error) => void) => {
        if (v !== pwdForm.newPassword) cb(new Error('两次输入的新密码不一致'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
};

function openPwdDialog(): void {
  pwdForm.oldPassword = '';
  pwdForm.newPassword = '';
  pwdForm.confirmPassword = '';
  pwdVisible.value = true;
}

async function submitPwd(): Promise<void> {
  try {
    await pwdFormRef.value?.validate();
  } catch {
    return;
  }
  pwdSubmitting.value = true;
  try {
    await authApi.changePassword({
      oldPassword: pwdForm.oldPassword,
      newPassword: pwdForm.newPassword,
    });
    pwdVisible.value = false;
    ElMessage.success('密码已修改，请用新密码重新登录');
    await goLogin();
  } catch {
    // 错误提示由 http 层统一弹出（原密码错误等业务码）
  } finally {
    pwdSubmitting.value = false;
  }
}
</script>

<template>
  <el-container class="layout">
    <el-aside width="220px" class="layout-aside">
      <div class="layout-logo">Template 管理平台</div>
      <el-menu :default-active="route.path" router class="layout-menu">
        <SideMenu :items="menus" />
      </el-menu>
    </el-aside>

    <el-container>
      <el-header class="layout-header">
        <div class="layout-title">{{ currentTitle }}</div>
        <div class="layout-actions">
          <el-tooltip content="外观（主色 / 字号 / 暗色）" placement="bottom">
            <el-button text :icon="Setting" @click="themeVisible = true" />
          </el-tooltip>
          <el-dropdown trigger="click">
            <span class="layout-user">
              {{ auth.displayName || '未命名用户' }}
              <!-- 展示用角色名（auth.roles 是编号 level，同序）：名称可改，只作展示 -->
              <el-tag v-if="auth.roleNames.length" size="small" type="info">
                {{ auth.roleNames.join(' / ') }}
              </el-tag>
            </span>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item @click="openPwdDialog">修改密码</el-dropdown-item>
                <el-dropdown-item :icon="SwitchButton" @click="handleLogout">
                  退出登录
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </el-header>

      <el-main class="layout-main">
        <router-view />
      </el-main>
    </el-container>

    <el-dialog v-model="pwdVisible" title="修改密码" width="420px">
      <el-form
        ref="pwdFormRef"
        :model="pwdForm"
        :rules="pwdRules"
        label-width="90px"
      >
        <el-form-item label="原密码" prop="oldPassword">
          <el-input v-model="pwdForm.oldPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input v-model="pwdForm.newPassword" type="password" show-password />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input
            v-model="pwdForm.confirmPassword"
            type="password"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button type="primary" :loading="pwdSubmitting" @click="submitPwd">
          确定
        </el-button>
      </template>
    </el-dialog>

    <ThemeDrawer v-model="themeVisible" />
  </el-container>
</template>
