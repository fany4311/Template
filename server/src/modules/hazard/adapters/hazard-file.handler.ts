import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  FileBizRegistry,
  type FileBizContext,
  type FileBizHandler,
} from '../../file/file-biz.registry.js';
import { HazardService } from '../hazard.service.js';

/** 隐患附件用途（业务自定，底座只透传） */
export const HAZARD_FILE_FIELDS = [
  'reportPhoto',
  'rectifyPhoto',
  'reviewPhoto',
  'archiveFile',
] as const;

/**
 * 隐患附件接入 —— 「业务模块如何把附件权限交回自己」的示范。
 *
 * 文件模块本身不认识 `hazard`；这里注册后它才知道：
 * - 谁能看这张单的附件 → 复用 `HazardService.canAccess`（与列表同一套数据范围）
 * - 允许哪些附件用途
 *
 * 新增业务模块时照这个文件抄：换 bizType、换 canAccess 实现即可。
 */
@Injectable()
export class HazardFileHandler implements FileBizHandler, OnModuleInit {
  constructor(
    private readonly registry: FileBizRegistry,
    private readonly hazardService: HazardService,
  ) {}

  /** 与隐患列表同一套数据范围判定（附件权限跟业务对象权限必须同源） */
  canAccess(ctx: FileBizContext, bizId: string): Promise<boolean> {
    return this.hazardService.canAccess(ctx, Number(bizId));
  }

  readonly fields = HAZARD_FILE_FIELDS;

  onModuleInit(): void {
    this.registry.register('hazard', this);
  }
}
