import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ApiOkZod } from '../../common/swagger/api-ok.js';
import { Auditable } from '../../common/decorators/auditable.decorator.js';
import { Idempotent } from '../../common/decorators/idempotent.decorator.js';
import { RequiresPermissions } from '../../common/decorators/requires-permissions.decorator.js';
import { User } from '../../common/decorators/user.decorator.js';
import type { JwtUser } from '../auth/auth.interface.js';
import {
  createMenuSchema,
  queryMenuSchema,
  updateMenuSchema,
  type CreateMenuInput,
  type QueryMenuInput,
  type UpdateMenuInput,
} from './dto/menu.dto.js';
import { menuResponseSchema } from './dto/menu.response.js';
import { MenuService } from './menu.service.js';

const idParamSchema = z.coerce.number().int().positive();

/**
 * 菜单管理（通用管理域）。
 * 权限码约定：system:menu:list / add / edit / remove。
 */
@ApiTags('菜单管理')
@ApiBearerAuth()
@Controller('menu')
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('tree')
  @RequiresPermissions('system:menu:list')
  @ApiOperation({ summary: '全量菜单树（管理页）' })
  @ApiOkZod(
    'SysMenuTree',
    z.array(menuResponseSchema),
    '返回菜单树（含按钮与隐藏项）',
  )
  tree(@Query({ schema: queryMenuSchema }) query: QueryMenuInput) {
    return this.menuService.tree(query);
  }

  @Get('routes')
  @ApiOperation({ summary: '当前用户可见菜单树（前端动态菜单）' })
  @ApiOkZod(
    'SysMenuTree',
    z.array(menuResponseSchema),
    '返回当前用户可见的菜单树',
  )
  routes(@User() user: JwtUser) {
    return this.menuService.routes(user);
  }

  /**
   * 全部可导航页面（前端注册路由用，**不按权限过滤**）。
   *
   * 不挂 `@RequiresPermissions`：任何通过后台准入的登录用户都要能拿到 ——
   * 缺了它，没权限的地址就只能报「404 页面不存在」，用户无法区分
   * 「这页真不存在」和「你没权限」。详见 `MenuService.pages()`。
   */
  @Get('pages')
  @ApiOperation({ summary: '全部可导航页面（注册路由用，不按权限过滤）' })
  @ApiOkZod(
    'SysMenuPages',
    z.array(menuResponseSchema),
    '返回全部 C 型菜单（含当前用户无权限的）',
  )
  pages() {
    return this.menuService.pages();
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:menu:add')
  @Auditable({ action: 'system:menu:add', resourceType: 'menu' })
  @Idempotent({ scope: 'system:menu:add' })
  @ApiOperation({ summary: '创建菜单' })
  @ApiOkZod('SysMenu', menuResponseSchema, '返回创建后的菜单')
  create(@Body({ schema: createMenuSchema }) dto: CreateMenuInput) {
    return this.menuService.create(dto);
  }

  @Put(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:menu:edit')
  @Auditable({
    action: 'system:menu:edit',
    resourceType: 'menu',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'system:menu:edit' })
  @ApiOperation({ summary: '更新菜单' })
  @ApiOkZod('SysMenu', menuResponseSchema, '返回更新后的菜单')
  update(
    @Param('id', { schema: idParamSchema }) id: number,
    @Body({ schema: updateMenuSchema }) dto: UpdateMenuInput,
  ) {
    return this.menuService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @RequiresPermissions('system:menu:remove')
  @Auditable({
    action: 'system:menu:remove',
    resourceType: 'menu',
    resourceIdParam: 'id',
  })
  @Idempotent({ scope: 'system:menu:remove' })
  @ApiOperation({ summary: '删除菜单（软删除，有下级则拒绝）' })
  @ApiOkZod('BoolResult', z.boolean(), '返回 true 表示删除成功')
  remove(@Param('id', { schema: idParamSchema }) id: number) {
    return this.menuService.remove(id);
  }
}
