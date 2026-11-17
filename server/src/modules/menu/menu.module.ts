import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Menu } from './entities/menu.entity.js';
import { MenuController } from './menu.controller.js';
import { MenuService } from './menu.service.js';

/**
 * 菜单模块（通用管理域）：菜单/按钮与前端动态路由。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Menu])],
  controllers: [MenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
