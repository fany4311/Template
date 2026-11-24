<script setup lang="ts">
import { Plus, Refresh } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { deptApi, type DeptCreateBody } from '../../api/dept';
import { invalidate } from '../../composables/useRefetch';
import type { DeptTreeNode } from '../../api/types';
import DataTable, { type TableColumn } from '../../components/DataTable.vue';

/**
 * 部门树：接口返回整棵树、无分页，所以不走 useCrud（它的分页/退页语义在这里没意义），
 * 只用 DataTable 统一表格与 loading。树形展开由 el-table 的 row-key + children 驱动。
 */
const loading = ref(false);
const tree = ref<DeptTreeNode[]>([]);

const columns: TableColumn[] = [
  { prop: 'name', label: '部门名称', minWidth: 220 },
  { prop: 'ancestors', label: '祖先路径', minWidth: 140 },
  { prop: 'sort', label: '排序', width: 80 },
  { label: '状态', width: 90, slot: 'status' },
  { label: '创建时间', width: 170, slot: 'createTime' },
];

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

async function fetchTree(): Promise<void> {
  loading.value = true;
  try {
    tree.value = await deptApi.tree();
  } catch {
    // 已提示
  } finally {
    loading.value = false;
  }
}

// ---------------------------------------------------------------------------
// 新建 / 编辑
// ---------------------------------------------------------------------------
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const submitting = ref(false);
const formRef = ref<FormInstance>();

const form = reactive<DeptCreateBody>({
  parentId: undefined,
  name: '',
  sort: 0,
  status: 1,
});

const rules = computed<FormRules>(() => ({
  name: [{ required: true, message: '请输入部门名称', trigger: 'blur' }],
}));

/** 编辑时禁止把父级选成自己或自己的子孙（后端也会校验） */
const parentTreeData = computed<DeptTreeNode[]>(() => {
  if (dialogMode.value !== 'edit' || editingId.value === null)
    return tree.value;
  const excluded = editingId.value;
  const filter = (nodes: DeptTreeNode[]): DeptTreeNode[] =>
    nodes
      .filter((node) => node.id !== excluded)
      .map((node) => ({ ...node, children: filter(node.children ?? []) }));
  return filter(tree.value);
});

function openCreate(parentId?: number): void {
  dialogMode.value = 'create';
  editingId.value = null;
  Object.assign(form, {
    parentId: parentId ?? undefined,
    name: '',
    sort: 0,
    status: 1,
  });
  formRef.value?.clearValidate();
  dialogVisible.value = true;
}

function openEdit(row: DeptTreeNode): void {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  Object.assign(form, {
    parentId: row.parentId ?? undefined,
    name: row.name,
    sort: row.sort,
    status: row.status,
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
      await deptApi.create({ ...form });
      ElMessage.success('创建成功');
    } else if (editingId.value !== null) {
      await deptApi.update(editingId.value, { ...form });
      ElMessage.success('更新成功');
    }
    dialogVisible.value = false;
    await fetchTree();
    await invalidate('dept'); // 用户页的「所属部门」树要跟着变
  } catch {
    // 已提示
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(row: DeptTreeNode): Promise<void> {
  if (row.children?.length) {
    ElMessage.warning('该部门存在下级部门，请先删除下级');
    return;
  }
  try {
    await ElMessageBox.confirm(`确认删除部门「${row.name}」？`, '提示', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await deptApi.remove(row.id);
    ElMessage.success('删除成功');
    await fetchTree();
    await invalidate('dept');
  } catch {
    // 已提示
  }
}

onMounted(fetchTree);
</script>

<template>
  <div>
    <el-card shadow="never" class="page-card">
      <div class="page-toolbar">
        <el-button :icon="Refresh" @click="fetchTree">刷新</el-button>
        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:dept:add'"
            :icon="Plus"
            type="primary"
            @click="openCreate()"
          >
            新建部门
          </el-button>
        </div>
      </div>

      <DataTable
        :columns="columns"
        :rows="tree"
        :loading="loading"
        :total="0"
        :pagination="false"
        default-expand-all
      >
        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
            {{ row.status === 1 ? '正常' : '禁用' }}
          </el-tag>
        </template>

        <template #createTime="{ row }">{{ fmtTime(row.createTime) }}</template>

        <el-table-column label="操作" width="220" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:dept:add'"
              link
              type="primary"
              @click="openCreate(row.id)"
            >
              新增下级
            </el-button>
            <el-button
              v-perm="'system:dept:edit'"
              link
              type="primary"
              @click="openEdit(row as DeptTreeNode)"
            >
              编辑
            </el-button>
            <el-button
              v-perm="'system:dept:remove'"
              link
              type="danger"
              @click="handleDelete(row as DeptTreeNode)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建部门' : '编辑部门'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="上级部门" prop="parentId">
          <el-tree-select
            v-model="form.parentId"
            :data="parentTreeData"
            node-key="id"
            :props="{ label: 'name', children: 'children' }"
            check-strictly
            clearable
            placeholder="不选 = 顶级部门"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="部门名称" prop="name">
          <el-input v-model="form.name" placeholder="如：保卫处" />
        </el-form-item>
        <el-form-item label="排序" prop="sort">
          <el-input-number v-model="form.sort" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-switch
            v-model="form.status"
            :active-value="1"
            :inactive-value="0"
            active-text="正常"
            inactive-text="禁用"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>
