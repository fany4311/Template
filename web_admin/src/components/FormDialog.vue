<script lang="ts">
/** 表单字段：只覆盖通用管理域里真正用到的几种控件 */
export type FormFieldType =
  | 'input'
  | 'textarea'
  | 'number'
  | 'select'
  | 'switch';

export interface FormOption {
  label: string;
  value: string | number;
}

export interface FormColumn {
  prop: string;
  label: string;
  type?: FormFieldType;
  placeholder?: string;
  options?: FormOption[];
  /** textarea 行数 */
  rows?: number;
  disabled?: boolean;
  /** switch 的取值（如 configType 用 'Y' / 'N'） */
  activeValue?: string | number | boolean;
  inactiveValue?: string | number | boolean;
  activeText?: string;
  inactiveText?: string;
}

export interface FormDialogExpose {
  validate: () => Promise<boolean>;
}
</script>

<script setup lang="ts" generic="M extends object">
import { ref } from 'vue';
import type { FormInstance, FormRules } from 'element-plus';

/**
 * 表单弹窗：字段配置 + 校验 + 提交 loading。
 *
 * 刻意**不做**：
 * - 不做字段联动 / 动态显隐（一加规则引擎就不可控；真有需求在页面里用插槽写）
 * - 不管权限（按钮的 v-perm 由页面控制）
 * - 不自动提交：校验通过只 emit submit，接口调用与成功文案留在页面，
 *   因为「新建 vs 编辑」「创建成功 vs 更新成功」的差异只有页面知道。
 *
 * destroy-on-close 必须开：否则再次打开时上一次的校验红字还挂着。
 */
const visible = defineModel<boolean>({ required: true });

const props = withDefaults(
  defineProps<{
    title: string;
    model: M;
    columns: FormColumn[];
    rules?: FormRules;
    saving?: boolean;
    width?: string;
    labelWidth?: string;
  }>(),
  {
    saving: false,
    width: '520px',
    labelWidth: '90px',
  },
);

const emit = defineEmits<{ submit: [] }>();

const formRef = ref<FormInstance>();

/** model 是调用方的 reactive 对象，这里只按字段名读写，不复制、不代理 */
function read(prop: string): unknown {
  return (props.model as unknown as Record<string, unknown>)[prop];
}

function setValue(prop: string, value: unknown): void {
  (props.model as unknown as Record<string, unknown>)[prop] = value;
}

function text(prop: string): string | number | undefined {
  const value = read(prop);
  return typeof value === 'string' || typeof value === 'number'
    ? value
    : undefined;
}

function num(prop: string): number | undefined {
  const value = read(prop);
  return typeof value === 'number' ? value : undefined;
}

/** switch 可能是 boolean，也可能是 'Y'/'N'、1/0 —— 统一按「可绑定的原始值」处理 */
function flag(prop: string): string | number | boolean {
  const value = read(prop);
  return typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
    ? value
    : false;
}

async function handleSubmit(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  emit('submit');
}

defineExpose<FormDialogExpose>({
  validate: async () =>
    (await formRef.value?.validate().catch(() => false)) ?? false,
});
</script>

<template>
  <el-dialog v-model="visible" :title="title" :width="width" destroy-on-close>
    <el-form
      ref="formRef"
      :model="model"
      :rules="rules"
      :label-width="labelWidth"
    >
      <el-form-item
        v-for="col in columns"
        :key="col.prop"
        :label="col.label"
        :prop="col.prop"
      >
        <template v-if="!col.type || col.type === 'input'">
          <el-input
            :model-value="text(col.prop)"
            :placeholder="col.placeholder"
            :disabled="col.disabled"
            clearable
            @update:model-value="setValue(col.prop, $event)"
          />
        </template>

        <template v-else-if="col.type === 'textarea'">
          <el-input
            type="textarea"
            :rows="col.rows ?? 2"
            :model-value="text(col.prop)"
            :placeholder="col.placeholder"
            :disabled="col.disabled"
            @update:model-value="setValue(col.prop, $event)"
          />
        </template>

        <template v-else-if="col.type === 'number'">
          <el-input-number
            :model-value="num(col.prop)"
            :disabled="col.disabled"
            @update:model-value="setValue(col.prop, $event)"
          />
        </template>

        <template v-else-if="col.type === 'select'">
          <el-select
            :model-value="text(col.prop)"
            :placeholder="col.placeholder ?? '请选择'"
            :disabled="col.disabled"
            clearable
            style="width: 100%"
            @update:model-value="setValue(col.prop, $event)"
          >
            <el-option
              v-for="opt in col.options ?? []"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
            />
          </el-select>
        </template>

        <template v-else-if="col.type === 'switch'">
          <el-switch
            :model-value="flag(col.prop)"
            :active-value="col.activeValue ?? true"
            :inactive-value="col.inactiveValue ?? false"
            :active-text="col.activeText"
            :inactive-text="col.inactiveText"
            :disabled="col.disabled"
            @update:model-value="setValue(col.prop, $event)"
          />
        </template>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="visible = false">取消</el-button>
      <el-button type="primary" :loading="saving" @click="handleSubmit"
        >确定</el-button
      >
    </template>
  </el-dialog>
</template>
