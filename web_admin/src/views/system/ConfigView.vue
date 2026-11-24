<script setup lang="ts">
import {
  Download,
  Plus,
  Refresh,
  Search,
  Upload,
} from '@element-plus/icons-vue';
import { ElMessage, type FormRules } from 'element-plus';
import { computed, reactive, ref } from 'vue';
import { configApi, type ConfigCreateBody } from '../../api/config';
import type { ConfigItem } from '../../api/types';
import DataTable, { type TableColumn } from '../../components/DataTable.vue';
import FormDialog, { type FormColumn } from '../../components/FormDialog.vue';
import ImportDialog from '../../components/ImportDialog.vue';
import { useCrud } from '../../composables/useCrud';

/**
 * 参数配置（通用管理域）—— 列表页样板。
 *
 * 分工：
 * - useCrud      ：查询条件 / 分页 / 加载 / 删除
 * - DataTable    ：表格 + 分页条 + 列插槽
 * - FormDialog   ：弹窗表单 + 校验
 * - 本文件剩下  ：「这个模块特有」的东西：字段、校验规则、保存逻辑、内置参数不可删的分支
 */

type ConfigQuery = {
  pageNum: number;
  pageSize: number;
  keyword: string;
  status?: number;
};

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

const { query, rows, total, loading, reload, search, reset, remove } = useCrud<
  ConfigItem,
  ConfigQuery
>({
  api: configApi,
  query: { pageNum: 1, pageSize: 10, keyword: '', status: undefined },
  removeText: (row) => '确认删除参数「' + row.configName + '」？',
});

const columns: TableColumn[] = [
  { prop: 'id', label: 'ID', width: 70 },
  { prop: 'configName', label: '参数名称', minWidth: 150 },
  {
    prop: 'configKey',
    label: '参数键',
    minWidth: 180,
    showOverflowTooltip: true,
  },
  {
    prop: 'configValue',
    label: '参数值',
    minWidth: 180,
    showOverflowTooltip: true,
  },
  { label: '类型', width: 100, slot: 'type' },
  { label: '状态', width: 80, slot: 'status' },
  { prop: 'remark', label: '备注', minWidth: 140, showOverflowTooltip: true },
  { label: '创建时间', width: 170, slot: 'createTime' },
];

// ───────────────────────────── 新建 / 编辑 ─────────────────────────────
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const submitting = ref(false);

const EMPTY_FORM: ConfigCreateBody = {
  configName: '',
  configKey: '',
  configValue: '',
  configType: 'N',
  status: 1,
  remark: '',
};

const form = reactive<ConfigCreateBody>({ ...EMPTY_FORM });

/** 编辑内置参数时：参数键与「系统内置」开关都锁住（后端也只放行值） */
const formColumns = computed<FormColumn[]>(() => [
  { prop: 'configName', label: '参数名称', placeholder: '如：用户初始密码' },
  {
    prop: 'configKey',
    label: '参数键',
    placeholder: '如 sys.user.initPassword',
    disabled: dialogMode.value === 'edit' && form.configType === 'Y',
  },
  { prop: 'configValue', label: '参数值', type: 'textarea', rows: 2 },
  {
    prop: 'configType',
    label: '系统内置',
    type: 'switch',
    activeValue: 'Y',
    inactiveValue: 'N',
    activeText: '内置（不可删）',
    inactiveText: '自定义',
    disabled: dialogMode.value === 'edit',
  },
  {
    prop: 'status',
    label: '状态',
    type: 'switch',
    activeValue: 1,
    inactiveValue: 0,
    activeText: '正常',
    inactiveText: '停用',
  },
  { prop: 'remark', label: '备注', type: 'textarea', rows: 2 },
]);

const rules: FormRules = {
  configName: [{ required: true, message: '请输入参数名称', trigger: 'blur' }],
  configKey: [
    { required: true, message: '请输入参数键', trigger: 'blur' },
    {
      pattern: /^[a-zA-Z0-9_.:-]+$/,
      message: '只允许字母、数字、_ . : -',
      trigger: 'blur',
    },
  ],
  configValue: [{ required: true, message: '请输入参数值', trigger: 'blur' }],
};

const dialogTitle = computed(() =>
  dialogMode.value === 'create' ? '新建参数' : '编辑参数',
);

function openCreate(): void {
  dialogMode.value = 'create';
  editingId.value = null;
  Object.assign(form, EMPTY_FORM);
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
  dialogVisible.value = true;
}

// ───────────────────────────── 导入 / 导出 ─────────────────────────────
const importVisible = ref(false);
const exporting = ref(false);

/** 导出当前筛选结果（后端上限 5000 行，超了会提示缩小范围） */
async function handleExport(): Promise<void> {
  exporting.value = true;
  try {
    await configApi.exportCsv({
      keyword: query.keyword || undefined,
      status: query.status,
    });
  } catch {
    // 错误提示由 downloadCsv / http 层统一弹出
  } finally {
    exporting.value = false;
  }
}

async function submitForm(): Promise<void> {
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
    await reload();
  } catch {
    // 错误提示由 http 层统一弹出
  } finally {
    submitting.value = false;
  }
}
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
          @keyup.enter="search"
        />
        <el-select
          v-model="query.status"
          placeholder="状态"
          clearable
          style="width: 120px"
        >
          <el-option label="正常" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
        <el-button :icon="Search" type="primary" @click="search"
          >查询</el-button
        >
        <el-button :icon="Refresh" @click="reset">重置</el-button>
        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:config:export'"
            :icon="Download"
            :loading="exporting"
            @click="handleExport"
          >
            导出
          </el-button>
          <el-button
            v-perm="'system:config:import'"
            :icon="Upload"
            @click="importVisible = true"
          >
            导入
          </el-button>
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

      <DataTable
        v-model:page="query.pageNum"
        v-model:page-size="query.pageSize"
        :columns="columns"
        :rows="rows"
        :loading="loading"
        :total="total"
        @change="reload"
      >
        <template #type="{ row }">
          <el-tag
            :type="row.configType === 'Y' ? 'warning' : 'info'"
            size="small"
          >
            {{ row.configType === 'Y' ? '系统内置' : '自定义' }}
          </el-tag>
        </template>

        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
            {{ row.status === 1 ? '正常' : '停用' }}
          </el-tag>
        </template>

        <template #createTime="{ row }">{{ fmtTime(row.createTime) }}</template>

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
            <el-tooltip
              v-if="row.configType === 'Y'"
              content="系统内置参数不可删除"
              placement="top"
            >
              <span
                ><el-button link type="danger" disabled>删除</el-button></span
              >
            </el-tooltip>
            <el-button
              v-else
              v-perm="'system:config:remove'"
              link
              type="danger"
              @click="remove(row as ConfigItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <ImportDialog
      v-model="importVisible"
      title="导入参数配置"
      hint="表头：参数名称、参数键、参数值、类型、状态、备注（仅 .csv）"
      :upload="configApi.importCsv"
      @done="reload"
    />

    <FormDialog
      v-model="dialogVisible"
      :title="dialogTitle"
      :model="form"
      :columns="formColumns"
      :rules="rules"
      :saving="submitting"
      @submit="submitForm"
    />
  </div>
</template>
