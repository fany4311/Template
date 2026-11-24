import { defineStore } from 'pinia';
import { computed, reactive, ref } from 'vue';
import { configApi } from '../api/config';
import { hexToRgba, mixHex, normalizeHex } from '../utils/color';

/**
 * 外观主题：主色 / 导航色 / 字号 / 圆角 / 暗色。
 *
 * ## 三层优先级（后者覆盖前者）
 * 1. 内置默认（本文件 DEFAULTS）—— 保证首屏可用；
 * 2. 全局默认：\`sys_config\` 的 \`ui.theme\`，超管在「外观」抽屉里一键保存；
 * 3. 个人偏好：localStorage，只影响当前浏览器。
 *
 * 为什么全局默认不新建表：主题就是一条键值参数，复用参数管理即可；
 * 独立主题表要跟着角色/租户走，那是多租户 SaaS 的解法，本项目是副本派生。
 *
 * ## 为什么颜色在 JS 里算
 * EP 需要 7 个色阶（light-3/5/7/8/9、dark-2），CSS 的 color-mix() 老浏览器不支持，
 * 用 JS 按同一规则算（见 utils/color.ts），降级时也只是一两个色阶偏差，不会白屏。
 */

export const THEME_CONFIG_KEY = 'ui.theme';

/** 个人偏好存储键：改名脚本会连同 token key 一起替换 */
const STORAGE_KEY = 'template_theme';

export type ThemeMode = 'light' | 'dark';

export interface ThemeConfig {
  mode: ThemeMode;
  primary: string;
  fontSize: number;
  radius: number;
  /** null = 跟随模式（亮色深蓝 / 暗色近黑） */
  navBg: string | null;
  navText: string | null;
}

/** 主色预设：够覆盖常见行业配色，不做无限取色器 */
export const PRIMARY_PRESETS = [
  '#1677ff',
  '#2f54eb',
  '#13c2c2',
  '#52c41a',
  '#fa8c16',
  '#eb2f96',
  '#722ed1',
  '#001529',
];

export const FONT_SIZES = [12, 13, 14, 16];

const LIGHT_NAV = { bg: '#001529', text: '#c9d1d9' };
const DARK_NAV = { bg: '#0b1220', text: '#9aa7b8' };

const DEFAULTS: ThemeConfig = {
  mode: 'light',
  primary: '#1677ff',
  fontSize: 14,
  radius: 4,
  navBg: null,
  navText: null,
};

/** 只接受合法字段：localStorage 可能被手工改坏，或存的是上个版本的旧结构 */
function sanitize(raw: unknown): Partial<ThemeConfig> {
  if (!raw || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const out: Partial<ThemeConfig> = {};

  if (src.mode === 'light' || src.mode === 'dark') out.mode = src.mode;

  const primary = normalizeHex(
    typeof src.primary === 'string' ? src.primary : null,
  );
  if (primary) out.primary = primary;

  const fontSize = Number(src.fontSize);
  if (FONT_SIZES.includes(fontSize)) out.fontSize = fontSize;

  const radius = Number(src.radius);
  if (Number.isFinite(radius) && radius >= 0 && radius <= 12) {
    out.radius = Math.round(radius);
  }

  if (src.navBg === null) out.navBg = null;
  else {
    const navBg = normalizeHex(
      typeof src.navBg === 'string' ? src.navBg : null,
    );
    if (navBg) out.navBg = navBg;
  }

  if (src.navText === null) out.navText = null;
  else {
    const navText = normalizeHex(
      typeof src.navText === 'string' ? src.navText : null,
    );
    if (navText) out.navText = navText;
  }

  return out;
}

function readLocal(): Partial<ThemeConfig> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

function setVar(root: HTMLElement, name: string, value: string): void {
  root.style.setProperty(name, value);
}

/** 把配置写进 <html>：--app-* 给自有样式，--el-* 给 Element Plus */
function applyConfig(cfg: ThemeConfig): void {
  const root = document.documentElement;
  const dark = cfg.mode === 'dark';
  root.classList.toggle('dark', dark);

  const primary = normalizeHex(cfg.primary) ?? DEFAULTS.primary;
  const navBg = cfg.navBg ?? (dark ? DARK_NAV.bg : LIGHT_NAV.bg);
  const navText = cfg.navText ?? (dark ? DARK_NAV.text : LIGHT_NAV.text);
  const size = cfg.fontSize;
  const radius = cfg.radius;
  const hoverBg = hexToRgba(primary, dark ? 0.26 : 0.18);

  setVar(root, '--app-primary', primary);
  setVar(root, '--app-nav-bg', navBg);
  setVar(root, '--app-nav-text', navText);
  setVar(root, '--app-nav-active-bg', primary);
  setVar(root, '--app-nav-active-text', '#ffffff');
  setVar(root, '--app-nav-hover-bg', hoverBg);
  setVar(root, '--app-font-size', size + 'px');
  setVar(root, '--app-radius', radius + 'px');
  setVar(root, '--app-login-from', navBg);
  setVar(root, '--app-login-to', mixHex(navBg, primary, 0.45));

  // Element Plus 主色 + 色阶（规则与 theme-chalk 一致：往白/黑混固定比例）
  setVar(root, '--el-color-primary', primary);
  setVar(root, '--el-color-primary-light-3', mixHex(primary, '#ffffff', 0.3));
  setVar(root, '--el-color-primary-light-5', mixHex(primary, '#ffffff', 0.5));
  setVar(root, '--el-color-primary-light-7', mixHex(primary, '#ffffff', 0.7));
  setVar(root, '--el-color-primary-light-8', mixHex(primary, '#ffffff', 0.8));
  setVar(root, '--el-color-primary-light-9', mixHex(primary, '#ffffff', 0.9));
  setVar(root, '--el-color-primary-dark-2', mixHex(primary, '#000000', 0.2));

  setVar(root, '--el-border-radius-base', radius + 'px');
  setVar(root, '--el-font-size-base', size + 'px');
  setVar(root, '--el-font-size-small', Math.max(10, size - 2) + 'px');
  setVar(root, '--el-font-size-extra-small', Math.max(10, size - 3) + 'px');
  setVar(root, '--el-font-size-medium', size + 2 + 'px');
  setVar(root, '--el-font-size-large', size + 4 + 'px');

  // 菜单变量挂在根上：折叠弹层被 teleport 到 body，只能靠继承
  setVar(root, '--el-menu-bg-color', navBg);
  setVar(root, '--el-menu-text-color', navText);
  setVar(root, '--el-menu-active-color', '#ffffff');
  setVar(root, '--el-menu-hover-bg-color', hoverBg);
  setVar(root, '--el-menu-hover-text-color', '#ffffff');
}

export const useThemeStore = defineStore('theme', () => {
  const cfg = reactive<ThemeConfig>({ ...DEFAULTS, ...readLocal() });
  const globalCfg = ref<Partial<ThemeConfig> | null>(null);

  const isDark = computed(() => cfg.mode === 'dark');
  const effectiveNavBg = computed(
    () => cfg.navBg ?? (isDark.value ? DARK_NAV.bg : LIGHT_NAV.bg),
  );
  const effectiveNavText = computed(
    () => cfg.navText ?? (isDark.value ? DARK_NAV.text : LIGHT_NAV.text),
  );

  function snapshot(): ThemeConfig {
    return {
      mode: cfg.mode,
      primary: cfg.primary,
      fontSize: cfg.fontSize,
      radius: cfg.radius,
      navBg: cfg.navBg,
      navText: cfg.navText,
    };
  }

  function apply(): void {
    applyConfig(snapshot());
  }

  function persistLocal(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot()));
    } catch {
      // 隐私模式 / 存储写满：只影响下次打开，不阻断当前操作
    }
  }

  /** 改一项：立即生效 + 写本地。UI 只调这个，别直接改 cfg */
  function patch(partial: Partial<ThemeConfig>): void {
    Object.assign(cfg, partial);
    apply();
    persistLocal();
  }

  /** 恢复内置默认（同时清掉个人偏好；全局默认保留，下次登录还会生效） */
  function reset(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // 同上
    }
    Object.assign(cfg, DEFAULTS, globalCfg.value ?? {});
    apply();
  }

  /** 导航色回到「跟随模式」 */
  function resetNav(): void {
    patch({ navBg: null, navText: null });
  }

  /** 首屏：只读本地，同步应用（在 main.ts 里 app.mount 之前调） */
  function init(): void {
    apply();
  }

  /**
   * 登录后拉全局默认。
   * 失败（未配置 / 无权限 / 网络）一律忽略：外观不该阻断登录。
   */
  async function loadRemote(): Promise<void> {
    try {
      const result = await configApi.value(THEME_CONFIG_KEY);
      const parsed: unknown = JSON.parse(result.configValue);
      const next = sanitize(parsed);
      globalCfg.value = next;
      // 重新按「默认 → 全局 → 个人」叠加，个人偏好仍然最后覆盖
      Object.assign(cfg, DEFAULTS, next, readLocal());
      apply();
    } catch {
      // 静默：没有全局配置是常态
    }
  }

  /**
   * 把当前配置存成全局默认（仅超管：system:config:edit）。
   * 参数表本来就是键值结构，这里做一次「按键 upsert」，不新增接口。
   */
  async function saveGlobal(): Promise<void> {
    const configValue = JSON.stringify(snapshot());
    const page = await configApi.page({
      keyword: THEME_CONFIG_KEY,
      pageNum: 1,
      pageSize: 20,
    });
    const hit = page.list.find((item) => item.configKey === THEME_CONFIG_KEY);
    if (hit) {
      await configApi.update(hit.id, { configValue });
      return;
    }
    await configApi.create({
      configName: '后台外观（全局默认）',
      configKey: THEME_CONFIG_KEY,
      configValue,
      configType: 'Y',
      status: 1,
      remark: '主色/导航/字号/圆角/暗色；个人可在右上角「外观」里覆盖',
    });
  }

  return {
    cfg,
    isDark,
    effectiveNavBg,
    effectiveNavText,
    presets: PRIMARY_PRESETS,
    fontSizes: FONT_SIZES,
    patch,
    reset,
    resetNav,
    init,
    loadRemote,
    saveGlobal,
  };
});
