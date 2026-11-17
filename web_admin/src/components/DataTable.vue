<script lang="ts">
/**
 * 列定义：表格与表单共用「标签 + 字段」的直觉，但两边职责不同，别合并成一个类型。
 * - prop：直接取值渲染
 * - slot：需要自定义渲染（标签、时间格式化、状态点…）时给插槽名
 */
export interface TableColumn {
  prop?: string;
  label: string;
  width?: number | string;
  minWidth?: number | string;
  align?: 'left' | 'center' | 'right';
  showOverflowTooltip?: boolean;
  /** 自定义渲染用的插槽名；页面里用 <template #名字="{ row }"> */
  slot?: string;
}
</script>

<script setup lang="ts" generic="T">
import { computed } from 'vue';

/**
 * 列表表格：列配置 + 分页 + 空态 + loading。
 *
 * 刻意**不做**：
 * - 不做列显示/隐藏、拖拽排序（需求没到，加了就是负担）；
 * - 不内置操作列 —— 操作按钮的权限判断与业务分支差异最大，
 *   由页面通过默认插槽自己写（见 ConfigView 的「内置不可删」分支）。
 */
const props = withDefaults(
  defineProps<{
    columns: TableColumn[];
    rows: T[];
    total: number;
    loading?: boolean;
    rowKey?: string;
    emptyText?: string;
    pageSizes?: number[];
    /** 树表等不分页场景关掉分页条 */
    pagination?: boolean;
    /** 树表默认全展开 */
    defaultExpandAll?: boolean;
  }>(),
  {
    loading: false,
    rowKey: 'id',
    emptyText: '暂无数据',
    pageSizes: () => [10, 20, 50, 100],
    pagination: true,
    defaultExpandAll: false,
  },
);

// 树表等不分页场景不传，给个默认值即可（分页条本身由 pagination 控制显隐）
const page = defineModel<number>('page', { default: 1 });
const pageSize = defineModel<number>('pageSize', { default: 10 });

const emit = defineEmits<{ change: [] }>();

/**
 * EP 的 el-table 只接受 Record 形态的行数据，而这里的 T 是调用方的业务类型
 * （可能是 interface，没有索引签名）。只在这一处做一次断言，
 * 不让泛型在组件内部扩散成 any。
 */
const tableRows = computed(
  () => props.rows as unknown as Record<string, unknown>[],
);

function onPage(value: number): void {
  if (value === page.value) return;
  page.value = value;
  emit('change');
}

/** 改每页条数必须回第 1 页，否则当前页码可能越界 */
function onSize(value: number): void {
  // EP 改每页条数时可能同时抛 current-page，去重一次避免重复请求
  if (value === pageSize.value) return;
  pageSize.value = value;
  page.value = 1;
  emit('change');
}
</script>

<template>
  <div>
    <el-table
      v-loading="loading"
      :data="tableRows"
      :row-key="rowKey"
      :empty-text="emptyText"
      :default-expand-all="defaultExpandAll"
      border
      stripe
    >
      <el-table-column
        v-for="col in columns"
        :key="col.slot ?? col.prop ?? col.label"
        :prop="col.prop"
        :label="col.label"
        :width="col.width"
        :min-width="col.minWidth"
        :align="col.align ?? 'left'"
        :show-overflow-tooltip="col.showOverflowTooltip ?? false"
      >
        <template v-if="col.slot" #default="scope">
          <slot :name="col.slot" :row="scope.row as T" :index="scope.$index" />
        </template>
      </el-table-column>

      <!-- 操作列等扩展列由页面传入 -->
      <slot />
    </el-table>

    <div v-if="pagination" class="pagination">
      <el-pagination
        :current-page="page"
        :page-size="pageSize"
        :total="total"
        :page-sizes="pageSizes"
        layout="total, sizes, prev, pager, next"
        @update:current-page="onPage"
        @update:page-size="onSize"
      />
    </div>
  </div>
</template>
