<script setup lang="ts">
import { Refresh, Search } from '@element-plus/icons-vue';
import { ref } from 'vue';
import { auditLogApi } from '../../api/log';
import type { AuditLogItem } from '../../api/types';
import DataTable, { type TableColumn } from '../../components/DataTable.vue';
import { useCrud } from '../../composables/useCrud';

/**
 * 操作日志（只读列表 + 详情抽屉）。
 *
 * 查询条件里时间用 range 数组（日期选择器需要），接口要 startTime/endTime，
 * 所以在 api 适配层做一次映射 —— 这正是 useCrud 留 api 注入而非写死 request 的原因。
 */
type Query = {
  pageNum: number;
  pageSize: number;
  actorName: string;
  action: string;
  result?: 'success' | 'fail';
  range: [string, string] | null;
};

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

const { query, rows, total, loading, reload, search, reset } = useCrud<AuditLogItem, Query>({
  api: {
    page: (q) =>
      auditLogApi.page({
        pageNum: q.pageNum,
        pageSize: q.pageSize,
        actorName: q.actorName || undefined,
        action: q.action || undefined,
        result: q.result,
        startTime: q.range?.[0] ?? undefined,
        endTime: q.range?.[1] ?? undefined,
      }),
  },
  query: {
    pageNum: 1,
    pageSize: 10,
    actorName: '',
    action: '',
    result: undefined,
    range: null,
  },
});

const columns: TableColumn[] = [
  { prop: 'id', label: 'ID', width: 90 },
  { prop: 'actorName', label: '操作人', width: 110 },
  { prop: 'action', label: '动作', minWidth: 180, showOverflowTooltip: true },
  { prop: 'resourceType', label: '资源类型', width: 110 },
  { prop: 'resourceId', label: '资源ID', width: 90 },
  { label: '结果', width: 80, slot: 'result' },
  { prop: 'method', label: '方法', width: 80 },
  { prop: 'path', label: '路径', minWidth: 200, showOverflowTooltip: true },
  { prop: 'ip', label: 'IP', width: 130 },
  { label: '耗时', width: 90, slot: 'duration' },
  { label: '时间', width: 170, slot: 'createTime' },
];

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<AuditLogItem | null>(null);

async function openDetail(row: AuditLogItem): Promise<void> {
  detailVisible.value = true;
  detail.value = row;
  detailLoading.value = true;
  try {
    detail.value = await auditLogApi.detail(row.id);
  } catch {
    // 已提示
  } finally {
    detailLoading.value = false;
  }
}

const prettyDetail = (): string => {
  const value = (detail.value as { detail?: unknown } | null)?.detail;
  return value ? JSON.stringify(value, null, 2) : '-';
};
</script>

<template>
  <div>
    <el-card shadow="never" class="page-card">
      <div class="page-toolbar">
        <el-input
          v-model="query.actorName"
          placeholder="操作人"
          clearable
          style="width: 140px"
          @keyup.enter="search"
        />
        <el-input
          v-model="query.action"
          placeholder="动作（如 system:user:add）"
          clearable
          style="width: 220px"
          @keyup.enter="search"
        />
        <el-select v-model="query.result" placeholder="结果" clearable style="width: 110px">
          <el-option label="成功" value="success" />
          <el-option label="失败" value="fail" />
        </el-select>
        <el-date-picker
          v-model="query.range"
          type="datetimerange"
          value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
          start-placeholder="开始时间"
          end-placeholder="结束时间"
          style="width: 360px"
        />
        <el-button :icon="Search" type="primary" @click="search">查询</el-button>
        <el-button :icon="Refresh" @click="reset">重置</el-button>
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
        <template #result="{ row }">
          <el-tag :type="row.result === 'success' ? 'success' : 'danger'" size="small">
            {{ row.result === 'success' ? '成功' : '失败' }}
          </el-tag>
        </template>

        <template #duration="{ row }">{{ row.durationMs ?? '-' }} ms</template>

        <template #createTime="{ row }">{{ fmtTime(row.createTime) }}</template>

        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row as AuditLogItem)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <el-drawer v-model="detailVisible" title="操作日志详情" size="560px">
      <el-skeleton v-if="detailLoading" :rows="8" animated />
      <el-descriptions v-else-if="detail" :column="1" border size="small">
        <el-descriptions-item label="ID">{{ detail.id }}</el-descriptions-item>
        <el-descriptions-item label="追踪ID">{{ detail.traceId || '-' }}</el-descriptions-item>
        <el-descriptions-item label="操作人">
          {{ detail.actorName || '-' }}（{{ detail.actorId ?? '-' }}）
        </el-descriptions-item>
        <el-descriptions-item label="动作">{{ detail.action }}</el-descriptions-item>
        <el-descriptions-item label="资源">
          {{ detail.resourceType || '-' }} / {{ detail.resourceId || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="结果">
          {{ detail.result === 'success' ? '成功' : '失败' }}
          <span v-if="detail.errorCode">（{{ detail.errorCode }}）</span>
        </el-descriptions-item>
        <el-descriptions-item label="请求">
          {{ detail.method }} {{ detail.path }}
        </el-descriptions-item>
        <el-descriptions-item label="IP">{{ detail.ip || '-' }}</el-descriptions-item>
        <el-descriptions-item label="User-Agent">
          {{ detail.userAgent || '-' }}
        </el-descriptions-item>
        <el-descriptions-item label="耗时">{{ detail.durationMs ?? '-' }} ms</el-descriptions-item>
        <el-descriptions-item label="时间">{{ fmtTime(detail.createTime) }}</el-descriptions-item>
        <el-descriptions-item label="详情">
          <pre class="detail-json">{{ prettyDetail() }}</pre>
        </el-descriptions-item>
      </el-descriptions>
    </el-drawer>
  </div>
</template>

<style scoped>
.detail-json {
  margin: 0;
  max-height: 320px;
  overflow: auto;
  font-size: calc(var(--app-font-size) - 2px);
  white-space: pre-wrap;
  word-break: break-all;
}
</style>
