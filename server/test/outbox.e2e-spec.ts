import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { setTimeout as sleep } from 'node:timers/promises';
import { DataSource } from 'typeorm';
import { AppModule } from './../src/app.module.js';
import { setupApp } from './../src/setup-app.js';
import { OutboxEvent } from './../src/modules/outbox/entities/outbox-event.entity.js';
import { OutboxService } from './../src/modules/outbox/outbox.service.js';

/**
 * Outbox（集成）：需 MySQL。验证 append → 轮询投递 → 标记 sent。
 */
describe('Outbox (e2e)', () => {
  let app: INestApplication;
  let ds: DataSource;
  let outbox: OutboxService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    setupApp(app);
    await app.init();
    ds = app.get(DataSource);
    outbox = app.get(OutboxService);
  });

  afterAll(async () => {
    await ds
      .getRepository(OutboxEvent)
      .createQueryBuilder()
      .delete()
      .where('event_type LIKE :p', { p: 'test.%' })
      .execute();
    await app.close();
  });

  it('append → 轮询投递 → 标记 sent', async () => {
    const received: Record<string, any>[] = [];
    outbox.registerHandler('test.outbox', {
      handle: async (payload) => {
        received.push(payload);
      },
    });

    await outbox.append({
      eventType: 'test.outbox',
      aggregateType: 'test',
      payload: { hello: 'world' },
    });

    // 等待轮询器（1s 间隔）投递
    for (let i = 0; i < 20 && received.length === 0; i++) {
      await sleep(300);
    }

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual({ hello: 'world' });

    const row = await ds
      .getRepository(OutboxEvent)
      .findOneByOrFail({ eventType: 'test.outbox' });
    expect(row.status).toBe('sent');
    expect(row.sentAt).toBeTruthy();
  });
});
