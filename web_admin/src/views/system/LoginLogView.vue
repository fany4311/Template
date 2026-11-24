<script setup lang="ts">
import { Delete, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { ref } from 'vue';
import { loginLogApi } from '../../api/log';
import type { LoginLogItem } from '../../api/types';
import DataTable, { type TableColumn } from '../../components/DataTable.vue';
import { useCrud } from '../../composables/useCrud';

/**
 * 登录日志（只读列表 + 单条删除 + 清空）。
 *
 * 用 useCrud + DataTable：日志页没有表单，正好是「列表抽象」最省事的落地场景。
 * 清空是模块特有动作，留在页面里，不硬塞进 useCrud。
 */
type Query = {
  pageNum: number;
  pageSize: number;
  username: string;
  status?: number;
};

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

const { query, rows, total, loading, reload, search, reset, remove } = useCrud<
  LoginLogItem,
  Query
>({
  api: loginLogApi,
  query: { pageNum: 1, pageSize: 10, username: '', status: undefined },
  removeText: () => '确认删除该条登录日志？',
});

const columns: TableColumn[] = [
  { prop: 'id', label: 'ID', width: 90 },
  { prop: 'username', label: '用户名', minWidth: 130 },
  { label: '结果', width: 90, slot: 'status' },
  { prop: 'msg', label: '说明', minWidth: 160, showOverflowTooltip: true },
  { prop: 'ip', label: 'IP', width: 140 },
  {
    prop: 'userAgent',
    label: 'User-Agent',
    minWidth: 220,
    showOverflowTooltip: true,
  },
  { label: '登录时间', width: 170, slot: 'loginTime' },
];

const clearing = ref(false);

async function handleClear(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认清空全部登录日志？不可恢复。', '警告', {
      type: 'warning',
    });
  } catch {
    return;
  }
  clearing.value = true;
  try {
    await loginLogApi.clear();
    ElMessage.success('已清空');
    await reload();
  } catch {
    // 已提示
  } finally {
    clearing.value = false;
  }
}
</script>

<template>
  <div>
    <el-card shadow="never" class="page-card">
      <div class="page-toolbar">
        <el-input
          v-model="query.username"
          placeholder="用户名"
          clearable
          style="width: 160px"
          @keyup.enter="search"
        />
        <el-select
          v-model="query.status"
          placeholder="结果"
          clearable
          style="width: 120px"
        >
          <el-option label="成功" :value="1" />
          <el-option label="失败" :value="0" />
        </el-select>
        <el-button :icon="Search" type="primary" @click="search"
          >查询</el-button
        >
        <el-button :icon="Refresh" @click="reset">重置</el-button>
        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:loginlog:remove'"
            :icon="Delete"
            type="danger"
            plain
            :loading="clearing"
            @click="handleClear"
          >
            清空
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
        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
            {{ row.status === 1 ? '成功' : '失败' }}
          </el-tag>
        </template>

        <template #loginTime="{ row }">{{ fmtTime(row.loginTime) }}</template>

        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:loginlog:remove'"
              link
              type="danger"
              @click="remove(row as LoginLogItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>
  </div>
</template>
