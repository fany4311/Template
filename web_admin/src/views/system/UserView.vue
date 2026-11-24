<script setup lang="ts">
import {
  Download,
  Plus,
  Refresh,
  Search,
  Upload,
} from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { deptApi } from '../../api/dept';
import { roleApi } from '../../api/role';
import { userApi, type UserCreateBody } from '../../api/user';
import type {
  DeptTreeNode,
  RoleItem,
  UserItem,
  UserRoleGrant,
} from '../../api/types';
import DataTable, { type TableColumn } from '../../components/DataTable.vue';
import ImportDialog from '../../components/ImportDialog.vue';
import { useCrud } from '../../composables/useCrud';
import { useRefetch } from '../../composables/useRefetch';

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------
/** UserQuery 的分页字段在 OpenAPI 里是可选的，useCrud 要求必填，这里收窄 */
type UserListQuery = {
  pageNum: number;
  pageSize: number;
  keyword: string;
  status?: number;
  deptId?: number;
};

const { query, rows, total, loading, reload, search, reset, remove } = useCrud<
  UserItem,
  UserListQuery
>({
  api: { page: (q) => userApi.page(q), remove: userApi.remove },
  query: {
    pageNum: 1,
    pageSize: 10,
    keyword: '',
    status: undefined,
    deptId: undefined,
  },
  removeText: (row) => '确认删除用户「' + row.username + '」？',
  tags: ['user'],
});

const columns: TableColumn[] = [
  { prop: 'id', label: 'ID', width: 70 },
  { prop: 'username', label: '用户名', minWidth: 120 },
  { prop: 'nickname', label: '昵称', minWidth: 120 },
  { label: '部门', minWidth: 140, slot: 'dept' },
  { prop: 'post', label: '岗位', minWidth: 110 },
  { prop: 'phone', label: '手机号', minWidth: 120 },
  { label: '状态', width: 90, slot: 'status' },
  { label: '创建时间', width: 170, slot: 'createTime' },
];

const deptTree = ref<DeptTreeNode[]>([]);
const roleOptions = ref<RoleItem[]>([]);

const flatDepts = computed<DeptTreeNode[]>(() => {
  const out: DeptTreeNode[] = [];
  const walk = (nodes: DeptTreeNode[]): void => {
    for (const node of nodes) {
      out.push(node);
      walk(node.children ?? []);
    }
  };
  walk(deptTree.value);
  return out;
});

const deptMap = computed(() => new Map(flatDepts.value.map((d) => [d.id, d])));
const deptLabel = (id?: number | null): string =>
  id ? (deptMap.value.get(id)?.name ?? `#${id}`) : '-';

const roleMap = computed(
  () => new Map(roleOptions.value.map((r) => [r.id, r])),
);

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

async function loadDeptTree(): Promise<void> {
  try {
    deptTree.value = await deptApi.tree();
  } catch {
    // ignore
  }
}

async function loadRoles(): Promise<void> {
  try {
    const res = await roleApi.page({ pageNum: 1, pageSize: 100 });
    roleOptions.value = res.list;
  } catch {
    // ignore
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

const form = reactive<UserCreateBody>({
  username: '',
  password: '',
  nickname: '',
  email: '',
  phone: '',
  deptId: undefined,
  post: '',
  status: 1,
});

const rules = computed<FormRules>(() => ({
  username: [{ required: true, message: '请输入用户名', trigger: 'blur' }],
  password:
    dialogMode.value === 'create'
      ? [{ required: true, message: '请输入密码', trigger: 'blur' }]
      : [],
  email: [{ type: 'email', message: '邮箱格式不正确', trigger: 'blur' }],
}));

function resetForm(): void {
  Object.assign(form, {
    username: '',
    password: '',
    nickname: '',
    email: '',
    phone: '',
    deptId: undefined,
    post: '',
    status: 1,
  });
  formRef.value?.clearValidate();
}

function openCreate(): void {
  dialogMode.value = 'create';
  editingId.value = null;
  resetForm();
  dialogVisible.value = true;
}

function openEdit(row: UserItem): void {
  dialogMode.value = 'edit';
  editingId.value = row.id;
  Object.assign(form, {
    username: row.username,
    password: '',
    nickname: row.nickname,
    email: row.email,
    phone: row.phone,
    deptId: row.deptId ?? undefined,
    post: row.post,
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
      await userApi.create({ ...form });
      ElMessage.success('创建成功');
    } else if (editingId.value !== null) {
      // 更新不提交密码（后端另设改密接口）
      await userApi.update(editingId.value, {
        username: form.username,
        nickname: form.nickname,
        email: form.email,
        phone: form.phone,
        deptId: form.deptId,
        post: form.post,
        status: form.status,
      });
      ElMessage.success('更新成功');
    }
    dialogVisible.value = false;
    await reload();
  } catch {
    // 已提示
  } finally {
    submitting.value = false;
  }
}

// ---------------------------------------------------------------------------
// 重置密码（管理员不知道也不该知道用户的原密码，因此不要求输入旧密码）
// 重置后目标用户会话立即失效，需用新密码重新登录。
// ---------------------------------------------------------------------------
const pwdVisible = ref(false);
const pwdTarget = ref<UserItem | null>(null);
const pwdSubmitting = ref(false);
const pwdFormRef = ref<FormInstance | null>(null);
const pwdForm = reactive({ newPassword: '', confirmPassword: '' });

const pwdRules: FormRules = {
  newPassword: [
    { required: true, message: '请输入新密码', trigger: 'blur' },
    { min: 8, message: '新密码至少 8 位', trigger: 'blur' },
  ],
  confirmPassword: [
    { required: true, message: '请再次输入新密码', trigger: 'blur' },
    {
      validator: (_r, v: string, cb: (e?: Error) => void) => {
        if (v !== pwdForm.newPassword) cb(new Error('两次输入的新密码不一致'));
        else cb();
      },
      trigger: 'blur',
    },
  ],
};

function openResetPwd(row: UserItem): void {
  pwdTarget.value = row;
  pwdForm.newPassword = '';
  pwdForm.confirmPassword = '';
  pwdVisible.value = true;
}

async function submitResetPwd(): Promise<void> {
  if (!pwdTarget.value) return;
  try {
    await pwdFormRef.value?.validate();
  } catch {
    return;
  }
  pwdSubmitting.value = true;
  try {
    await userApi.resetPassword(pwdTarget.value.id, {
      newPassword: pwdForm.newPassword,
    });
    pwdVisible.value = false;
    ElMessage.success('密码已重置，该用户现需用新密码登录');
  } catch {
    // 已提示
  } finally {
    pwdSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------------
// 角色授权（含临时授权）
// ---------------------------------------------------------------------------
const grantVisible = ref(false);
const grantUser = ref<UserItem | null>(null);
const grantLoading = ref(false);
const grantSubmitting = ref(false);
const grants = ref<UserRoleGrant[]>([]);
const grantForm = reactive<{ roleIds: number[]; expireAt: Date | null }>({
  roleIds: [],
  expireAt: null,
});

async function loadGrants(): Promise<void> {
  if (!grantUser.value) return;
  grantLoading.value = true;
  try {
    grants.value = await userApi.grants(grantUser.value.id);
  } catch {
    // 已提示
  } finally {
    grantLoading.value = false;
  }
}

async function openGrant(row: UserItem): Promise<void> {
  grantUser.value = row;
  grants.value = [];
  grantForm.roleIds = [];
  grantForm.expireAt = null;
  grantVisible.value = true;
  await loadGrants();
}

async function submitGrant(): Promise<void> {
  if (!grantUser.value) return;
  if (!grantForm.roleIds.length) {
    ElMessage.warning('请选择要授予的角色');
    return;
  }
  grantSubmitting.value = true;
  try {
    await userApi.grant(grantUser.value.id, {
      roleIds: grantForm.roleIds,
      // 后端 z.iso.datetime() 要求 ISO 8601（UTC，带 Z）
      expireAt: grantForm.expireAt
        ? grantForm.expireAt.toISOString()
        : undefined,
    });
    ElMessage.success('授权成功');
    grantForm.roleIds = [];
    grantForm.expireAt = null;
    await loadGrants();
  } catch {
    // 已提示
  } finally {
    grantSubmitting.value = false;
  }
}

async function revokeGrant(grant: UserRoleGrant): Promise<void> {
  if (!grantUser.value) return;
  const roleName =
    roleMap.value.get(grant.roleId)?.roleName ?? `#${grant.roleId}`;
  try {
    await ElMessageBox.confirm(`确认撤销角色「${roleName}」？`, '提示', {
      type: 'warning',
    });
  } catch {
    return;
  }
  try {
    await userApi.revoke(grantUser.value.id, grant.roleId);
    ElMessage.success('已撤销');
    await loadGrants();
  } catch {
    // 已提示
  }
}

// ---------------------------------------------------------------------------
// 导入 / 导出
// 导出走后端同样的数据范围过滤；导入按「部门名称」解析，初始密码缺省取参数
// ---------------------------------------------------------------------------
const importVisible = ref(false);
const exporting = ref(false);

async function handleExport(): Promise<void> {
  exporting.value = true;
  try {
    await userApi.exportCsv({
      keyword: query.keyword || undefined,
      deptId: query.deptId,
      status: query.status,
    });
  } catch {
    // 错误提示由 http / downloadCsv 统一弹出
  } finally {
    exporting.value = false;
  }
}

/** 列表由 useCrud 自动加载；这里只补下拉数据源 */
onMounted(() => {
  void loadDeptTree();
  void loadRoles();
});

// 部门树 / 角色列表是"别人家的数据"：在部门页或角色页改完，
// 这里要跟着刷新，否则下拉里还是旧的（用户反馈最多的就是"改了没生效"）。
useRefetch(['dept'], loadDeptTree);
useRefetch(['role'], loadRoles);
</script>

<template>
  <div>
    <el-card shadow="never" class="page-card">
      <!-- 查询条件 -->
      <div class="page-toolbar">
        <el-input
          v-model="query.keyword"
          placeholder="用户名 / 昵称"
          clearable
          style="width: 200px"
          @keyup.enter="search"
        />
        <el-tree-select
          v-model="query.deptId"
          :data="deptTree"
          node-key="id"
          :props="{ label: 'name', children: 'children' }"
          check-strictly
          clearable
          placeholder="所属部门"
          style="width: 180px"
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
        <el-button :icon="Search" type="primary" @click="search"
          >查询</el-button
        >
        <el-button :icon="Refresh" @click="reset">重置</el-button>

        <div class="page-toolbar-right">
          <el-button
            v-perm="'system:user:export'"
            :icon="Download"
            :loading="exporting"
            @click="handleExport"
          >
            导出
          </el-button>
          <el-button
            v-perm="'system:user:import'"
            :icon="Upload"
            @click="importVisible = true"
          >
            导入
          </el-button>
          <el-button
            v-perm="'system:user:add'"
            :icon="Plus"
            type="primary"
            @click="openCreate"
          >
            新建用户
          </el-button>
        </div>
      </div>

      <!-- 列表 -->
      <DataTable
        v-model:page="query.pageNum"
        v-model:page-size="query.pageSize"
        :columns="columns"
        :rows="rows"
        :loading="loading"
        :total="total"
        @change="reload"
      >
        <template #dept="{ row }">{{ deptLabel(row.deptId) }}</template>

        <template #status="{ row }">
          <el-tag :type="row.status === 1 ? 'success' : 'info'" size="small">
            {{ row.status === 1 ? '正常' : '禁用' }}
          </el-tag>
        </template>

        <template #createTime="{ row }">{{ fmtTime(row.createTime) }}</template>

        <el-table-column label="操作" width="300" fixed="right">
          <template #default="{ row }">
            <el-button
              v-perm="'system:user:edit'"
              link
              type="primary"
              @click="openEdit(row as UserItem)"
            >
              编辑
            </el-button>
            <el-button
              v-perm="'system:user:grant'"
              link
              type="warning"
              @click="openGrant(row as UserItem)"
            >
              授权
            </el-button>
            <el-button
              v-perm="'system:user:reset-pwd'"
              link
              type="warning"
              @click="openResetPwd(row as UserItem)"
            >
              重置密码
            </el-button>
            <el-button
              v-perm="'system:user:remove'"
              link
              type="danger"
              @click="remove(row as UserItem)"
            >
              删除
            </el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <!-- 新建 / 编辑 -->
    <el-dialog
      v-model="dialogVisible"
      :title="dialogMode === 'create' ? '新建用户' : '编辑用户'"
      width="520px"
      destroy-on-close
    >
      <el-form ref="formRef" :model="form" :rules="rules" label-width="90px">
        <el-form-item label="用户名" prop="username">
          <el-input v-model="form.username" :disabled="dialogMode === 'edit'" />
        </el-form-item>
        <el-form-item
          v-if="dialogMode === 'create'"
          label="密码"
          prop="password"
        >
          <el-input v-model="form.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="昵称" prop="nickname">
          <el-input v-model="form.nickname" />
        </el-form-item>
        <el-form-item label="部门" prop="deptId">
          <el-tree-select
            v-model="form.deptId"
            :data="deptTree"
            node-key="id"
            :props="{ label: 'name', children: 'children' }"
            check-strictly
            clearable
            placeholder="请选择部门"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="岗位" prop="post">
          <el-input v-model="form.post" placeholder="如：科员 / 辅导员" />
        </el-form-item>
        <el-form-item label="邮箱" prop="email">
          <el-input v-model="form.email" />
        </el-form-item>
        <el-form-item label="手机号" prop="phone">
          <el-input v-model="form.phone" />
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

    <!-- 角色授权 -->
    <el-dialog
      v-model="grantVisible"
      :title="`角色授权 - ${grantUser?.username ?? ''}`"
      width="640px"
      destroy-on-close
    >
      <el-form label-width="90px">
        <el-form-item label="授予角色">
          <el-select
            v-model="grantForm.roleIds"
            multiple
            filterable
            placeholder="选择角色（可多选）"
            style="width: 100%"
          >
            <el-option
              v-for="role in roleOptions"
              :key="role.id"
              :label="`${role.roleName}（编号 ${role.level}）`"
              :value="role.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="到期时间">
          <el-date-picker
            v-model="grantForm.expireAt"
            type="datetime"
            placeholder="不填 = 永久授权"
            style="width: 100%"
          />
          <div class="form-tip">
            填写则为临时授权，到期后自动失效（由定时任务清理）。
          </div>
        </el-form-item>
        <el-form-item>
          <el-button
            type="primary"
            :loading="grantSubmitting"
            @click="submitGrant"
          >
            确认授予
          </el-button>
        </el-form-item>
      </el-form>

      <el-divider content-position="left">当前授权</el-divider>
      <el-table v-loading="grantLoading" :data="grants" border size="small">
        <el-table-column label="角色" min-width="150">
          <template #default="{ row }">
            {{ roleMap.get(row.roleId)?.roleName ?? `#${row.roleId}` }}
          </template>
        </el-table-column>
        <el-table-column label="类型" width="90">
          <template #default="{ row }">
            <el-tag
              :type="row.source === 'temp' ? 'warning' : 'success'"
              size="small"
            >
              {{ row.source === 'temp' ? '临时' : '永久' }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="到期时间" min-width="160">
          <template #default="{ row }">
            {{ row.expireAt ? fmtTime(row.expireAt) : '永久' }}
          </template>
        </el-table-column>
        <el-table-column label="操作" width="90">
          <template #default="{ row }">
            <el-button
              link
              type="danger"
              @click="revokeGrant(row as UserRoleGrant)"
              >撤销</el-button
            >
          </template>
        </el-table-column>
      </el-table>
    </el-dialog>

    <el-dialog v-model="pwdVisible" title="重置密码" width="420px">
      <el-alert
        type="warning"
        :closable="false"
        show-icon
        title="重置后该用户当前登录状态立即失效，需用新密码重新登录。"
        style="margin-bottom: 12px"
      />
      <el-form
        ref="pwdFormRef"
        :model="pwdForm"
        :rules="pwdRules"
        label-width="100px"
      >
        <el-form-item label="用户">
          <span>{{ pwdTarget?.username }}</span>
        </el-form-item>
        <el-form-item label="新密码" prop="newPassword">
          <el-input
            v-model="pwdForm.newPassword"
            type="password"
            show-password
          />
        </el-form-item>
        <el-form-item label="确认新密码" prop="confirmPassword">
          <el-input
            v-model="pwdForm.confirmPassword"
            type="password"
            show-password
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="pwdVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="pwdSubmitting"
          @click="submitResetPwd"
        >
          确定重置
        </el-button>
      </template>
    </el-dialog>

    <ImportDialog
      v-model="importVisible"
      title="导入用户"
      hint="表头：账号、昵称、部门、手机号、岗位、初始密码（仅 .csv；部门按名称匹配）"
      :upload="userApi.importCsv"
      @done="reload"
    />
  </div>
</template>
