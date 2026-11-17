<script setup lang="ts">
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { useAuthStore } from '../stores/auth';
import { useThemeStore } from '../stores/theme';

/**
 * 外观设置抽屉：主色 / 导航色 / 字号 / 圆角 / 暗色。
 *
 * 交互约定：
 * - 改动**立即生效**（不用点确定），同时写 localStorage 作为个人偏好；
 * - 「恢复默认」只清个人偏好，全局默认（sys_config 的 ui.theme）仍然生效；
 * - 「保存为全局默认」需要 system:config:edit（实际只有超管持有）。
 */
const visible = defineModel<boolean>({ default: false });

const theme = useThemeStore();
const auth = useAuthStore();

const saving = ref(false);
const canSaveGlobal = computed(() => auth.hasPermission('system:config:edit'));

function onMode(value: string | number | boolean | undefined): void {
  theme.patch({ mode: value === 'dark' ? 'dark' : 'light' });
}

function onPrimary(value: string | null): void {
  if (value) theme.patch({ primary: value });
}

function onNavBg(value: string | null): void {
  if (value) theme.patch({ navBg: value });
}

function onNavText(value: string | null): void {
  if (value) theme.patch({ navText: value });
}

function onFontSize(value: string | number | boolean | undefined): void {
  const size = Number(value);
  if (Number.isFinite(size)) theme.patch({ fontSize: size });
}

function onRadius(value: number | number[]): void {
  const radius = Array.isArray(value) ? (value[0] ?? 4) : value;
  theme.patch({ radius });
}

async function saveGlobal(): Promise<void> {
  saving.value = true;
  try {
    await theme.saveGlobal();
    ElMessage.success('已保存为全局默认外观');
  } catch {
    // 失败提示由 http 层统一弹出（无权限/网络）
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <el-drawer v-model="visible" title="外观" size="380px" append-to-body>
    <div class="theme-section">
      <div class="theme-section__label">模式</div>
      <el-radio-group
        :model-value="theme.cfg.mode"
        @update:model-value="onMode"
      >
        <el-radio-button value="light">亮色</el-radio-button>
        <el-radio-button value="dark">暗色</el-radio-button>
      </el-radio-group>
    </div>

    <div class="theme-section">
      <div class="theme-section__label">主色</div>
      <div class="theme-swatches">
        <button
          v-for="c in theme.presets"
          :key="c"
          type="button"
          class="theme-swatch"
          :class="{ 'is-active': c === theme.cfg.primary }"
          :style="{ background: c }"
          :aria-label="c"
          @click="theme.patch({ primary: c })"
        />
        <el-color-picker
          :model-value="theme.cfg.primary"
          @update:model-value="onPrimary"
        />
      </div>
    </div>

    <div class="theme-section">
      <div class="theme-section__label">导航</div>
      <div class="theme-row">
        <span class="theme-row__text">底色</span>
        <el-color-picker
          :model-value="theme.effectiveNavBg"
          @update:model-value="onNavBg"
        />
      </div>
      <div class="theme-row">
        <span class="theme-row__text">文字</span>
        <el-color-picker
          :model-value="theme.effectiveNavText"
          @update:model-value="onNavText"
        />
      </div>
      <el-button link type="primary" @click="theme.resetNav()">
        跟随模式（亮色深蓝 / 暗色近黑）
      </el-button>
    </div>

    <div class="theme-section">
      <div class="theme-section__label">字号</div>
      <el-radio-group
        :model-value="theme.cfg.fontSize"
        @update:model-value="onFontSize"
      >
        <el-radio-button v-for="s in theme.fontSizes" :key="s" :value="s">
          {{ s }}px
        </el-radio-button>
      </el-radio-group>
    </div>

    <div class="theme-section">
      <div class="theme-section__label">圆角</div>
      <el-slider
        :model-value="theme.cfg.radius"
        :min="0"
        :max="12"
        :step="1"
        show-stops
        @update:model-value="onRadius"
      />
    </div>

    <template #footer>
      <el-button @click="theme.reset()">恢复默认</el-button>
      <el-button
        v-if="canSaveGlobal"
        type="primary"
        :loading="saving"
        @click="saveGlobal"
      >
        保存为全局默认
      </el-button>
    </template>
  </el-drawer>
</template>
