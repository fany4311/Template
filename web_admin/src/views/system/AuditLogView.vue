<script setup lang="ts">
import { Refresh, Search } from '@element-plus/icons-vue';
import { onMounted, reactive, ref } from 'vue';
import { auditLogApi } from '../../api/log';
import type { AuditLogItem } from '../../api/types';

const loading = ref(false);
const list = ref<AuditLogItem[]>([]);
const total = ref(0);

const query = reactive({
  pageNum: 1,
  pageSize: 10,
  actorName: '',
  action: '',
  result: undefined as 'success' | 'fail' | undefined,
  range: null as [string, string] | null,
});

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    const res = await auditLogApi.page({
      pageNum: query.pageNum,
      pageSize: query.pageSize,
      actorName: query.actorName || undefined,
      action: query.action || undefined,
      result: query.result,
      startTime: query.range?.[0] ?? undefined,
      endTime: query.range?.[1] ?? undefined,
    });
    list.value = res.list;
    total.value = res.total;
  } catch {
    // 已提示
  } finally {
    loading.value = false;
  }
}

function handleSearch(): void {
  query.pageNum = 1;
  void fetchList();
}

function handleReset(): void {
  query.actorName = '';
  query.action = '';
  query.result = undefined;
  query.range = null;
  query.pageNum = 1;
  void fetchList();
}

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

onMounted(fetchList);
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
          @keyup.enter="handleSearch"
        />
        <el-input
          v-model="query.action"
          placeholder="动作（如 system:user:add）"
          clearable
          style="width: 220px"
          @keyup.enter="handleSearch"
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
        <el-button :icon="Search" type="primary" @click="handleSearch">查询</el-button>
        <el-button :icon="Refresh" @click="handleReset">重置</el-button>
      </div>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="ID" width="80" />
        <el-table-column prop="actorName" label="操作人" width="110" />
        <el-table-column prop="action" label="动作" min-width="180" show-overflow-tooltip />
        <el-table-column prop="resourceType" label="资源类型" width="110" />
        <el-table-column prop="resourceId" label="资源ID" width="90" />
        <el-table-column label="结果" width="80">
          <template #default="{ row }">
            <el-tag :type="row.result === 'success' ? 'success' : 'danger'" size="small">
              {{ row.result === 'success' ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="method" label="方法" width="80" />
        <el-table-column prop="path" label="路径" min-width="200" show-overflow-tooltip />
        <el-table-column prop="ip" label="IP" width="130" />
        <el-table-column label="耗时" width="90">
          <template #default="{ row }">{{ row.durationMs ?? '-' }} ms</template>
        </el-table-column>
        <el-table-column label="时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button link type="primary" @click="openDetail(row as AuditLogItem)">
              详情
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="query.pageNum"
          v-model:page-size="query.pageSize"
          :total="total"
          :page-sizes="[10, 20, 50, 100]"
          layout="total, sizes, prev, pager, next"
          @current-change="fetchList"
          @size-change="handleSearch"
        />
      </div>
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
          <pre class="detail-json">{{ JSON.stringify(detail.detail ?? {}, null, 2) }}</pre>
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
  font-size: 12px;
  line-height: 1.5;
}
</style>
