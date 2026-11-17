import { Injectable } from '@nestjs/common';
import { PinoLogger } from 'nestjs-pino';
import type { HazardEventPayload } from '../hazard.events.js';
import type {
  ProvinceSyncPort,
  ProvinceSyncResult,
} from '../ports/province-sync.port.js';

/**
 * 省平台适配器（Mock 实现）。
 *
 * 真实省平台是「湖南省校园数字化安全管理和应急平台」，接口文档尚未提供。
 * 本实现在**不改变任何业务代码**的前提下让闭环可跑通、可测试：
 * - 打印一条结构化日志（可被日志系统采集，模拟出网请求）
 * - 返回一个模拟回执（含 traceNo / receivedAt），用于落库与前端展示
 *
 * 换成真接口时要做的事：
 * 1. 新增 HttpProvinceAdapter implements ProvinceSyncPort（签名/重试/超时在这里做）
 * 2. hazard.module.ts 里把 PROVINCE_SYNC_PORT 的 useClass 换成新实现
 * 3. 其余不动（HazardService / Outbox 处理器 / biz_hazard_sync 表结构均不变）
 */
@Injectable()
export class MockProvinceAdapter implements ProvinceSyncPort {
  readonly target = 'mock:province-platform';

  constructor(private readonly logger: PinoLogger) {
    this.logger.setContext(MockProvinceAdapter.name);
  }

  async push(payload: HazardEventPayload): Promise<ProvinceSyncResult> {
    // 真实实现这里应是一次 HTTP 调用；Mock 只记录等价信息
    const traceNo = `MOCK-${Date.now()}-${payload.hazardNo}`;
    this.logger.info(
      {
        target: this.target,
        traceNo,
        hazardNo: payload.hazardNo,
        action: payload.action,
        toStatus: payload.toStatus,
      },
      '[Mock] 推送隐患流转至省平台',
    );

    return {
      success: true,
      response: {
        code: '0000',
        msg: '模拟受理成功',
        traceNo,
        receivedAt: new Date().toISOString(),
        // 标记来源，避免后续误判为真实对接数据
        mocked: true,
      },
    };
  }
}
