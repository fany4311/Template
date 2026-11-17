<script setup lang="ts">
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import { ElMessage, type FormRules } from 'element-plus';
import { computed, reactive, ref, watch } from 'vue';
import { dictApi, type DictDataCreateBody, type DictTypeCreateBody } from '../../api/dict';
import type { DictDataItem, DictTypeItem } from '../../api/types';
import DataTable, { type TableColumn } from '../../components/DataTable.vue';
import FormDialog, { type FormColumn } from '../../components/FormDialog.vue';
import { useCrud } from '../../composables/useCrud';

/**
 * 字典管理：左「类型」右「数据」的主从布局。
 *
 * 两栏各有自己的分页与加载态，所以用两个 useCrud 实例；
 * 右栏查询依赖左栏选中项，故关掉自动加载，由 selectType 驱动。
 * 左栏要保持 highlight-current-row 的选中态，表格仍手写（DataTable 不接管行选中）。
 */
const TAG_TYPES = ['', 'success', 'warning', 'info', 'danger'] as const;
type TagType = Exclude<(typeof TAG_TYPES)[number], ''>;
/** tagType 在表里是自由字符串，渲染前收窄成 el-tag 认得的枚举 */
const asTagType = (value: string): TagType => value as TagType;

// ───────────────────────────── 左：字典类型 ─────────────────────────────
type TypeQuery = {
  pageNum: number;
  pageSize: number;
  keyword: string;
  status?: number;
};

const {
  query: typeQuery,
  rows: types,
  total: typeTotal,
  loading: typeLoading,
  reload: reloadTypes,
  search: searchTypes,
  remove: removeTypeRow,
} = useCrud<DictTypeItem, TypeQuery>({
  api: {
    page: (q) => dictApi.pageType({ ...q }),
    remove: dictApi.removeType,
  },
  query: { pageNum: 1, pageSize: 10, keyword: '', status: undefined },
  removeText: (row) => '确认删除字典「' + row.dictName + '」？其下字典数据会一并删除。',
});

const currentType = ref<DictTypeItem | null>(null);

function selectType(row: DictTypeItem): void {
  currentType.value = row;
  void searchData();
}

/** 列表刷新后若没有选中项，默认选第一条 —— 右栏不至于空着等用户点 */
watch(types, (list) => {
  if (!currentType.value && list.length) selectType(list[0]);
});

async function removeType(row: DictTypeItem): Promise<void> {
  const wasCurrent = currentType.value?.id === row.id;
  await removeTypeRow(row);
  if (!wasCurrent) return;
  currentType.value = null;
  if (types.value.length) {
    selectType(types.value[0]);
  } else {
    void reloadData();
  }
}

// ───────────────────────────── 右：字典数据 ─────────────────────────────
type DataQuery = { pageNum: number; pageSize: number; keyword: string };

const {
  query: dataQuery,
  rows: dataList,
  total: dataTotal,
  loading: dataLoading,
  reload: reloadData,
  search: searchData,
  remove: removeDataRow,
} = useCrud<DictDataItem, DataQuery>({
  api: {
    page: (q) =>
      currentType.value
        ? dictApi.pageData({
            pageNum: q.pageNum,
            pageSize: q.pageSize,
            keyword: q.keyword || undefined,
            dictType: currentType.value.dictType,
          })
        : Promise.resolve({ list: [], total: 0 }),
    remove: dictApi.removeData,
  },
  query: { pageNum: 1, pageSize: 10, keyword: '' },
  removeText: (row) => '确认删除「' + row.dictLabel + '」？',
  autoLoad: false,
});

const dataColumns: TableColumn[] = [
  { prop: 'dictLabel', label: '显示名', minWidth: 120 },
  { prop: 'dictValue', label: '值', minWidth: 110 },
  { prop: 'dictSort', label: '排序', width: 70 },
  { label: '标签样式', width: 100, slot: 'tagType' },
  { label: '状态', width: 70, slot: 'status' },
  { prop: 'remark', label: '备注', minWidth: 120, showOverflowTooltip: true },
];

const currentTypeLabel = computed(() =>
  currentType.value
    ? currentType.value.dictName + '（' + currentType.value.dictType + '）'
    : '未选择',
);

// ───────────────────────────── 类型表单 ─────────────────────────────
const typeDialogVisible = ref(false);
const typeDialogMode = ref<'create' | 'edit'>('create');
const editingTypeId = ref<number | null>(null);
const typeSubmitting = ref(false);

const EMPTY_TYPE: DictTypeCreateBody = { dictName: '', dictType: '', status: 1, remark: '' };
const typeForm = reactive<DictTypeCreateBody>({ ...EMPTY_TYPE });

const typeFormColumns: FormColumn[] = [
  { prop: 'dictName', label: '字典名称', placeholder: '如：用户性别' },
  { prop: 'dictType', label: '类型标识', placeholder: '如 sys_user_sex' },
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
];

const typeRules: FormRules = {
  dictName: [{ required: true, message: '请输入字典名称', trigger: 'blur' }],
  dictType: [
    { required: true, message: '请输入字典类型标识', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]+$/, message: '只允许字母、数字、下划线', trigger: 'blur' },
  ],
};

function openTypeCreate(): void {
  typeDialogMode.value = 'create';
  editingTypeId.value = null;
  Object.assign(typeForm, EMPTY_TYPE);
  typeDialogVisible.value = true;
}

function openTypeEdit(row: DictTypeItem): void {
  typeDialogMode.value = 'edit';
  editingTypeId.value = row.id;
  Object.assign(typeForm, {
    dictName: row.dictName,
    dictType: row.dictType,
    status: row.status,
    remark: row.remark,
  });
  typeDialogVisible.value = true;
}

async function submitType(): Promise<void> {
  typeSubmitting.value = true;
  try {
    if (typeDialogMode.value === 'create') {
      await dictApi.createType({ ...typeForm });
      ElMessage.success('创建成功');
    } else if (editingTypeId.value !== null) {
      const updated = await dictApi.updateType(editingTypeId.value, { ...typeForm });
      if (currentType.value?.id === editingTypeId.value) currentType.value = updated;
      ElMessage.success('更新成功');
    }
    typeDialogVisible.value = false;
    await reloadTypes();
  } catch {
    // 已提示
  } finally {
    typeSubmitting.value = false;
  }
}

// ───────────────────────────── 数据表单 ─────────────────────────────
const dataDialogVisible = ref(false);
const dataDialogMode = ref<'create' | 'edit'>('create');
const editingDataId = ref<number | null>(null);
const dataSubmitting = ref(false);

const EMPTY_DATA: DictDataCreateBody = {
  dictType: '',
  dictLabel: '',
  dictValue: '',
  dictSort: 0,
  tagType: '',
  status: 1,
  remark: '',
};
const dataForm = reactive<DictDataCreateBody>({ ...EMPTY_DATA });

const dataFormColumns = computed<FormColumn[]>(() => [
  { prop: 'dictLabel', label: '显示名' },
  { prop: 'dictValue', label: '值' },
  { prop: 'dictSort', label: '排序', type: 'number' },
  {
    prop: 'tagType',
    label: '标签样式',
    type: 'select',
    placeholder: '默认',
    options: TAG_TYPES.map((tag) => ({ label: tag || '默认', value: tag })),
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

const dataRules: FormRules = {
  dictLabel: [{ required: true, message: '请输入显示名', trigger: 'blur' }],
  dictValue: [{ required: true, message: '请输入值', trigger: 'blur' }],
};

const dataDialogTitle = computed(() =>
  dataDialogMode.value === 'create' ? '新增字典数据' : '编辑字典数据',
);

const typeDialogTitle = computed(() =>
  typeDialogMode.value === 'create' ? '新增字典类型' : '编辑字典类型',
);

function openDataCreate(): void {
  if (!currentType.value) {
    ElMessage.warning('请先选择左侧字典类型');
    return;
  }
  dataDialogMode.value = 'create';
  editingDataId.value = null;
  Object.assign(dataForm, { ...EMPTY_DATA, dictType: currentType.value.dictType });
  dataDialogVisible.value = true;
}

function openDataEdit(row: DictDataItem): void {
  dataDialogMode.value = 'edit';
  editingDataId.value = row.id;
  Object.assign(dataForm, {
    dictType: row.dictType,
    dictLabel: row.dictLabel,
    dictValue: row.dictValue,
    dictSort: row.dictSort,
    tagType: row.tagType,
    status: row.status,
    remark: row.remark,
  });
  dataDialogVisible.value = true;
}

async function submitData(): Promise<void> {
  dataSubmitting.value = true;
  try {
    if (dataDialogMode.value === 'create') {
      await dictApi.createData({ ...dataForm });
      ElMessage.success('创建成功');
    } else if (editingDataId.value !== null) {
      await dictApi.updateData(editingDataId.value, { ...dataForm });
      ElMessage.success('更新成功');
    }
    dataDialogVisible.value = false;
    await reloadData();
  } catch {
    // 已提示
  } finally {
    dataSubmitting.value = false;
  }
}
</script>

<template>
  <div class="dict-page">
    <el-card shadow="never" class="page-card dict-type-panel">
      <div class="page-toolbar page-toolbar--compact">
        <el-input
          v-model="typeQuery.keyword"
          placeholder="字典名称/类型"
          clearable
          size="small"
          style="width: 160px"
          @keyup.enter="searchTypes"
        />
        <el-button :icon="Search" size="small" type="primary" @click="searchTypes">
          查询
        </el-button>
        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:dict:add'"
            :icon="Plus"
            size="small"
            type="primary"
            @click="openTypeCreate"
          >
            新增类型
          </el-button>
        </div>
      </div>

      <el-table
        v-loading="typeLoading"
        :data="types"
        border
        size="small"
        highlight-current-row
        @current-change="(row: DictTypeItem | null) => row && selectType(row)"
      >
        <el-table-column prop="dictName" label="名称" min-width="110" />
        <el-table-column prop="dictType" label="类型标识" min-width="130" show-overflow-tooltip />
        <el-table-column label="状态" width="70">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:dict:edit'"
              link
              type="primary"
              @click="openTypeEdit(row as DictTypeItem)"
            >
              编辑
            </el-button>
            <el-button
              v-perm="'system:dict:remove'"
              link
              type="danger"
              @click="removeType(row as DictTypeItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="typeQuery.pageNum"
          v-model:page-size="typeQuery.pageSize"
          :total="typeTotal"
          :page-sizes="[10, 20, 50]"
          layout="total, prev, pager, next"
          small
          @current-change="reloadTypes"
        />
      </div>
    </el-card>

    <el-card shadow="never" class="page-card dict-data-panel">
      <div class="page-toolbar page-toolbar--compact">
        <span class="dict-current">当前字典：<b>{{ currentTypeLabel }}</b></span>
        <div class="page-toolbar-right">
          <el-button :icon="Refresh" size="small" @click="reloadData">刷新</el-button>
          <el-button
            v-perm="'system:dict:add'"
            :icon="Plus"
            size="small"
            type="primary"
            :disabled="!currentType"
            @click="openDataCreate"
          >
            新增数据
          </el-button>
        </div>
      </div>

      <DataTable
        v-model:page="dataQuery.pageNum"
        v-model:page-size="dataQuery.pageSize"
        :columns="dataColumns"
        :rows="dataList"
        :loading="dataLoading"
        :total="dataTotal"
        :page-sizes="[10, 20, 50]"
        @change="reloadData"
      >
        <template #tagType="{ row }">
          <el-tag v-if="row.tagType" :type="asTagType(row.tagType)" size="small">
            {{ row.tagType }}
          </el-tag>
          <span v-else>-</span>
        </template>

        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
            {{ row.status === 1 ? '正常' : '停用' }}
          </el-tag>
        </template>

        <el-table-column label="操作" width="110" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:dict:edit'"
              link
              type="primary"
              @click="openDataEdit(row as DictDataItem)"
            >
              编辑
            </el-button>
            <el-button
              v-perm="'system:dict:remove'"
              link
              type="danger"
              @click="removeDataRow(row as DictDataItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <FormDialog
      v-model="typeDialogVisible"
      :title="typeDialogTitle"
      :model="typeForm"
      :columns="typeFormColumns"
      :rules="typeRules"
      :saving="typeSubmitting"
      width="480px"
      @submit="submitType"
    />

    <FormDialog
      v-model="dataDialogVisible"
      :title="dataDialogTitle"
      :model="dataForm"
      :columns="dataFormColumns"
      :rules="dataRules"
      :saving="dataSubmitting"
      width="480px"
      @submit="submitData"
    />
  </div>
</template>

<style scoped>
.dict-page {
  display: grid;
  grid-template-columns: minmax(380px, 5fr) minmax(480px, 7fr);
  gap: 12px;
  align-items: start;
}

.page-toolbar--compact {
  gap: 8px;
  margin-bottom: 10px;
}

.dict-current {
  font-size: 13px;
  color: var(--el-text-color-regular);
}

@media (max-width: 1200px) {
  .dict-page {
    grid-template-columns: 1fr;
  }
}
</style>
