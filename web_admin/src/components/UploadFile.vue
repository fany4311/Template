<script setup lang="ts">
/**
 * 通用上传组件（底座级，不含业务语义）。
 *
 * 设计取舍：
 * - 用 `http-request` 自己发请求，而不是 el-upload 默认的 action：
 *   默认 action 走原生 XHR，带不上 `Authorization`，也拿不到统一错误包络。
 * - 单文件接口 → `multiple` 时逐个上传，任何一个失败不影响已成功的。
 * - 前端只做「提前失败」的轻校验（大小/扩展名），**类型判定以服务端为准**
 *   （Magic Number 只有服务端能看），前端不重复实现、也不假装实现。
 */
import { UploadFilled } from '@element-plus/icons-vue';
import { ElMessage, type UploadRequestOptions } from 'element-plus';
import { ref } from 'vue';
import { fileApi } from '../api/file';
import type { FileItem } from '../api/types';

const props = withDefaults(
  defineProps<{
    /** 业务类型（可选）：给了就按该业务更严的收件策略校验 */
    bizType?: string;
    /**
     * 业务对象 id（可选）：会随上传一起发给服务端。
     *
     * 注意：上传接口只落 TEMP 元数据，**不自动绑定**；绑定是单独的 `POST /file/bind`。
     * 需要「上传即关联」时用 `components/BizFiles.vue`（它把两步合起来）。
     */
    bizId?: string | number;
    /** 附件用途（可选） */
    bizField?: string;
    /** 允许的扩展名（仅用于文件选择框过滤，真正的白名单在服务端） */
    accept?: string;
    /** 单文件上限（字节），与服务端默认值一致 */
    maxSize?: number;
    multiple?: boolean;
    disabled?: boolean;
    /** 提示文案 */
    tip?: string;
  }>(),
  {
    accept:
      '.jpg,.jpeg,.png,.gif,.webp,.bmp,.pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.md,.zip,.rar,.7z,.tar,.gz,.mp4,.mp3,.wav',
    maxSize: 10 * 1024 * 1024,
    multiple: false,
    disabled: false,
    tip: '',
  },
);

const emit = defineEmits<{
  uploaded: [file: FileItem];
  error: [message: string];
}>();

const uploading = ref(false);
const percent = ref(0);

function beforeUpload(raw: File): boolean {
  if (raw.size > props.maxSize) {
    ElMessage.error(
      `文件不能超过 ${Math.round(props.maxSize / 1024 / 1024)}MB`,
    );
    return false;
  }
  if (raw.size === 0) {
    ElMessage.error('不能上传空文件');
    return false;
  }
  return true;
}

async function doUpload(options: UploadRequestOptions): Promise<void> {
  uploading.value = true;
  percent.value = 0;
  try {
    const result = await fileApi.upload(
      options.file,
      {
        bizType: props.bizType,
        bizId: props.bizId != null ? String(props.bizId) : undefined,
        bizField: props.bizField,
      },
      (p) => {
        percent.value = p;
        options.onProgress({ percent: p } as never);
      },
    );
    emit('uploaded', result.file);
    options.onSuccess(result);
    ElMessage.success(
      result.deduped ? '文件已存在，已复用（秒传）' : '上传成功',
    );
  } catch (err) {
    const message = (err as Error).message || '上传失败';
    emit('error', message);
    options.onError(err as never);
    // 业务/校验错误已由 http 拦截器提示；这里只补「静默失败」的情况
    if (!message || message === 'Network Error') ElMessage.error('上传失败');
  } finally {
    uploading.value = false;
    percent.value = 0;
  }
}
</script>

<template>
  <el-upload
    class="upload-file"
    drag
    :accept="accept"
    :multiple="multiple"
    :disabled="disabled || uploading"
    :show-file-list="false"
    :before-upload="beforeUpload"
    :http-request="doUpload"
  >
    <el-icon class="el-icon--upload"><UploadFilled /></el-icon>
    <div class="el-upload__text">把文件拖到这里，或 <em>点击选择</em></div>
    <template #tip>
      <div class="el-upload__tip">
        <slot name="tip">
          {{
            tip ||
            `单个文件不超过 ${Math.round(maxSize / 1024 / 1024)}MB，支持图片 / 文档 / 压缩包 / 音视频`
          }}
        </slot>
      </div>
    </template>
  </el-upload>

  <el-progress
    v-if="uploading"
    class="upload-file__progress"
    :percentage="percent"
    :stroke-width="6"
  />
</template>

<style scoped>
.upload-file__progress {
  margin-top: 8px;
}
</style>
