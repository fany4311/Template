<script setup lang="ts">
import { Delete, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { onMounted, reactive, ref } from 'vue';
import { loginLogApi } from '../../api/log';
import type { LoginLogItem } from '../../api/types';

const loading = ref(false);
const list = ref<LoginLogItem[]>([]);
const total = ref(0);

const query = reactive<{
  pageNum: number;
  pageSize: number;
  username: string;
  status?: number;
}>({
  pageNum: 1,
  pageSize: 10,
  username: '',
  status: undefined,
});

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    const res = await loginLogApi.page({ ...query });
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
  query.username = '';
  query.status = undefined;
  query.pageNum = 1;
  void fetchList();
}

async function handleRemove(row: LoginLogItem): Promise<void> {
  try {
    await ElMessageBox.confirm('确认删除该条登录日志？', '提示', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await loginLogApi.remove(row.id);
    ElMessage.success('删除成功');
    await fetchList();
  } catch {
    // 已提示
  }
}

async function handleClear(): Promise<void> {
  try {
    await ElMessageBox.confirm('确认清空全部登录日志？不可恢复。', '警告', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await loginLogApi.clear();
    ElMessage.success('已清空');
    await fetchList();
  } catch {
    // 已提示
  }
}

onMounted(fetchList);
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
          @keyup.enter="handleSearch"
        />
        <el-select v-model="query.status" placeholder="结果" clearable style="width: 120px">
          <el-option label="成功" :value="1" />
          <el-option label="失败" :value="0" />
        </el-select>
        <el-button :icon="Search" type="primary" @click="handleSearch">查询</el-button>
        <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:loginlog:remove'"
            :icon="Delete"
            type="danger"
            plain
            @click="handleClear"
          >
            清空
          </el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="ID" width="90" />
        <el-table-column prop="username" label="用户名" min-width="130" />
        <el-table-column label="结果" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'danger'" size="small">
              {{ row.status === 1 ? '成功' : '失败' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="msg" label="说明" min-width="160" show-overflow-tooltip />
        <el-table-column prop="ip" label="IP" width="140" />
        <el-table-column prop="userAgent" label="User-Agent" min-width="220" show-overflow-tooltip />
        <el-table-column label="登录时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.loginTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="80" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:loginlog:remove'"
              link
              type="danger"
              @click="handleRemove(row as LoginLogItem)"
            >
              删除
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
  </div>
</template>
