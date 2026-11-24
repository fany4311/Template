<script setup lang="ts">
import {
  Delete,
  Download,
  Refresh,
  Search,
  Upload,
  View,
} from '@element-plus/icons-vue';
import { ref } from 'vue';
import { fileApi } from '../../api/file';
import type { FileDetail, FileItem } from '../../api/types';
import DataTable, { type TableColumn } from '../../components/DataTable.vue';
import UploadFile from '../../components/UploadFile.vue';
import { useCrud } from '../../composables/useCrud';
import { downloadFile } from '../../utils/download';

/**
 * 文件管理（系统管理域）。
 *
 * 注意权限归属：`system:file:*` 属于系统域，内置 `admin` 角色被 `!system:*` 排除，
 * 只有 `superadmin` 能进 —— 这是刻意的：业务管理员不应通过文件总览
 * 窥探其它部门的附件，他们通过业务页面（走 FileBizRegistry 判定）看自己的。
 *
 * 上传与详情是文件域特有的，useCrud 只接管列表这一半。
 */
type FileQueryState = {
  pageNum: number;
  pageSize: number;
  keyword: string;
  ext: string;
  status?: 'TEMP' | 'ACTIVE';
};

const fmtTime = (v?: string | null): string =>
  v ? new Date(v).toLocaleString('zh-CN', { hour12: false }) : '-';

const fmtSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
};

const { query, rows, total, loading, reload, search, reset, remove } = useCrud<
  FileItem,
  FileQueryState
>({
  api: {
    page: (q) =>
      fileApi.page({
        pageNum: q.pageNum,
        pageSize: q.pageSize,
        keyword: q.keyword || undefined,
        ext: q.ext || undefined,
        status: q.status,
      }),
    remove: fileApi.remove,
  },
  query: { pageNum: 1, pageSize: 10, keyword: '', ext: '', status: undefined },
  removeText: (row) =>
    `确认删除「${row.originalName}」？已绑定业务的文件请在业务页面解绑后再删除。`,
});

const columns: TableColumn[] = [
  { prop: 'id', label: 'ID', width: 80 },
  {
    prop: 'originalName',
    label: '文件名',
    minWidth: 220,
    showOverflowTooltip: true,
  },
  { prop: 'ext', label: '类型', width: 90 },
  { label: '大小', width: 100, slot: 'size' },
  { label: '状态', width: 100, slot: 'status' },
  { prop: 'refCount', label: '引用', width: 80 },
  { prop: 'uploaderName', label: '上传人', width: 120 },
  { label: '上传时间', width: 170, slot: 'createTime' },
  { label: '过期时间', width: 170, slot: 'expireAt' },
];

const detailVisible = ref(false);
const detail = ref<FileDetail | null>(null);
const uploadVisible = ref(false);

async function handleDetail(row: FileItem): Promise<void> {
  try {
    detail.value = await fileApi.detail(row.id);
    detailVisible.value = true;
  } catch {
    // 已提示
  }
}

async function handleDownload(row: FileItem): Promise<void> {
  await downloadFile(row.downloadUrl, row.originalName);
}

/** 上传成功：新文件是 TEMP 状态，出现在列表里，绑定动作由业务页面完成 */
function handleUploaded(): void {
  void reload();
}
</script>

<template>
  <div>
    <el-card shadow="never" class="page-card">
      <div class="page-toolbar">
        <el-input
          v-model="query.keyword"
          placeholder="文件名"
          clearable
          style="width: 200px"
          @keyup.enter="search"
        />
        <el-input
          v-model="query.ext"
          placeholder="扩展名（如 pdf）"
          clearable
          style="width: 150px"
          @keyup.enter="search"
        />
        <el-select
          v-model="query.status"
          placeholder="状态"
          clearable
          style="width: 130px"
        >
          <el-option label="已绑定" value="ACTIVE" />
          <el-option label="临时" value="TEMP" />
        </el-select>
        <el-button :icon="Search" type="primary" @click="search"
          >查询</el-button
        >
        <el-button :icon="Refresh" @click="reset">重置</el-button>
        <div class="page-toolbar-right">
          <el-button
            :icon="Upload"
            type="success"
            @click="uploadVisible = true"
          >
            上传文件
          </el-button>
        </div>
      </div>

      <DataTable
        v-model:page="query.pageNum"
        v-model:page-size="query.pageSize"
        :columns="columns"
        :rows="rows"
        :loading="loading"
        :total="total"
        @change="reload"
      >
        <template #size="{ row }">{{ fmtSize(row.size) }}</template>

        <template #status="{ row }">
          <el-tag
            :type="row.status === 'ACTIVE' ? 'success' : 'info'"
            size="small"
          >
            {{ row.status === 'ACTIVE' ? '已绑定' : '临时' }}
          </el-tag>
        </template>

        <template #createTime="{ row }">{{ fmtTime(row.createTime) }}</template>

        <template #expireAt="{ row }">{{ fmtTime(row.expireAt) }}</template>

        <el-table-column label="操作" width="200" fixed="right">
          <template #default="{ row }">
            <el-button
              :icon="View"
              link
              type="primary"
              @click="handleDetail(row as FileItem)"
            >
              详情
            </el-button>
            <el-button
              :icon="Download"
              link
              type="primary"
              @click="handleDownload(row as FileItem)"
            >
              下载
            </el-button>
            <el-button
              v-perm="'system:file:remove'"
              :icon="Delete"
              link
              type="danger"
              @click="remove(row as FileItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <el-dialog
      v-model="uploadVisible"
      title="上传文件（先暂存，绑定在业务页面完成）"
      width="560px"
    >
      <UploadFile multiple @uploaded="handleUploaded" />
      <template #footer>
        <el-button @click="uploadVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <el-drawer v-model="detailVisible" title="文件详情" size="520px">
      <template v-if="detail">
        <el-descriptions :column="1" border>
          <el-descriptions-item label="文件名">{{
            detail.file.originalName
          }}</el-descriptions-item>
          <el-descriptions-item label="类型">
            {{ detail.file.mime }}（.{{ detail.file.ext }}）
          </el-descriptions-item>
          <el-descriptions-item label="大小">{{
            fmtSize(detail.file.size)
          }}</el-descriptions-item>
          <el-descriptions-item label="上传人">{{
            detail.file.uploaderName
          }}</el-descriptions-item>
          <el-descriptions-item label="上传时间">
            {{ fmtTime(detail.file.createTime) }}
          </el-descriptions-item>
          <el-descriptions-item label="状态">
            {{ detail.file.status === 'ACTIVE' ? '已绑定' : '临时' }}
            （引用 {{ detail.file.refCount }} 次）
          </el-descriptions-item>
        </el-descriptions>

        <el-divider content-position="left">绑定关系</el-divider>
        <el-empty
          v-if="!detail.links.length"
          description="尚未绑定任何业务对象"
          :image-size="80"
        />
        <el-table v-else :data="detail.links" border size="small">
          <el-table-column prop="bizType" label="业务类型" width="120" />
          <el-table-column prop="bizId" label="业务对象" width="110" />
          <el-table-column prop="bizField" label="用途" width="130" />
          <el-table-column label="绑定时间" min-width="160">
            <template #default="{ row }">{{
              fmtTime(row.createTime)
            }}</template>
          </el-table-column>
        </el-table>
      </template>
    </el-drawer>
  </div>
</template>
