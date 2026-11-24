<script setup lang="ts">
import { Plus, Refresh, Search, View } from '@element-plus/icons-vue';
import {
  ElMessage,
  ElMessageBox,
  type FormInstance,
  type FormRules,
} from 'element-plus';
import { computed, onMounted, reactive, ref } from 'vue';
import { deptApi } from '../../api/dept';
import { dictApi } from '../../api/dict';
import {
  HAZARD_ACTION_PERMISSIONS,
  hazardApi,
  type HazardAcceptBody,
  type HazardReportBody,
} from '../../api/hazard';
import type {
  DeptTreeNode,
  DictOption,
  HazardDetail,
  HazardItem,
} from '../../api/types';
import DataTable, { type TableColumn } from '../../components/DataTable.vue';
import { useCrud } from '../../composables/useCrud';
import { useAuthStore } from '../../stores/auth';

/**
 * 隐患台账页 —— 第一个业务闭环的前端。
 *
 * 关键设计：**按钮不自己判断状态**。
 * 后端在每个隐患单上返回 `availableActions`（由状态机算出），
 * 前端只做「状态机允许 ∩ 我有权限码」两件事的交集，
 * 这样后端改状态机，前端不用跟着改判断逻辑。
 */
const auth = useAuthStore();

/** 查询表单：onlyMine 在 UI 上是开关（boolean），出网时转成字符串（后端 stringbool） */
type HazardListQuery = {
  pageNum: number;
  pageSize: number;
  keyword: string;
  status?: string;
  level?: string;
  scope?: string;
  category?: string;
  onlyMine: boolean;
};

const { query, rows, total, loading, reload, search, reset } = useCrud<
  HazardItem,
  HazardListQuery
>({
  api: {
    page: (q) =>
      hazardApi.page({
        ...q,
        onlyMine: q.onlyMine ? 'true' : undefined,
      } as Record<string, unknown>),
  },
  query: {
    pageNum: 1,
    pageSize: 10,
    keyword: '',
    status: undefined,
    level: undefined,
    scope: undefined,
    category: undefined,
    onlyMine: false,
  },
});

const columns: TableColumn[] = [
  { prop: 'hazardNo', label: '编号', width: 170 },
  { prop: 'title', label: '标题', minWidth: 200, showOverflowTooltip: true },
  { label: '类别', width: 110, slot: 'category' },
  { label: '等级', width: 110, slot: 'level' },
  { label: '范围', width: 120, slot: 'scope' },
  { label: '状态', width: 100, slot: 'status' },
  { prop: 'assigneeDeptName', label: '主责部门', width: 120 },
  { label: '协办部门', minWidth: 140, slot: 'cooperate' },
  { prop: 'reporterName', label: '上报人', width: 110 },
  { label: '整改期限', width: 150, slot: 'deadline' },
];

const categories = ref<DictOption[]>([]);
const levels = ref<DictOption[]>([]);
const deptTree = ref<DeptTreeNode[]>([]);

const fmtTime = (value?: string | null): string =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-';

/** el-tag 的 type 是字面量联合，不能是宽 string */
type TagType = 'primary' | 'success' | 'warning' | 'info' | 'danger';

/** 字典里的 tagType 来自后端，可能不在联合内，收窄一次 */
function asTagType(value: string | undefined): TagType {
  const allowed: TagType[] = [
    'primary',
    'success',
    'warning',
    'info',
    'danger',
  ];
  return allowed.includes(value as TagType) ? (value as TagType) : 'info';
}

const catLabel = (v: string): string =>
  categories.value.find((c) => c.value === v)?.label ?? v;
const catTag = (v: string): TagType =>
  asTagType(categories.value.find((c) => c.value === v)?.tagType);
const levelLabel = (v: string): string =>
  levels.value.find((c) => c.value === v)?.label ?? v;
const levelTag = (v: string): TagType =>
  asTagType(levels.value.find((c) => c.value === v)?.tagType);

const STATUS_TAG: Record<string, TagType> = {
  REPORTED: 'warning',
  PROCESSING: 'primary',
  RECTIFIED: 'info',
  REVIEWED: 'success',
  ARCHIVED: 'info',
  REJECTED: 'danger',
};
const SCOPE_LABEL: Record<string, string> = {
  DEPT: '本部门',
  OPEN: '多部门协同',
  SCHOOL: '全校通报',
};
const SCOPE_TAG: Record<string, TagType> = {
  DEPT: 'info',
  OPEN: 'warning',
  SCHOOL: 'danger',
};

// ---------------------------------------------------------------------------
// 列表
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// 上报
// ---------------------------------------------------------------------------

const reportVisible = ref(false);
const reportSubmitting = ref(false);
const reportRef = ref<FormInstance>();
const reportForm = reactive<HazardReportBody & { cooperateDeptIds: number[] }>({
  title: '',
  content: '',
  location: '',
  category: 'FIRE',
  level: 'LOW',
  scope: 'DEPT',
  cooperateDeptIds: [],
});

const reportRules = computed<FormRules>(() => ({
  title: [
    { required: true, message: '请输入隐患标题', trigger: 'blur' },
    { min: 2, max: 200, message: '标题 2~200 字', trigger: 'blur' },
  ],
  content: [
    { required: true, message: '请输入隐患描述', trigger: 'blur' },
    { min: 5, message: '描述至少 5 个字', trigger: 'blur' },
  ],
}));

function openReport(): void {
  Object.assign(reportForm, {
    title: '',
    content: '',
    location: '',
    category: categories.value[0]?.value ?? '',
    level: 'LOW',
    scope: 'DEPT',
    cooperateDeptIds: [],
  });
  reportRef.value?.clearValidate();
  reportVisible.value = true;
}

async function submitReport(): Promise<void> {
  const valid = await reportRef.value?.validate().catch(() => false);
  if (!valid) return;
  if (reportForm.scope === 'OPEN' && !reportForm.cooperateDeptIds.length) {
    ElMessage.warning('多部门协同单必须至少选择一个协办部门');
    return;
  }
  reportSubmitting.value = true;
  try {
    await hazardApi.report({
      ...reportForm,
      cooperateDeptIds:
        reportForm.scope === 'OPEN' ? reportForm.cooperateDeptIds : [],
    });
    ElMessage.success('上报成功');
    reportVisible.value = false;
    await reload();
  } catch {
    // 已提示
  } finally {
    reportSubmitting.value = false;
  }
}

// ---------------------------------------------------------------------------
// 详情 + 流转
// ---------------------------------------------------------------------------

const detailVisible = ref(false);
const detailLoading = ref(false);
const detail = ref<HazardDetail | null>(null);

const flowVisible = ref(false);
const flowSubmitting = ref(false);
const flowKind = ref<
  '' | 'accept' | 'reject' | 'rectify' | 'review' | 'archive'
>('');
const flowForm = reactive({
  assigneeDeptId: undefined as number | undefined,
  cooperateDeptIds: [] as number[],
  rectifyDeadline: '' as string,
  remark: '',
  reason: '',
  rectifyMeasure: '',
  passed: true,
  opinion: '',
});
const flowRef = ref<FormInstance>();

async function openDetail(id: number): Promise<void> {
  detailVisible.value = true;
  detailLoading.value = true;
  try {
    detail.value = await hazardApi.detail(id);
  } catch {
    detailVisible.value = false;
  } finally {
    detailLoading.value = false;
  }
}

async function reloadDetail(): Promise<void> {
  if (!detail.value) return;
  detail.value = await hazardApi.detail(detail.value.id);
  await reload();
}

/** 状态机允许 && 我有权限码 */
function canDo(action: keyof typeof HAZARD_ACTION_PERMISSIONS): boolean {
  if (!detail.value?.availableActions.includes(action)) return false;
  return auth.hasPermission(HAZARD_ACTION_PERMISSIONS[action]);
}

function openFlow(kind: typeof flowKind.value, passed = true): void {
  flowKind.value = kind;
  Object.assign(flowForm, {
    assigneeDeptId: detail.value?.assigneeDeptId ?? undefined,
    cooperateDeptIds: [...(detail.value?.cooperateDeptIds ?? [])],
    rectifyDeadline:
      detail.value?.rectifyDeadline ?? detail.value?.deadlineAt ?? '',
    remark: '',
    reason: '',
    rectifyMeasure: '',
    passed,
    opinion: '',
  });
  flowRef.value?.clearValidate();
  flowVisible.value = true;
}

const FLOW_TITLE: Record<string, string> = {
  accept: '受理隐患',
  reject: '驳回隐患',
  rectify: '提交整改',
  review: '复查隐患',
  archive: '归档隐患',
};

async function submitFlow(): Promise<void> {
  const valid = await flowRef.value?.validate().catch(() => false);
  if (!valid || !detail.value) return;
  const id = detail.value.id;
  flowSubmitting.value = true;
  try {
    switch (flowKind.value) {
      case 'accept':
        await hazardApi.accept(id, {
          assigneeDeptId: flowForm.assigneeDeptId,
          cooperateDeptIds: flowForm.cooperateDeptIds,
          rectifyDeadline: flowForm.rectifyDeadline
            ? new Date(flowForm.rectifyDeadline).toISOString()
            : undefined,
          remark: flowForm.remark,
        } as HazardAcceptBody);
        break;
      case 'reject':
        await hazardApi.reject(id, { reason: flowForm.reason });
        break;
      case 'rectify':
        await hazardApi.rectify(id, {
          rectifyMeasure: flowForm.rectifyMeasure,
          remark: flowForm.remark,
        });
        break;
      case 'review':
        await hazardApi.review(id, {
          passed: flowForm.passed,
          opinion: flowForm.opinion,
        });
        break;
      case 'archive':
        await hazardApi.archive(id, { opinion: flowForm.opinion });
        break;
      default:
        break;
    }
    ElMessage.success(`${FLOW_TITLE[flowKind.value] ?? '操作'}成功`);
    flowVisible.value = false;
    await reloadDetail();
  } catch {
    // 已提示
  } finally {
    flowSubmitting.value = false;
  }
}

async function handleDelete(): Promise<void> {
  if (!detail.value) return;
  try {
    await ElMessageBox.confirm(
      `确认删除隐患「${detail.value.hazardNo}」？`,
      '提示',
      {
        type: 'warning',
      },
    );
  } catch {
    return;
  }
  try {
    await hazardApi.remove(detail.value.id);
    ElMessage.success('删除成功');
    detailVisible.value = false;
    await reload();
  } catch {
    // 已提示
  }
}

/** 列表由 useCrud 自动加载；这里只补字典与部门树 */
onMounted(async () => {
  const [cat, lv, tree] = await Promise.allSettled([
    dictApi.options('hazard_category'),
    dictApi.options('hazard_level'),
    deptApi.tree(),
  ]);
  if (cat.status === 'fulfilled') categories.value = cat.value;
  if (lv.status === 'fulfilled') levels.value = lv.value;
  if (tree.status === 'fulfilled') deptTree.value = tree.value;
});
</script>

<template>
  <div>
    <el-card shadow="never" class="page-card">
      <div class="page-toolbar">
        <el-input
          v-model="query.keyword"
          placeholder="编号 / 标题 / 地点"
          clearable
          style="width: 200px"
          @keyup.enter="search"
        />
        <el-select
          v-model="query.status"
          placeholder="状态"
          clearable
          style="width: 130px"
        >
          <el-option label="待受理" value="REPORTED" />
          <el-option label="整改中" value="PROCESSING" />
          <el-option label="待复查" value="RECTIFIED" />
          <el-option label="待归档" value="REVIEWED" />
          <el-option label="已归档" value="ARCHIVED" />
          <el-option label="已驳回" value="REJECTED" />
        </el-select>
        <el-select
          v-model="query.level"
          placeholder="等级"
          clearable
          style="width: 120px"
        >
          <el-option
            v-for="item in levels"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-select
          v-model="query.category"
          placeholder="类别"
          clearable
          style="width: 130px"
        >
          <el-option
            v-for="item in categories"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-checkbox v-model="query.onlyMine">只看我部门</el-checkbox>
        <el-button :icon="Search" type="primary" @click="search"
          >查询</el-button
        >
        <el-button :icon="Refresh" @click="reset">重置</el-button>
        <div class="page-toolbar-right">
          <el-button
            v-perm="'hazard:report:add'"
            :icon="Plus"
            type="primary"
            @click="openReport"
          >
            上报隐患
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
        <template #category="{ row }">
          <el-tag :type="catTag(row.category)" size="small">{{
            catLabel(row.category)
          }}</el-tag>
        </template>

        <template #level="{ row }">
          <el-tag :type="levelTag(row.level)" size="small">{{
            levelLabel(row.level)
          }}</el-tag>
        </template>

        <template #scope="{ row }">
          <el-tag
            :type="SCOPE_TAG[row.scope] ?? 'info'"
            size="small"
            effect="plain"
          >
            {{ SCOPE_LABEL[row.scope] ?? row.scope }}
          </el-tag>
        </template>

        <template #status="{ row }">
          <el-tag :type="STATUS_TAG[row.status] ?? 'info'" size="small">
            {{ row.statusLabel }}
          </el-tag>
        </template>

        <template #cooperate="{ row }">
          <span v-if="!row.cooperateDeptNames.length" class="muted">-</span>
          <el-tag
            v-for="name in row.cooperateDeptNames"
            :key="name"
            size="small"
            type="info"
            effect="plain"
            style="margin-right: 4px"
          >
            {{ name }}
          </el-tag>
        </template>

        <template #deadline="{ row }">
          <span :class="{ 'text-danger': row.overdue }">
            {{ fmtTime(row.rectifyDeadline) }}
            <el-tag v-if="row.overdue" type="danger" size="small">逾期</el-tag>
          </span>
        </template>

        <el-table-column label="操作" width="100" fixed="right">
          <template #default="{ row }">
            <el-button
              :icon="View"
              link
              type="primary"
              @click="openDetail(row.id)"
            >
              详情
            </el-button>
          </template>
        </el-table-column>
      </DataTable>
    </el-card>

    <!-- 上报 -->
    <el-dialog
      v-model="reportVisible"
      title="上报隐患"
      width="620px"
      destroy-on-close
    >
      <el-form
        ref="reportRef"
        :model="reportForm"
        :rules="reportRules"
        label-width="90px"
      >
        <el-form-item label="标题" prop="title">
          <el-input v-model="reportForm.title" placeholder="简要描述隐患" />
        </el-form-item>
        <el-form-item label="描述" prop="content">
          <el-input v-model="reportForm.content" type="textarea" :rows="4" />
        </el-form-item>
        <el-form-item label="地点">
          <el-input
            v-model="reportForm.location"
            placeholder="如：第三教学楼 3F 东侧"
          />
        </el-form-item>
        <el-form-item label="类别">
          <el-select v-model="reportForm.category" style="width: 100%">
            <el-option
              v-for="item in categories"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="等级">
          <el-select v-model="reportForm.level" style="width: 100%">
            <el-option
              v-for="item in levels"
              :key="item.value"
              :label="item.label"
              :value="item.value"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="可见范围">
          <el-radio-group v-model="reportForm.scope">
            <el-radio value="DEPT">本部门闭环</el-radio>
            <el-radio value="OPEN">多部门协同</el-radio>
          </el-radio-group>
        </el-form-item>
        <el-form-item v-if="reportForm.scope === 'OPEN'" label="协办部门">
          <el-tree-select
            v-model="reportForm.cooperateDeptIds"
            :data="deptTree"
            node-key="id"
            :props="{ label: 'name', children: 'children' }"
            multiple
            show-checkbox
            check-strictly
            style="width: 100%"
            placeholder="选择需要协同处理的部门"
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="reportVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="reportSubmitting"
          @click="submitReport"
        >
          提交
        </el-button>
      </template>
    </el-dialog>

    <!-- 详情 -->
    <el-drawer v-model="detailVisible" title="隐患详情" size="640px">
      <div v-loading="detailLoading">
        <template v-if="detail">
          <el-descriptions :column="2" border size="small">
            <el-descriptions-item label="编号">{{
              detail.hazardNo
            }}</el-descriptions-item>
            <el-descriptions-item label="状态">
              <el-tag :type="STATUS_TAG[detail.status] ?? 'info'" size="small">
                {{ detail.statusLabel }}
              </el-tag>
            </el-descriptions-item>
            <el-descriptions-item label="标题" :span="2">{{
              detail.title
            }}</el-descriptions-item>
            <el-descriptions-item label="描述" :span="2">{{
              detail.content
            }}</el-descriptions-item>
            <el-descriptions-item label="地点">{{
              detail.location || '-'
            }}</el-descriptions-item>
            <el-descriptions-item label="类别">{{
              catLabel(detail.category)
            }}</el-descriptions-item>
            <el-descriptions-item label="等级">{{
              levelLabel(detail.level)
            }}</el-descriptions-item>
            <el-descriptions-item label="范围">
              {{ SCOPE_LABEL[detail.scope] ?? detail.scope }}
            </el-descriptions-item>
            <el-descriptions-item label="上报人">{{
              detail.reporterName
            }}</el-descriptions-item>
            <el-descriptions-item label="主责部门">
              {{ detail.assigneeDeptName || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="协办部门" :span="2">
              {{ detail.cooperateDeptNames.join('、') || '-' }}
            </el-descriptions-item>
            <el-descriptions-item label="整改期限">
              <span :class="{ 'text-danger': detail.overdue }">
                {{ fmtTime(detail.rectifyDeadline) }}
              </span>
            </el-descriptions-item>
            <el-descriptions-item label="处理人">
              {{ detail.handlerName || '-' }}
            </el-descriptions-item>
            <el-descriptions-item
              v-if="detail.rectifyMeasure"
              label="整改措施"
              :span="2"
            >
              {{ detail.rectifyMeasure }}
            </el-descriptions-item>
            <el-descriptions-item
              v-if="detail.reviewOpinion"
              label="复查意见"
              :span="2"
            >
              {{ detail.reviewOpinion }}
            </el-descriptions-item>
            <el-descriptions-item
              v-if="detail.archiveOpinion"
              label="归档意见"
              :span="2"
            >
              {{ detail.archiveOpinion }}
            </el-descriptions-item>
            <el-descriptions-item
              v-if="detail.rejectReason"
              label="驳回原因"
              :span="2"
            >
              {{ detail.rejectReason }}
            </el-descriptions-item>
          </el-descriptions>

          <!-- 操作区：状态机允许 ∩ 我有权限 -->
          <div class="flow-actions">
            <el-button
              v-if="canDo('ACCEPT')"
              type="primary"
              @click="openFlow('accept')"
            >
              受理
            </el-button>
            <el-button
              v-if="canDo('RECTIFY')"
              type="primary"
              @click="openFlow('rectify')"
            >
              提交整改
            </el-button>
            <el-button
              v-if="canDo('REVIEW_PASS')"
              type="success"
              @click="openFlow('review', true)"
            >
              复查通过
            </el-button>
            <el-button
              v-if="canDo('REVIEW_BACK')"
              type="warning"
              @click="openFlow('review', false)"
            >
              退回整改
            </el-button>
            <el-button
              v-if="canDo('ARCHIVE')"
              type="success"
              @click="openFlow('archive')"
            >
              归档
            </el-button>
            <el-button
              v-if="canDo('REJECT')"
              type="danger"
              plain
              @click="openFlow('reject')"
            >
              驳回
            </el-button>
            <el-button
              v-if="auth.hasPermission('hazard:report:remove')"
              type="danger"
              link
              @click="handleDelete"
            >
              删除
            </el-button>
          </div>

          <el-divider content-position="left">流转轨迹</el-divider>
          <el-timeline>
            <el-timeline-item
              v-for="log in detail.logs"
              :key="log.id"
              :timestamp="fmtTime(log.createTime)"
              placement="top"
            >
              <div class="timeline-title">
                <strong>{{ log.actionLabel }}</strong>
                <span class="muted">
                  {{ log.fromStatus ? `${log.fromStatus} → ` : ''
                  }}{{ log.toStatus }}
                </span>
              </div>
              <div class="muted">{{ log.operatorName }}</div>
              <div v-if="log.remark" class="timeline-remark">
                {{ log.remark }}
              </div>
            </el-timeline-item>
          </el-timeline>

          <el-divider content-position="left">省平台同步</el-divider>
          <el-table :data="detail.syncRecords" size="small" border>
            <el-table-column prop="eventType" label="事件" min-width="150" />
            <el-table-column prop="toStatus" label="状态" width="110" />
            <el-table-column label="结果" width="90">
              <template #default="{ row }">
                <el-tag
                  :type="row.status === 'SUCCESS' ? 'success' : 'danger'"
                  size="small"
                >
                  {{ row.status === 'SUCCESS' ? '成功' : '失败' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column
              prop="target"
              label="目标"
              min-width="150"
              show-overflow-tooltip
            />
            <el-table-column label="时间" width="160">
              <template #default="{ row }">{{
                fmtTime(row.createTime)
              }}</template>
            </el-table-column>
          </el-table>
          <el-empty
            v-if="!detail.syncRecords.length"
            description="暂无同步记录（异步投递中）"
            :image-size="60"
          />
        </template>
      </div>
    </el-drawer>

    <!-- 流转动作 -->
    <el-dialog
      v-model="flowVisible"
      :title="FLOW_TITLE[flowKind] ?? '操作'"
      width="560px"
      destroy-on-close
    >
      <el-form ref="flowRef" :model="flowForm" label-width="90px">
        <template v-if="flowKind === 'accept'">
          <el-form-item label="主责部门">
            <el-tree-select
              v-model="flowForm.assigneeDeptId"
              :data="deptTree"
              node-key="id"
              :props="{ label: 'name', children: 'children' }"
              check-strictly
              clearable
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="协办部门">
            <el-tree-select
              v-model="flowForm.cooperateDeptIds"
              :data="deptTree"
              node-key="id"
              :props="{ label: 'name', children: 'children' }"
              multiple
              show-checkbox
              check-strictly
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="整改期限">
            <el-date-picker
              v-model="flowForm.rectifyDeadline"
              type="datetime"
              value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
              style="width: 100%"
            />
          </el-form-item>
          <el-form-item label="说明">
            <el-input v-model="flowForm.remark" type="textarea" :rows="2" />
          </el-form-item>
        </template>

        <template v-else-if="flowKind === 'reject'">
          <el-form-item
            label="驳回原因"
            :rules="[{ required: true, min: 2, message: '请填写驳回原因' }]"
          >
            <el-input v-model="flowForm.reason" type="textarea" :rows="3" />
          </el-form-item>
        </template>

        <template v-else-if="flowKind === 'rectify'">
          <el-form-item
            label="整改措施"
            :rules="[{ required: true, min: 2, message: '请填写整改措施' }]"
          >
            <el-input
              v-model="flowForm.rectifyMeasure"
              type="textarea"
              :rows="4"
            />
          </el-form-item>
        </template>

        <template v-else-if="flowKind === 'review'">
          <el-form-item label="复查结果">
            <el-radio-group v-model="flowForm.passed">
              <el-radio :value="true">通过</el-radio>
              <el-radio :value="false">退回整改</el-radio>
            </el-radio-group>
          </el-form-item>
          <el-form-item
            label="复查意见"
            :rules="[{ required: true, min: 2, message: '请填写复查意见' }]"
          >
            <el-input v-model="flowForm.opinion" type="textarea" :rows="3" />
          </el-form-item>
        </template>

        <template v-else-if="flowKind === 'archive'">
          <el-form-item label="归档意见">
            <el-input v-model="flowForm.opinion" type="textarea" :rows="3" />
          </el-form-item>
        </template>
      </el-form>
      <template #footer>
        <el-button @click="flowVisible = false">取消</el-button>
        <el-button type="primary" :loading="flowSubmitting" @click="submitFlow">
          确定
        </el-button>
      </template>
    </el-dialog>
  </div>
</template>

<style scoped>
.text-danger {
  color: var(--el-color-danger);
}
.muted {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.flow-actions {
  margin: 16px 0 8px;
}
.timeline-title {
  display: flex;
  gap: 8px;
  align-items: center;
}
.timeline-remark {
  margin-top: 4px;
  padding: 6px 10px;
  background: var(--el-fill-color-light);
  border-radius: 4px;
  font-size: 13px;
}
</style>
