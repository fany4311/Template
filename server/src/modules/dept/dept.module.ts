import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DataScopeService } from './data-scope.service.js';
import { DeptController } from './dept.controller.js';
import { DeptService } from './dept.service.js';
import { Dept } from './entities/dept.entity.js';

/**
 * 部门模块（通用管理域）：组织树 + 数据范围（dataScope）解析。
 * 导出 DeptService / DataScopeService，供其他模块做数据范围过滤。
 */
@Module({
  imports: [TypeOrmModule.forFeature([Dept])],
  controllers: [DeptController],
  providers: [DeptService, DataScopeService],
  exports: [DeptService, DataScopeService],
})
export class DeptModule {}
