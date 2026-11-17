import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DictController } from './dict.controller.js';
import { DictService } from './dict.service.js';
import { DictData } from './entities/dict-data.entity.js';
import { DictType } from './entities/dict-type.entity.js';

/**
 * 字典模块（通用管理域）：字典类型 + 字典数据，供前端下拉与标签渲染。
 */
@Module({
  imports: [TypeOrmModule.forFeature([DictType, DictData])],
  controllers: [DictController],
  providers: [DictService],
  exports: [DictService],
})
export class DictModule {}
