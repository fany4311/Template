<script setup lang="ts">
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { menuApi, type MenuCreateBody } from '../../api/menu';
import type { MenuItem, MenuType } from '../../api/types';

const TYPE_LABEL: Record<MenuType, string> = { M: '目录', C: '菜单', F: '按钮' };
const TYPE_TAG: Record<MenuType, 'primary' | 'success' | 'info'> = {
  M: 'primary',
  C: 'success',
  F: 'info',
};

const loading = ref(false);
const tree = ref<MenuItem[]>([]);
const query = reactive<{ keyword: string; status?: number }>({
  keyword: '',
  status: undefined,
});

async function fetchTree(): Promise<void> {
  loading.value = true;
  try {
    tree.value = await menuApi.tree({ ...query });
  } catch {
    // 已提示
  } finally {
    loading.value = false;
  }
}

function handleReset(): void {
  query.keyword = '';
  query.status = undefined;
  void fetchTree();
}

// ---------------------------------------------------------------------------
// 新建 / 编辑
// ---------------------------------------------------------------------------
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const submitting = ref(false);
const formRef = ref<FormInstance>();

const form = reactive<MenuCreateBody>({
  parentId: undefined,
  name: '',
  type: 'C',
  path: '',
  component: '',
  perms: '',
  icon: '',
  sort: 0,
  visible: 1,
  status: 1,
});

const rules = computed<FormRules>(() => ({
  name: [{ required: true, message: '请输入菜单名称', trigger: 'blur' }],
  type: [{ required: true, message: '请选择类型', trigger: 'change' }],
}));

/** 上级菜单候选：编辑时排除自己与自己的子孙 */
const parentTreeData = computed<MenuItem[]>(() => {
  if (dialogMode.value !== 'edit' || editingId.value === null) return tree.value;
  const excluded = editingId.value;
  const filter = (nodes: MenuItem[]): MenuItem[] =>
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
    type: 'C',
    path: '',
    component: '',
    perms: '',
    icon: '',
    sort: 0,
    visible: 1,
    status: 1,
  });
  formRef.value?.clearValidate();
  dialogVisible.value = true;
}

function openEdit(row: MenuItem): void {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  Object.assign(form, {
    parentId: row.parentId ?? undefined,
    name: row.name,
    type: row.type,
    path: row.path,
    component: row.component,
    perms: row.perms,
    icon: row.icon,
    sort: row.sort,
    visible: row.visible,
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
      await menuApi.create({ ...form });
      ElMessage.success('创建成功');
    } else if (editingId.value !== null) {
      await menuApi.update(editingId.value, { ...form });
      ElMessage.success('更新成功');
    }
    dialogVisible.value = false;
    await fetchTree();
  } catch {
    // 已提示
  } finally {
    submitting.value = false;
  }
}

async function handleDelete(row: MenuItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除菜单「${row.name}」？`, '提示', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await menuApi.remove(row.id);
    ElMessage.success('删除成功');
    await fetchTree();
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
        <el-input
          v-model="query.keyword"
          placeholder="菜单名称"
          clearable
          style="width: 200px"
          @keyup.enter="fetchTree"
        />
        <el-select v-model="query.status" placeholder="状态" clearable style="width: 120px">
          <el-option label="正常" :value="1" />
          <el-option label="停用" :value="0" />
        </el-select>
        <el-button :icon="Search" type="primary" @click="fetchTree">查询</el-button>
        <el-button :icon="Refresh" @click="handleReset">重置</el-button>
        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:menu:add'"
            :icon="Plus"
            type="primary"
            @click="openCreate()"
          >
            新建菜单
          </el-button>
        </div>
      </div>

      <el-table
        v-loading="loading"
        :data="tree"
        row-key="id"
        border
        default-expand-all
        :tree-props="{ children: 'children' }"
      >
        <el-table-column prop="name" label="名称" min-width="200" />
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag :type="TYPE_TAG[row.type as MenuType]" size="small">
              {{ TYPE_LABEL[row.type as MenuType] }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column prop="path" label="路由地址" min-width="150" />
        <el-table-column prop="component" label="组件路径" min-width="160" show-overflow-tooltip />
        <el-table-column prop="perms" label="权限码" min-width="170" show-overflow-tooltip />
        <el-table-column prop="sort" label="排序" width="70" />
        <el-table-column label="可见" width="80">
          <template #default="{ row }">
            {{ row.visible === 1 ? '显示' : '隐藏' }}
          </template>
        </el-table-column>
        <el-table-column label="状态" width="80">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '正常' : '停用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="操作" width="210" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:menu:add'"
              link
              type="primary"
              @click="openCreate(row.id)"
            >
              新增下级
            </el-button>
            <el-button
              v-perm="'system:menu:edit'"
              link
              type="primary"
              @click="openEdit(row as MenuItem)"
            >
              编辑
            </el-button>
            <el-button
              v-perm="'system:menu:remove'"
              link
              type="danger"
              @click="handleDelete(row as MenuItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </el-card>

    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建菜单' : '编辑菜单'"
      width="600px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="上级菜单" prop="parentId">
          <el-tree-select
            v-model="form.parentId"
            :data="parentTreeData"
            node-key="id"
            :props="{ label: 'name', children: 'children' }"
            check-strictly
            clearable
            placeholder="不选 = 顶级菜单"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="类型" prop="type">
          <el-radio-group v-model="form.type">
            <el-radio value="M">目录</el-radio>
            <el-radio value="C">菜单</el-radio>
            <el-radio value="F">按钮</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item label="名称" prop="name">
          <el-input v-model="form.name" placeholder="如：用户管理" />
        </el-form-item>
        <el-form-item label="路由地址" prop="path">
          <el-input v-model="form.path" placeholder="如 /system/user（目录也可填 /system）" />
        </el-form-item>
        <el-form-item v-if="form.type === 'C'" label="组件路径" prop="component">
          <el-input
            v-model="form.component"
            placeholder="相对 src/views，如 system/UserView（不写 .vue）"
          />
        </el-form-item>
        <el-form-item label="权限码" prop="perms">
          <el-input v-model="form.perms" placeholder="如 system:user:list（按钮填 system:user:add）" />
          <div class="form-tip">
            为空表示登录即可见；按钮类型（F）只用于权限码，不参与菜单渲染。
          </div>
        </el-form-item>
        <el-form-item label="图标" prop="icon">
          <el-input v-model="form.icon" placeholder="预留，如 User" />
        </el-form-item>
        <el-form-item label="排序" prop="sort">
          <el-input-number v-model="form.sort" :min="0" :max="9999" />
        </el-form-item>
        <el-form-item label="显示" prop="visible">
          <el-switch v-model="form.visible" :active-value="1" :inactive-value="0" />
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
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="submitForm">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>
