<script setup lang="ts">
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { dictApi, type DictDataCreateBody, type DictTypeCreateBody } from '../../api/dict';
import type { DictDataItem, DictTypeItem } from '../../api/types';

const TAG_TYPES = ['', 'success', 'warning', 'info', 'danger'] as const;

// ---------------------------------------------------------------------------
// 左侧：字典类型
// ---------------------------------------------------------------------------
const typeLoading = ref(false);
const types = ref<DictTypeItem[]>([]);
const typeTotal = ref(0);
const typeQuery = reactive({ pageNum: 1, pageSize: 10, keyword: '', status: undefined as number | undefined });
const currentType = ref<DictTypeItem | null>(null);

async function fetchTypes(): Promise<void> {
  typeLoading.value = true;
  try {
    const res = await dictApi.pageType({ ...typeQuery });
    types.value = res.list;
    typeTotal.value = res.total;
    if (!currentType.value && res.list.length) selectType(res.list[0]);
  } catch {
    // 已提示
  } finally {
    typeLoading.value = false;
  }
}

function selectType(row: DictTypeItem): void {
  currentType.value = row;
  dataQuery.pageNum = 1;
  void fetchData();
}

const typeDialogVisible = ref(false);
const typeDialogMode = ref<'create' | 'edit'>('create');
const editingTypeId = ref<number | null>(null);
const typeFormRef = ref<FormInstance>();
const typeSubmitting = ref(false);
const typeForm = reactive<DictTypeCreateBody>({
  dictName: '',
  dictType: '',
  status: 1,
  remark: '',
});
const typeRules = computed<FormRules>(() => ({
  dictName: [{ required: true, message: '请输入字典名称', trigger: 'blur' }],
  dictType: [
    { required: true, message: '请输入字典类型标识', trigger: 'blur' },
    { pattern: /^[a-zA-Z0-9_]+$/, message: '只允许字母、数字、下划线', trigger: 'blur' },
  ],
}));

function openTypeCreate(): void {
  typeDialogMode.value = 'create';
  editingTypeId.value = null;
  Object.assign(typeForm, { dictName: '', dictType: '', status: 1, remark: '' });
  typeFormRef.value?.clearValidate();
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
  typeFormRef.value?.clearValidate();
  typeDialogVisible.value = true;
}

async function submitType(): Promise<void> {
  const valid = await typeFormRef.value?.validate().catch(() => false);
  if (!valid) return;
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
    await fetchTypes();
  } catch {
    // 已提示
  } finally {
    typeSubmitting.value = false;
  }
}

async function removeType(row: DictTypeItem): Promise<void> {
  try {
    await ElMessageBox.confirm(
      `确认删除字典「${row.dictName}」？其下字典数据会一并删除。`,
      '提示',
      { type: 'warning' },
    );
  } catch {
    return;
  }
  try {
    await dictApi.removeType(row.id);
    ElMessage.success('删除成功');
    if (currentType.value?.id === row.id) currentType.value = null;
    await fetchTypes();
  } catch {
    // 已提示
  }
}

// ---------------------------------------------------------------------------
// 右侧：字典数据
// ---------------------------------------------------------------------------
const dataLoading = ref(false);
const dataList = ref<DictDataItem[]>([]);
const dataTotal = ref(0);
const dataQuery = reactive({ pageNum: 1, pageSize: 10, keyword: '', dictType: '' });

async function fetchData(): Promise<void> {
  if (!currentType.value) {
    dataList.value = [];
    dataTotal.value = 0;
    return;
  }
  dataLoading.value = true;
  try {
    const res = await dictApi.pageData({
      pageNum: dataQuery.pageNum,
      pageSize: dataQuery.pageSize,
      keyword: dataQuery.keyword || undefined,
      dictType: currentType.value.dictType,
    });
    dataList.value = res.list;
    dataTotal.value = res.total;
  } catch {
    // 已提示
  } finally {
    dataLoading.value = false;
  }
}

const dataDialogVisible = ref(false);
const dataDialogMode = ref<'create' | 'edit'>('create');
const editingDataId = ref<number | null>(null);
const dataFormRef = ref<FormInstance>();
const dataSubmitting = ref(false);
const dataForm = reactive<DictDataCreateBody>({
  dictType: '',
  dictLabel: '',
  dictValue: '',
  dictSort: 0,
  tagType: '',
  status: 1,
  remark: '',
});
const dataRules = computed<FormRules>(() => ({
  dictLabel: [{ required: true, message: '请输入显示名', trigger: 'blur' }],
  dictValue: [{ required: true, message: '请输入值', trigger: 'blur' }],
}));

function openDataCreate(): void {
  if (!currentType.value) {
    ElMessage.warning('请先选择左侧字典类型');
    return;
  }
  dataDialogMode.value = 'create';
  editingDataId.value = null;
  Object.assign(dataForm, {
    dictType: currentType.value.dictType,
    dictLabel: '',
    dictValue: '',
    dictSort: 0,
    tagType: '',
    status: 1,
    remark: '',
  });
  dataFormRef.value?.clearValidate();
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
  dataFormRef.value?.clearValidate();
  dataDialogVisible.value = true;
}

async function submitData(): Promise<void> {
  const valid = await dataFormRef.value?.validate().catch(() => false);
  if (!valid) return;
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
    await fetchData();
  } catch {
    // 已提示
  } finally {
    dataSubmitting.value = false;
  }
}

async function removeData(row: DictDataItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除「${row.dictLabel}」？`, '提示', { type: 'warning' });
  } catch {
    return;
  }
  try {
    await dictApi.removeData(row.id);
    ElMessage.success('删除成功');
    await fetchData();
  } catch {
    // 已提示
  }
}

onMounted(fetchTypes);
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
          @keyup.enter="fetchTypes"
        />
        <el-button :icon="Search" size="small" type="primary" @click="fetchTypes">查询</el-button>
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
          @current-change="fetchTypes"
        />
      </div>
    </el-card>

    <el-card shadow="never" class="page-card dict-data-panel">
      <div class="page-toolbar page-toolbar--compact">
        <span class="dict-current">
          当前字典：
          <b>{{ currentType ? `${currentType.dictName}（${currentType.dictType}）` : '未选择' }}</b>
        </span>
        <div class="page-toolbar-right">
          <el-button :icon="Refresh" size="small" @click="fetchData">刷新</el-button>
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

      <el-table v-loading="dataLoading" :data="dataList" border size="small">
        <el-table-column prop="dictLabel" label="显示名" min-width="120" />
        <el-table-column prop="dictValue" label="值" min-width="110" />
        <el-table-column prop="dictSort" label="排序" width="70" />
        <el-table-column label="标签样式" width="100">
          <template #default="{ row }">
            <el-tag v-if="row.tagType" :type="row.tagType" size="small">
              {{ row.tagType }}
            </el-tag>
            <span v-else>-</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="70">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="remark" label="备注" min-width="120" show-overflow-tooltip />
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
              @click="removeData(row as DictDataItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination">
        <el-pagination
          v-model:current-page="dataQuery.pageNum"
          v-model:page-size="dataQuery.pageSize"
          :total="dataTotal"
          :page-sizes="[10, 20, 50]"
          layout="total, prev, pager, next"
          small
          @current-change="fetchData"
        />
      </div>
    </el-card>

    <!-- 字典类型表单 -->
    <el-dialog
      v-model="typeDialogVisible"
      :title="typeDialogMode === 'create' ? '新增字典类型' : '编辑字典类型'"
      width="480px"
      destroy-on-close
    >
      <el-form ref="typeFormRef" :model="typeForm" :rules="typeRules" label-width="90px">
        <el-form-item label="字典名称" prop="dictName">
          <el-input v-model="typeForm.dictName" placeholder="如：用户性别" />
        </el-form-item>
        <el-form-item label="类型标识" prop="dictType">
          <el-input v-model="typeForm.dictType" placeholder="如 sys_user_sex" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-switch
            v-model="typeForm.status"
            :active-value="1"
            :inactive-value="0"
            active-text="正常"
            inactive-text="停用"
          />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="typeForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="typeDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="typeSubmitting" @click="submitType">确定</el-button>
      </template>
    </el-dialog>

    <!-- 字典数据表单 -->
    <el-dialog
      v-model="dataDialogVisible"
      :title="dataDialogMode === 'create' ? '新增字典数据' : '编辑字典数据'"
      width="480px"
      destroy-on-close
    >
      <el-form ref="dataFormRef" :model="dataForm" :rules="dataRules" label-width="90px">
        <el-form-item label="显示名" prop="dictLabel">
          <el-input v-model="dataForm.dictLabel" />
        </el-form-item>
        <el-form-item label="值" prop="dictValue">
          <el-input v-model="dataForm.dictValue" />
        </el-form-item>
        <el-form-item label="排序" prop="dictSort">
          <el-input-number v-model="dataForm.dictSort" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="标签样式" prop="tagType">
          <el-select v-model="dataForm.tagType" clearable placeholder="默认" style="width: 100%">
            <el-option
              v-for="tag in TAG_TYPES"
              :key="tag || 'default'"
              :label="tag || '默认'"
              :value="tag"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-switch
            v-model="dataForm.status"
            :active-value="1"
            :inactive-value="0"
            active-text="正常"
            inactive-text="停用"
          />
        </el-form-item>
        <el-form-item label="备注" prop="remark">
          <el-input v-model="dataForm.remark" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dataDialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="dataSubmitting" @click="submitData">确定</el-button>
      </template>
    </el-dialog>
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
  color: #606266;
}

@media (max-width: 1200px) {
  .dict-page {
    grid-template-columns: 1fr;
  }
}
</style>
