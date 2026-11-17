<script setup lang="ts">
import { Plus, Refresh, Search } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  ElTree,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';
import { permissionApi } from '../../api/permission';
import { roleApi, type RoleCreateBody, type RoleQuery } from '../../api/role';
import type { DataScope, PermissionGroup, RoleItem } from '../../api/types';

/**
 * 内置超管的编号（`sys_role.level`）。
 * 判据用 level 而不是名称/权限码：名称可改、权限码可编，编号由库分配且不可改。
 * 与后端 role.service.ts 的 SUPERADMIN_LEVEL 保持一致。
 */
const SUPERADMIN_LEVEL = 0;

/**
 * 权限码格式：2–3 段小写标识符（`域:资源[:动作]`），如 `console:access`、`system:role:list`。
 *
 * 与后端 `common/authz/permission-code.ts` 的 `PERMISSION_CODE_REGEX` **同规则**。
 * 现在权限只能从清单树里勾选，已不可能手输，但校验留着当兜底：
 * 万一将来谁把选择器改回输入框，后端也会拒绝（`*`/`!` 一律不收）。
 */
const PERMISSION_CODE_REGEX =
  /^[a-z][a-z0-9-]{0,19}(:[a-z][a-z0-9-]{0,19}){1,2}$/;

const DATA_SCOPE_OPTIONS: { value: DataScope; label: string }[] = [
  { value: 'ALL', label: '全部数据' },
  { value: 'DEPT_AND_CHILD', label: '本部门及以下' },
  { value: 'DEPT', label: '本部门' },
  { value: 'SELF', label: '仅本人' },
  { value: 'CUSTOM', label: '自定义（暂未启用）' },
];

const dataScopeLabel = (value: DataScope): string =>
  DATA_SCOPE_OPTIONS.find((o) => o.value === value)?.label ?? value;

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------
const loading = ref(false);
const list = ref<RoleItem[]>([]);
const total = ref(0);

const query = reactive<RoleQuery>({
  pageNum: 1,
  pageSize: 10,
  keyword: '',
  status: undefined,
});

async function fetchList(): Promise<void> {
  loading.value = true;
  try {
    const res = await roleApi.page({ ...query });
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

// ---------------------------------------------------------------------------
// 新建 / 编辑
// ---------------------------------------------------------------------------
const dialogVisible = ref(false);
const dialogMode = ref<'create' | 'edit'>('create');
const editingId = ref<number | null>(null);
const submitting = ref(false);
const formRef = ref<FormInstance>();

/**
 * 编辑超管角色时锁定权限相关字段。
 * `RoleService.assertSuperAdminWritable()` 在服务端做同样的拦截，
 * 这里只是让界面**不要发出注定被拒的请求**。
 */
const superadminLock = ref(false);

const form = reactive<RoleCreateBody>({
  roleName: '',
  permissions: [],
  dataScope: 'SELF',
  status: 1,
});

// ---------------------------------------------------------------------------
// 权限清单树
// ---------------------------------------------------------------------------
/** 树节点：分组节点没有 code，叶子节点的 id 就是权限码 */
interface PermTreeNode {
  id: string;
  label: string;
  code?: string;
  /** 代码里已不存在（或从未收录），界面上标红提醒清理 */
  stale?: boolean;
  disabled?: boolean;
  children?: PermTreeNode[];
}

const permTreeRef = ref<InstanceType<typeof ElTree>>();
const permKeyword = ref('');
/** 后端返回的清单（含已停用条目，即 status=0） */
const permGroups = ref<PermissionGroup[]>([]);
const permLoading = ref(false);

/**
 * 构造树：
 * 1. 有效权限按 `模块显示名` 分组（如「角色管理」「隐患闭环」）；
 * 2. **额外**开一组「已失效 / 未收录」：角色里挂着但清单里没有或已停用的码。
 *
 * 第 2 组是关键。没有它，编辑一个挂着幽灵码的老角色时，
 * 界面上看不到那个码 → 保存时被静默丢掉，或者永远删不掉。
 * 显式展示 + 允许取消勾选，才是可治理的。
 */
const permTreeData = computed<PermTreeNode[]>(() => {
  const known = new Map<string, { name: string; stale: boolean }>();
  const groups: PermTreeNode[] = [];

  for (const group of permGroups.value) {
    const children: PermTreeNode[] = [];
    for (const perm of group.permissions) {
      known.set(perm.code, { name: perm.name, stale: perm.status !== 1 });
      if (perm.status !== 1) continue; // 停用码不进正常分组，避免引导人去勾
      children.push({
        id: perm.code,
        label: perm.name || perm.code,
        code: perm.code,
        disabled: superadminLock.value,
      });
    }
    if (!children.length) continue;
    groups.push({
      id: `g:${group.module}:${group.moduleLabel}`,
      label: group.moduleLabel || group.module,
      disabled: superadminLock.value,
      children,
    });
  }

  // 角色持有但不在「有效清单」里的码
  const orphans: PermTreeNode[] = [];
  for (const code of form.permissions ?? []) {
    const info = known.get(code);
    if (info && !info.stale) continue;
    orphans.push({
      id: code,
      label: info ? `${info.name}（代码中已不存在）` : code,
      code,
      stale: true,
      disabled: superadminLock.value,
    });
  }
  if (orphans.length) {
    groups.push({
      id: 'g:__stale__',
      label: `已失效 / 未收录（${orphans.length}）`,
      disabled: superadminLock.value,
      children: orphans,
    });
  }

  return groups;
});

function filterPermNode(value: string, data: Record<string, unknown>): boolean {
  if (!value) return true;
  const kw = value.toLowerCase();
  const label = String(data.label ?? '').toLowerCase();
  const code = String(data.code ?? '').toLowerCase();
  return label.includes(kw) || code.includes(kw);
}

watch(permKeyword, (value) => {
  permTreeRef.value?.filter(value);
});

/** 懒加载清单：只在第一次打开对话框时拉，后续复用 */
async function ensurePermGroups(): Promise<void> {
  if (permGroups.value.length || permLoading.value) return;
  permLoading.value = true;
  try {
    permGroups.value = await permissionApi.groups();
  } catch {
    // 已提示
  } finally {
    permLoading.value = false;
  }
}

/** 把当前表单里的权限码同步成树的勾选状态 */
async function syncTreeChecked(): Promise<void> {
  await nextTick();
  permTreeRef.value?.setCheckedKeys(form.permissions ?? [], false);
}

const rules = computed<FormRules>(() => ({
  roleName: [{ required: true, message: '请输入角色名称', trigger: 'blur' }],
  permissions: [
    {
      // 兜底校验：码现在只能从清单树勾选，理论上必然合法
      validator: (_rule, value, cb) => {
        const bad = ((value as string[] | undefined) ?? []).filter(
          (p) => !PERMISSION_CODE_REGEX.test(p),
        );
        if (bad.length) {
          cb(
            new Error(
              `权限码格式非法：${bad.join('、')}（须为 2-3 段小写标识符，不含 * 和 !）`,
            ),
          );
          return;
        }
        cb();
      },
      trigger: 'change',
    },
  ],
}));

function openCreate(): void {
  dialogMode.value = 'create';
  editingId.value = null;
  superadminLock.value = false;
  Object.assign(form, {
    roleName: '',
    permissions: [],
    dataScope: 'SELF',
    status: 1,
  });
  formRef.value?.clearValidate();
  permKeyword.value = '';
  dialogVisible.value = true;
  void ensurePermGroups().then(() => syncTreeChecked());
}

function openEdit(row: RoleItem): void {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  superadminLock.value = row.level === SUPERADMIN_LEVEL;
  Object.assign(form, {
    roleName: row.roleName,
    permissions: [...(row.permissions ?? [])],
    dataScope: row.dataScope,
    status: row.status,
  });
  formRef.value?.clearValidate();
  permKeyword.value = '';
  dialogVisible.value = true;
  void ensurePermGroups().then(() => syncTreeChecked());
}

async function submitForm(): Promise<void> {
  // 从树上收权限码：`leafOnly=true` 保证拿到的是码，不是分组节点 id
  if (!superadminLock.value) {
    form.permissions =
      (permTreeRef.value?.getCheckedKeys(true) as string[] | undefined) ?? [];
  }

  const valid = await formRef.value?.validate().catch(() => false);
  if (!valid) return;

  submitting.value = true;
  try {
    // 超管只放行 roleName：后端会拒绝其余字段，别发过去
    const payload: RoleCreateBody = superadminLock.value
      ? { roleName: form.roleName }
      : { ...form };
    if (dialogMode.value === 'create') {
      await roleApi.create(payload);
      ElMessage.success('创建成功');
    } else if (editingId.value !== null) {
      await roleApi.update(editingId.value, payload);
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

async function handleDelete(row: RoleItem): Promise<void> {
  try {
    await ElMessageBox.confirm(`确认删除角色「${row.roleName}」？`, '提示', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await roleApi.remove(row.id);
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
          placeholder="角色名称"
          clearable
          style="width: 200px"
          @keyup.enter="handleSearch"
        />
        <el-select
          v-model="query.status"
          placeholder="状态"
          clearable
          style="width: 120px"
        >
          <el-option label="正常" :value="1" />
          <el-option label="禁用" :value="0" />
        </el-select>
        <el-button :icon="Search" type="primary" @click="handleSearch">查询</el-button>
        <el-button :icon="Refresh" @click="handleReset">重置</el-button>

        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:role:add'"
            :icon="Plus"
            type="primary"
            @click="openCreate"
          >
            新建角色
          </el-button>
        </div>
      </div>

      <el-table v-loading="loading" :data="list" border stripe>
        <el-table-column prop="id" label="ID" width="70" />
        <el-table-column label="编号" width="90">
          <template #default="{ row }">
            <el-tag
              :type="row.level <= 4 ? 'warning' : 'info'"
              size="small"
              effect="plain"
            >
              {{ row.level }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="角色名称" min-width="150">
          <template #default="{ row }">
            {{ row.roleName }}
            <el-tag
              v-if="row.isBuiltin === 1"
              size="small"
              type="warning"
              effect="plain"
            >
              内置
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="数据范围" width="140">
          <template #default="{ row }">
            <el-tag size="small" type="info">
              {{ dataScopeLabel(row.dataScope) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="权限码" min-width="260">
          <template #default="{ row }">
            <template v-if="row.permissions?.length">
              <el-tag
                v-for="perm in row.permissions.slice(0, 3)"
                :key="perm"
                size="small"
                class="perm-tag"
              >
                {{ perm }}
              </el-tag>
              <el-tag v-if="row.permissions.length > 3" size="small" type="info">
                +{{ row.permissions.length - 3 }}
              </el-tag>
            </template>
            <span v-else class="form-tip">未配置</span>
          </template>
        </el-table-column>
        <el-table-column label="状态" width="90">
          <template #default="{ row }">
            <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
              {{ row.status === 1 ? '正常' : '禁用' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="创建时间" width="170">
          <template #default="{ row }">{{ fmtTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="160" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:role:edit'"
              link
              type="primary"
              @click="openEdit(row as RoleItem)"
            >
              编辑
            </el-button>
            <el-tooltip
              v-if="row.isBuiltin === 1"
              content="内置角色不可删除（如需停用请改为禁用状态）"
              placement="top"
            >
              <span>
                <el-button link type="danger" disabled>删除</el-button>
              </span>
            </el-tooltip>
            <el-button
              v-else
              v-perm="'system:role:remove'"
              link
              type="danger"
              @click="handleDelete(row as RoleItem)"
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
      :title="dialogMode === 'create' ? '新建角色' : '编辑角色'"
      width="620px"
      destroy-on-close
    >
      <el-alert
        v-if="superadminLock"
        type="warning"
        :closable="false"
        show-icon
        class="dialog-alert"
        title="内置超级管理员角色是系统管理域的唯一入口，权限 / 数据范围 / 状态已锁定，仅可修改名称"
      />
      <el-form ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item label="角色名称" prop="roleName">
          <el-input v-model="form.roleName" placeholder="如：部门管理员" />
          <div class="form-tip">
            编号（level）由系统自动分配：内置角色 0-4，自建角色从 5 起，分配后不可修改。
          </div>
        </el-form-item>
        <el-form-item label="数据范围" prop="dataScope">
          <el-select
            v-model="form.dataScope"
            :disabled="superadminLock"
            style="width: 100%"
          >
            <el-option
              v-for="opt in DATA_SCOPE_OPTIONS"
              :key="opt.value"
              :label="opt.label"
              :value="opt.value"
              :disabled="opt.value === 'CUSTOM'"
            />
          </el-select>
          <div class="form-tip">
            多角色取并集；无可用范围时按「不可见」处理（fail-closed）。
          </div>
        </el-form-item>
        <el-form-item label="权限" prop="permissions">
          <div v-loading="permLoading" class="perm-picker">
            <el-input
              v-model="permKeyword"
              size="small"
              clearable
              :disabled="superadminLock"
              placeholder="搜索权限码或名称"
              class="perm-search"
            />
            <el-tree
              ref="permTreeRef"
              :data="permTreeData"
              :props="{ label: 'label', children: 'children' }"
              node-key="id"
              show-checkbox
              default-expand-all
              :filter-node-method="filterPermNode"
              class="perm-tree"
            >
              <template #default="{ data }">
                <span class="perm-node">
                  <span>{{ data.label }}</span>
                  <code v-if="data.code" class="perm-node__code">
                    {{ data.code }}
                  </code>
                  <el-tag
                    v-if="data.stale"
                    size="small"
                    type="danger"
                    effect="plain"
                  >
                    已失效
                  </el-tag>
                </span>
              </template>
            </el-tree>
          </div>
          <div class="form-tip">
            按模块勾选。清单由 <code>pnpm authz:sync</code> 从接口装饰器反射生成，
            此处只能选、不能编 —— 要新增权限码，去写
            <code>@RequiresPermissions</code> 再同步一次。
          </div>
        </el-form-item>
        <el-form-item label="状态" prop="status">
          <el-switch
            v-model="form.status"
            :disabled="superadminLock"
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

<style scoped>
.perm-tag {
  margin-right: 4px;
  margin-bottom: 2px;
}

.perm-picker {
  width: 100%;
  border: 1px solid var(--el-border-color);
  border-radius: 4px;
  padding: 8px;
}

.perm-search {
  margin-bottom: 8px;
}

.perm-tree {
  max-height: 280px;
  overflow: auto;
}

.perm-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
}

.perm-node__code {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.dialog-alert {
  margin-bottom: 16px;
}
</style>
