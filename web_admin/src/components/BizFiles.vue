<script setup lang="ts">
/**
 * 业务附件面板（底座级，不含业务语义）。
 *
 * 文件底座的绑定是「上传 → 拿 id → bind(fileIds, bizType, bizId, bizField)」两步：
 * 上传接口只落 TEMP 元数据，不替业务猜归属。这里把两步合起来，
 * 让业务页只声明「我是谁、这个用途叫什么」，不重复写绑定代码。
 *
 * 新建记录时没有 bizId，**不要**在创建表单里用它 —— 先保存，再在编辑/详情里挂附件。
 */
import { Delete, Download } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ref, watch } from 'vue';
import { fileApi } from '../api/file';
import type { FileBizItem, FileItem } from '../api/types';
import { downloadFile } from '../utils/download';
import UploadFile from './UploadFile.vue';

const props = defineProps<{
  bizType: string;
  bizId: string | number;
  /** 附件用途，须与服务端 FileBizHandler.fields 一致 */
  bizField: string;
}>();

const files = ref<FileBizItem[]>([]);
const loading = ref(false);
const binding = ref(false);

const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

async function reload(): Promise<void> {
  loading.value = true;
  try {
    files.value = await fileApi.listByBiz(
      props.bizType,
      props.bizId,
      props.bizField,
    );
  } catch {
    // 已提示
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.bizType, props.bizId, props.bizField],
  () => void reload(),
  { immediate: true },
);

/** 上传成功只拿到 TEMP 文件，绑定要单独发一次 */
async function handleUploaded(file: FileItem): Promise<void> {
  binding.value = true;
  try {
    await fileApi.bind({
      fileIds: [file.id],
      bizType: props.bizType,
      bizId: String(props.bizId),
      bizField: props.bizField,
    });
    ElMessage.success('附件已添加');
    await reload();
  } catch {
    // 已提示
  } finally {
    binding.value = false;
  }
}

async function handleDownload(row: FileBizItem): Promise<void> {
  await downloadFile(row.file.downloadUrl, row.file.originalName);
}

/** 移除 = 解绑：文件回到 TEMP，由清理任务按过期回收，不在这里物理删 */
async function handleUnbind(row: FileBizItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认移除附件「${row.file.originalName}」？`,
      '提示',
      {
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  try {
    await fileApi.unbind({
      fileIds: [row.file.id],
      bizType: props.bizType,
      bizId: String(props.bizId),
      bizField: props.bizField,
    });
    ElMessage.success('已移除');
    await reload();
  } catch {
    // 已提示
  }
}
</script>

<template>
  <div class="biz-files">
    <UploadFile
      :biz-type="bizType"
      :disabled="binding"
      tip="上传后自动关联到当前记录"
      @uploaded="handleUploaded"
    />
    <el-table
      v-loading="loading"
      :data="files"
      border
      size="small"
      class="biz-files__table"
    >
      <el-table-column label="文件名" min-width="200" show-overflow-tooltip>
        <template #default="{ row }">{{ row.file.originalName }}</template>
      </el-table-column>
      <el-table-column label="大小" width="90">
        <template #default="{ row }">{{ fmtSize(row.file.size) }}</template>
      </el-table-column>
      <el-table-column label="上传时间" width="160">
        <template #default="{ row }">{{
          fmtTime(row.file.createTime)
        }}</template>
      </el-table-column>
      <el-table-column label="操作" width="130">
        <template #default="{ row }">
          <el-button
            :icon="Download"
            link
            type="primary"
            @click="handleDownload(row as FileBizItem)"
          >
            下载
          </el-button>
          <el-button
            :icon="Delete"
            link
            type="danger"
            @click="handleUnbind(row as FileBizItem)"
          >
            移除
          </el-button>
        </template>
      </el-table-column>
    </el-table>
  </div>
</template>

<style scoped>
.biz-files__table {
  margin-top: 12px;
}
</style>
