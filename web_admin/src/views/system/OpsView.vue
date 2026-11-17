<script setup lang="ts">
import { Refresh } from '@element-plus/icons-vue';
import { ElMessage } from 'element-plus';
import { onMounted, onUnmounted, ref } from 'vue';
import { opsApi, type OpsOverview } from '../../api/ops';

/**
 * 系统监控（运维面）。
 *
 * 数据来自 /ops/overview：HTTP 指标（进程内直方图）、DB 延迟、Outbox 积压、
 * 审计总量与留存。指标口径见 server/src/common/metrics/metrics.service.ts。
 *
 * 不在这里画图表：这几个数用数字卡片最直观，加 ECharts 只会让首屏更重；
 * 要趋势请直接抓 /ops/metrics 进 Prometheus。
 */
const loading = ref(false);
const overview = ref<OpsOverview | null>(null);
const retention = ref(180);
const saving = ref(false);
const cleaning = ref(false);
let timer: ReturnType<typeof setInterval> | null = null;

const fmtDuration = (seconds: number): string => {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d > 0) return d + ' 天 ' + h + ' 小时';
  if (h > 0) return h + ' 小时 ' + m + ' 分';
  return m + ' 分';
};

const fmtTime = (value: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

/** 行类型来自 el-table 的 DefaultRow，这里只做展示计算，不参与类型约束 */
const errorRate = (row: Record<string, unknown>): string => {
  const count = Number(row.count ?? 0);
  const errors = Number(row.errors ?? 0);
  return count ? ((errors / count) * 100).toFixed(1) + '%' : '0%';
};

async function load(): Promise<void> {
  loading.value = true;
  try {
    const data = await opsApi.overview();
    overview.value = data;
    retention.value = data.audit.retentionDays;
  } catch {
    // 已提示
  } finally {
    loading.value = false;
  }
}

async function saveRetention(): Promise<void> {
  saving.value = true;
  try {
    await opsApi.saveRetention(retention.value);
    ElMessage.success('留存天数已保存');
    await load();
  } catch {
    // 已提示
  } finally {
    saving.value = false;
  }
}

async function cleanupNow(): Promise<void> {
  cleaning.value = true;
  try {
    const result = await opsApi.cleanup();
    ElMessage.success('已清理 ' + result.deleted + ' 条过期审计');
    await load();
  } catch {
    // 已提示
  } finally {
    cleaning.value = false;
  }
}

onMounted(() => {
  void load();
  // 30 秒自动刷新：运维页常驻时不用手点
  timer = setInterval(() => {
    void load();
  }, 30_000);
});

onUnmounted(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <div v-loading="loading">
    <el-row :gutter="12">
      <el-col :span="6">
        <el-card shadow="never" class="page-card ops-card">
          <div class="ops-card__label">运行时长</div>
          <div class="ops-card__value">
            {{ overview ? fmtDuration(overview.app.uptimeSeconds) : '-' }}
          </div>
          <div class="form-tip">{{ overview?.app.node ?? '' }}</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="page-card ops-card">
          <div class="ops-card__label">内存</div>
          <div class="ops-card__value">{{ overview?.app.rssMb ?? '-' }} MB</div>
          <div class="form-tip">堆 {{ overview?.app.heapMb ?? '-' }} MB</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="page-card ops-card">
          <div class="ops-card__label">数据库</div>
          <div class="ops-card__value">
            <el-tag :type="overview?.db.up ? 'success' : 'danger'" size="small">
              {{ overview?.db.up ? '正常' : '不可用' }}
            </el-tag>
          </div>
          <div class="form-tip">延迟 {{ overview?.db.latencyMs ?? '-' }} ms</div>
        </el-card>
      </el-col>
      <el-col :span="6">
        <el-card shadow="never" class="page-card ops-card">
          <div class="ops-card__label">Outbox 积压</div>
          <div class="ops-card__value">{{ overview?.outbox.pending ?? '-' }}</div>
          <div class="form-tip">失败 {{ overview?.outbox.failed ?? '-' }} 条</div>
        </el-card>
      </el-col>
    </el-row>

    <el-card shadow="never" class="page-card ops-block">
      <template #header>
        <div class="ops-header">
          <span>审计日志</span>
          <div class="page-toolbar-right">
            <el-button :icon="Refresh" @click="load">刷新</el-button>
            <el-button
              v-perm="'system:ops:cleanup'"
              type="danger"
              :loading="cleaning"
              @click="cleanupNow"
            >
              立即清理过期
            </el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="12">
        <el-col :span="8">
          <div class="ops-card__label">总量</div>
          <div class="ops-card__value">{{ overview?.audit.total ?? 0 }}</div>
        </el-col>
        <el-col :span="8">
          <div class="ops-card__label">最早记录</div>
          <div class="ops-card__value ops-card__value--sm">
            {{ fmtTime(overview?.audit.earliest ?? null) }}
          </div>
        </el-col>
        <el-col :span="8">
          <div class="ops-card__label">最新记录</div>
          <div class="ops-card__value ops-card__value--sm">
            {{ fmtTime(overview?.audit.latest ?? null) }}
          </div>
        </el-col>
      </el-row>

      <div class="ops-retention">
        <span class="theme-row__text">留存天数</span>
        <el-input-number v-model="retention" :min="7" :max="3650" :step="30" />
        <el-button
          v-perm="'system:ops:cleanup'"
          type="primary"
          :loading="saving"
          @click="saveRetention"
        >
          保存
        </el-button>
        <span class="form-tip">
          每小时自动清理一次；写入 sys_config 的 audit.retentionDays（默认 180 天）
        </span>
      </div>
    </el-card>

    <el-card shadow="never" class="page-card ops-block">
      <template #header>接口指标（最近 12 个高频路由）</template>
      <el-table :data="overview?.http ?? []" border stripe size="small">
        <el-table-column prop="method" label="方法" width="80" />
        <el-table-column prop="route" label="路由" min-width="280" show-overflow-tooltip />
        <el-table-column prop="count" label="次数" width="90" align="right" />
        <el-table-column label="错误率" width="100" align="right">
          <template #default="{ row }">{{ errorRate(row) }}</template>
        </el-table-column>
        <el-table-column prop="avgMs" label="平均(ms)" width="100" align="right" />
        <el-table-column prop="p95Ms" label="P95(ms)" width="100" align="right" />
      </el-table>
      <div class="form-tip ops-foot">
        指标为进程内累计值（重启清零）；Prometheus 抓取：GET /api/v1/ops/metrics（默认仅本机，
        配置 METRICS_TOKEN 后需带 X-Metrics-Token）。
      </div>
    </el-card>
  </div>
</template>

<style scoped>
.ops-card__label {
  font-size: calc(var(--app-font-size) - 2px);
  color: var(--app-text-muted);
}

.ops-card__value {
  margin-top: 6px;
  font-size: calc(var(--app-font-size) + 8px);
  font-weight: 600;
}

.ops-card__value--sm {
  font-size: calc(var(--app-font-size) + 1px);
  font-weight: 500;
}

.ops-block {
  margin-top: 12px;
}

.ops-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.ops-retention {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 16px;
}

.ops-foot {
  margin-top: 10px;
}
</style>
