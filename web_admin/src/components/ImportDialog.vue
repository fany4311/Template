<script lang="ts">
/** 导入结果（与后端 ImportResult 结构一致；不依赖具体模块，便于复用） */
export interface ImportOutcome {
  total: number;
  ok: number;
  failed: Array<{ row: number; message: string }>;
  failedTruncated: boolean;
}
</script>

<script setup lang="ts">
import { ElMessage } from 'element-plus';
import { ref, watch } from 'vue';

/**
 * 通用 CSV 导入弹窗。
 *
 * 设计要点：
 * - **只负责交互**：真正解析/校验/落库在后端；组件拿到结果就展示，
 *   这样 5000 行的错误明细不会塞进前端内存，也不会因为前端校验口径和后端不一致而扯皮。
 * - **部分成功可视化**：失败行按 Excel 行号列出（后端已 +2 对齐表头），
 *   用户改完直接重试，成功的行不会重复插入（参数键已存在的会提示）。
 * - 关闭即清空：避免下次打开还挂着上次的文件与结果。
 */
const visible = defineModel<boolean>({ required: true });

const props = withDefaults(
  defineProps<{
    upload: (file: File) => Promise<ImportOutcome>;
    title?: string;
    hint?: string;
  }>(),
  {
    title: '导入 CSV',
    hint: '仅支持 .csv（Excel 请另存为 CSV UTF-8）',
  },
);

const emit = defineEmits<{ done: [] }>();

const fileInput = ref<HTMLInputElement>();
const picked = ref<File | null>(null);
const importing = ref(false);
const result = ref<ImportOutcome | null>(null);

function pick(): void {
  fileInput.value?.click();
}

function onPick(event: Event): void {
  const input = event.target as HTMLInputElement;
  picked.value = input.files?.[0] ?? null;
  result.value = null;
}

async function submit(): Promise<void> {
  if (!picked.value) {
    ElMessage.warning('请选择要导入的 CSV 文件');
    return;
  }
  importing.value = true;
  try {
    result.value = await props.upload(picked.value);
    if (result.value.failed.length === 0) {
      ElMessage.success('导入完成：成功 ' + result.value.ok + ' 行');
    }
    emit('done');
  } catch {
    // 错误提示由 http 层统一弹出（格式错误/无权限/超限）
  } finally {
    importing.value = false;
  }
}

watch(visible, (open) => {
  if (open) return;
  picked.value = null;
  result.value = null;
  if (fileInput.value) fileInput.value.value = '';
});
</script>

<template>
  <el-dialog v-model="visible" :title="title" width="640px">
    <div class="import-pick">
      <input
        ref="fileInput"
        class="import-pick__input"
        type="file"
        accept=".csv,text/csv"
        @change="onPick"
      />
      <el-button @click="pick">选择文件</el-button>
      <span class="form-tip">{{ picked ? picked.name : hint }}</span>
    </div>

    <div class="form-tip import-pick__tip">
      逐行校验，失败行不影响其他行；单次最多 5000 行。
    </div>

    <template v-if="result">
      <el-divider />
      <el-alert
        :type="result.failed.length ? 'warning' : 'success'"
        :closable="false"
        :title="
          '共 ' +
          result.total +
          ' 行：成功 ' +
          result.ok +
          '，失败 ' +
          result.failed.length
        "
      />
      <el-table
        v-if="result.failed.length"
        :data="result.failed"
        border
        size="small"
        max-height="260"
        class="import-pick__table"
      >
        <el-table-column prop="row" label="行号" width="80" />
        <el-table-column
          prop="message"
          label="失败原因"
          min-width="300"
          show-overflow-tooltip
        />
      </el-table>
      <div v-if="result.failedTruncated" class="form-tip import-pick__tip">
        失败行较多，仅展示前 200
        条；修正后重新导入即可（已成功的行不会重复写入）。
      </div>
    </template>

    <template #footer>
      <el-button @click="visible = false">关闭</el-button>
      <el-button
        type="primary"
        :loading="importing"
        :disabled="!picked"
        @click="submit"
      >
        开始导入
      </el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
.import-pick {
  display: flex;
  align-items: center;
  gap: 12px;
}

.import-pick__input {
  display: none;
}

.import-pick__tip {
  margin-top: 8px;
}

.import-pick__table {
  margin-top: 12px;
}
</style>
