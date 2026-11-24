import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiOkZod, pageOf } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { CheckPolicies } from '../../common/decorators/check-policies.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import { User } from '../../common/decorators/user.decorator.js';
import type { JwtUser } from '../auth/auth.interface.js';
import {
  acceptHazardSchema,
  archiveHazardSchema,
  createHazardSchema,
  queryHazardSchema,
  rectifyHazardSchema,
  rejectHazardSchema,
  reviewHazardSchema,
  type AcceptHazardInput,
  type ArchiveHazardInput,
  type CreateHazardInput,
  type QueryHazardInput,
  type RectifyHazardInput,
  type RejectHazardInput,
  type ReviewHazardInput,
} from './dto/hazard.dto.js';
import {
  hazardDetailResponseSchema,
  hazardResponseSchema,
} from './dto/hazard.response.js';
import { HazardService } from './hazard.service.js';
import { HAZARD_PERMISSIONS, HAZARD_TRANSITIONS } from './hazard.state.js';

const idParamSchema = z.coerce.number().int().positive();

/**
 * 隐患闭环（业务模块，不是底座）。
 *
 * 权限是**两层**的，这是本项目 RBAC 与 CASL 分工的样板：
 * - `@RequiresPermissions`（RBAC 权限码）：能不能进这个接口 —— 粗粒度、按角色配
 * - `@CheckPolicies`（CASL 动作）：能不能对 Hazard 做这个动作 —— 资源级、按规则配
 *
 * 两者都通过后，服务层再用**状态机**校验当前单据状态下该动作是否合法，
 * 并用**数据范围 + 协办部门**校验可见性。三者缺一不可：
 *   能调接口 ≠ 能对这张单做 ≠ 这张单现在能做。
 *
 * 注意权限码取自 `HAZARD_TRANSITIONS[*].permission`，与状态机同源，
 * 避免出现"接口权限码改了但状态机没改"的漂移。
 */
@ApiTags('隐患闭环')
@ApiBearerAuth()
@Controller('hazard')
export class HazardController {
  constructor(private readonly hazardService: HazardService) {}

  @Get()
  @RequiresPermissions(HAZARD_PERMISSIONS.LIST)
  @CheckPolicies((ability) => ability.can('read', 'Hazard'))
  @ApiOperation({
    summary: '分页查询隐患（按角色数据范围 + 协办部门过滤）',
  })
  @ApiOkZod(
    'HazardPage',
    pageOf(hazardResponseSchema),
    '隐患分页结果 { list, total }',
  )
  page(
    @Query({ schema: queryHazardSchema }) query: QueryHazardInput,
    @User() user: JwtUser,
  ) {
    return this.hazardService.page(query, user);
  }

  @Get(':id')
  @RequiresPermissions(HAZARD_PERMISSIONS.QUERY)
  @CheckPolicies((ability) => ability.can('read', 'Hazard'))
  @ApiOperation({ summary: '隐患详情（含流转轨迹与省平台同步记录）' })
  @ApiOkZod('HazardDetail', hazardDetailResponseSchema, '隐患详情')
  detail(
    @Param('id', { schema: idParamSchema }) id: number,
    @User() user: JwtUser,
  ) {
    return this.hazardService.detail(id, user);
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions(HAZARD_PERMISSIONS.ADD)
  @CheckPolicies((ability) => ability.can('create', 'Hazard'))
  @Auditable({ action: HAZARD_PERMISSIONS.ADD, resourceType: 'hazard' })
  @Idempotent({ scope: 'hazard:report:add' })
  @ApiOperation({ summary: '上报隐患' })
  @ApiOkZod('Hazard', hazardResponseSchema, '返回上报后的隐患单')
  report(
    @Body({ schema: createHazardSchema }) dto: CreateHazardInput,
    @User() user: JwtUser,
  ) {
    return this.hazardService.report(dto, user);
  }

  @Post(':id/accept')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions(HAZARD_TRANSITIONS.ACCEPT.permission)
  @CheckPolicies((ability) => ability.can('accept', 'Hazard'))
  @Auditable({
    action: HAZARD_TRANSITIONS.ACCEPT.permission,
    resourceType: 'hazard',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'hazard:report:accept' })
  @ApiOperation({ summary: '受理隐患（确定主责/协办部门、处理人、整改期限）' })
  @ApiOkZod('Hazard', hazardResponseSchema, '返回受理后的隐患单')
  accept(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: acceptHazardSchema }) dto: AcceptHazardInput,
    @User() user: JwtUser,
  ) {
    return this.hazardService.accept(id, dto, user);
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions(HAZARD_TRANSITIONS.REJECT.permission)
  @CheckPolicies((ability) => ability.can('reject', 'Hazard'))
  @Auditable({
    action: HAZARD_TRANSITIONS.REJECT.permission,
    resourceType: 'hazard',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'hazard:report:reject' })
  @ApiOperation({ summary: '驳回隐患（单据终止）' })
  @ApiOkZod('Hazard', hazardResponseSchema, '返回驳回后的隐患单')
  reject(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: rejectHazardSchema }) dto: RejectHazardInput,
    @User() user: JwtUser,
  ) {
    return this.hazardService.reject(id, dto, user);
  }

  @Post(':id/rectify')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions(HAZARD_TRANSITIONS.RECTIFY.permission)
  @CheckPolicies((ability) => ability.can('rectify', 'Hazard'))
  @Auditable({
    action: HAZARD_TRANSITIONS.RECTIFY.permission,
    resourceType: 'hazard',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'hazard:report:rectify' })
  @ApiOperation({ summary: '提交整改措施（进入待复查）' })
  @ApiOkZod('Hazard', hazardResponseSchema, '返回整改后的隐患单')
  rectify(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: rectifyHazardSchema }) dto: RectifyHazardInput,
    @User() user: JwtUser,
  ) {
    return this.hazardService.rectify(id, dto, user);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions(HAZARD_TRANSITIONS.REVIEW_PASS.permission)
  @CheckPolicies((ability) => ability.can('review', 'Hazard'))
  @Auditable({
    action: HAZARD_TRANSITIONS.REVIEW_PASS.permission,
    resourceType: 'hazard',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'hazard:report:review' })
  @ApiOperation({
    summary: '复查隐患（passed=true 通过 → 待归档；false 退回整改）',
  })
  @ApiOkZod('Hazard', hazardResponseSchema, '返回复查后的隐患单')
  review(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: reviewHazardSchema }) dto: ReviewHazardInput,
    @User() user: JwtUser,
  ) {
    return this.hazardService.review(id, dto, user);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions(HAZARD_TRANSITIONS.ARCHIVE.permission)
  @CheckPolicies((ability) => ability.can('archive', 'Hazard'))
  @Auditable({
    action: HAZARD_TRANSITIONS.ARCHIVE.permission,
    resourceType: 'hazard',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'hazard:report:archive' })
  @ApiOperation({ summary: '归档隐患（终态；审计员执行，只归档不改内容）' })
  @ApiOkZod('Hazard', hazardResponseSchema, '返回归档后的隐患单')
  archive(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: archiveHazardSchema }) dto: ArchiveHazardInput,
    @User() user: JwtUser,
  ) {
    return this.hazardService.archive(id, dto, user);
  }

  @Delete(':id')
  @RequiresPermissions(HAZARD_PERMISSIONS.REMOVE)
  @CheckPolicies((ability) => ability.can('delete', 'Hazard'))
  @Auditable({
    action: HAZARD_PERMISSIONS.REMOVE,
    resourceType: 'hazard',
    resourceIdParam: 'id',
  })
  @ApiOperation({ summary: '删除隐患（软删除；仅已归档/已驳回可删）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示成功')
  remove(
    @Param('id', { schema: idParamSchema }) id: number,
    @User() user: JwtUser,
  ) {
    return this.hazardService.remove(id, user);
  }
}
