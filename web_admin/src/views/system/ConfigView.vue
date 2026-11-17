<script setup lang="ts">
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { configApi, type ConfigCreateBody } from '../../api/config';
import type { ConfigItem } from '../../api/types';

const loading = ref(false);
const list = ref<ConfigItem[]>([]);
const total = ref(0);
const query = reactive<{ pageNum: number; pageSize: number; keyword: string; status?: number }>({
  pageNum: 1,
  pageSize: 10,
  keyword: '',
  status: undefined,
});

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    const res = await configApi.page({ ...query });
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
  query.keyword = '';
  query.status = undefined;
  query.pageNum = 1;
  void fetchList();
}

const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const submitting = ref(false);
const formRef = ref<FormInstance>();

const form = reactive<ConfigCreateBody>({
  configName: '',
  configKey: '',
  configValue: '',
  configType: 'N',
  status: 1,
  remark: '',
});

const rules = computed<FormRules>(() => ({
  configName: [{ required: true, message: '请输入参数名称', trigger: 'blur' }],
  configKey: [
    { required: true, message: '请输入参数键', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_.:-]+$/, message: '只允许字母、数字、_ . : -', trigger: 'blur' },
  ],
  configValue: [{ required: true, message: '请输入参数值', trigger: 'blur' }],
}));

function openCreate(): void {
  dialogMode.value = 'create';
  editingId.value = null;
  Object.assign(form, {
    configName: '',
    configKey: '',
    configValue: '',
    configType: 'N',
    status: 1,
    remark: '',
  });
  formRef.value?.clearValidate();
  dialogVisible.value = true;
}

function openEdit(row: ConfigItem): void {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  Object.assign(form, {
    configName: row.configName,
    configKey: row.configKey,
    configValue: row.configValue,
    configType: row.configType,
    status: row.status,
    remark: row.remark,
  });
  formRef.value?.clearValidate();
  dialogVisible.value = true;
}

async function submitForm(): Promise<void> {
  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;
  submitting.value = true;
  try {
    if (dialogMode.value === 'create') {
      await configApi.create({ ...form });
      ElMessage.success('创建成功');
    } else if (editingId.value !== null) {
      await configApi.update(editingId.value, { ...form });
      ElMessage.success('更新成功');
    }
    dialogVisible.value = false;
    await fetchList();
  } catch {
    // 已提示
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(row: ConfigItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除参数「${row.configName}」？`, '提示', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await configApi.remove(row.id);
    ElMessage.success('删除成功');
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
          v-model="query.keyword"
          placeholder="参数名称 / 键"
          clearable
          style="width: 200px"
          @keyup.enter="handleSearch"
        />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px">
          <el-option label="正常" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
        <el-button :icon="Search" type="primary" @click="handleSearch">查询</el-button>
        <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:config:add'"
            :icon="Plus"
            type="primary"
            @click="openCreate"
          >
            新建参数
          </el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column prop="configName" label="参数名称" min-width="150" />
        <el-table-column prop="configKey" label="参数键" min-width="180" show-overflow-tooltip />
        <el-table-column prop="configValue" label="参数值" min-width="180" show-overflow-tooltip />
        <el-table-column label="类型" width="100">
          <template #default="{ row }">
            <el-tag :type="row.configType === 'Y' ? 'warning' : 'info'" size="small">
              {{ row.configType === 'Y' ? '系统内置' : '自定义' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="140" show-overflow-tooltip />
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="150" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:config:edit'"
              link
              type="primary"
              @click="openEdit(row as ConfigItem)"
            >
              编辑
            </el-button>
            <el-tooltip v-if="row.configType === 'Y'" content="系统内置参数不可删除" placement="top">
              <span><el-button link type="danger" disabled>删除</el-button></span>
            </el-tooltip>
            <el-button
              v-else
              v-perm="'system:config:remove'"
              link
              type="danger"
              @click="handleDelete(row as ConfigItem)"
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

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建参数' : '编辑参数'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="参数名称" prop="configName">
          <el-input v-model="form.configName" placeholder="如：用户初始密码" />
        </el-form-item>
        <el-form-item label="参数键" prop="configKey">
          <el-input
            v-model="form.configKey"
            :disabled="dialogMode === 'edit' && form.configType === 'Y'"
            placeholder="如 sys.user.initPassword"
          />
        </el-form-item>
        <el-form-item label="参数值" prop="configValue">
          <el-input v-model="form.configValue" type="textarea" :rows="2" />
        </el-form-item>
        <el-form-item label="系统内置" prop="configType">
          <el-switch
            v-model="form.configType"
            active-value="Y"
            inactive-value="N"
            :disabled="dialogMode === 'edit'"
            active-text="内置（不可删）"
            inactive-text="自定义"
          />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-switch
            v-model="form.status"
            :active-value="1"
            :inactive-value="0"
            active-text="正常"
            inactive-text="停用"
          />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="form.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
