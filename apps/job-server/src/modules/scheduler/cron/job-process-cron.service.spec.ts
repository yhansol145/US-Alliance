import { INestApplication } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { readFileSync, writeFileSync } from 'fs';
import { FileLogService } from '@app/core';

import {
  ControllableProcessor,
  createTestApp,
  createWorkspace,
  deferred,
  makeJob,
  TestWorkspace,
} from '../../../../test/test-utils';
import { JobProcessBatchUseCase } from '../usecase/job-process-batch.usecase';
import { JobProcessCronService } from './job-process-cron.service';

describe('JobProcessCronService', () => {
  let ws: TestWorkspace;
  let app: INestApplication;
  let processor: ControllableProcessor;
  let cron: JobProcessCronService;

  const boot = async (enabled = false, intervalMs = 60_000) => {
    ws = createWorkspace({ enabled, intervalMs });
    writeFileSync(ws.config.dbPath, JSON.stringify({ jobs: [makeJob()] }));
    processor = new ControllableProcessor();
    app = await createTestApp(ws.config, processor);
    cron = app.get(JobProcessCronService);
  };

  const readLogs = async () => {
    await app.get(FileLogService).flush();
    return readFileSync(ws.config.logPath, 'utf-8');
  };

  afterEach(async () => {
    await app?.close();
    ws?.cleanup();
  });

  it('enabled 면 interval 을 등록하고, 아니면 등록하지 않는다', async () => {
    await boot(true);
    expect(app.get(SchedulerRegistry).getIntervals()).toContain(
      JobProcessCronService.INTERVAL_NAME,
    );
    await app.close();
    ws.cleanup();

    await boot(false);
    expect(app.get(SchedulerRegistry).getIntervals()).toEqual([]);
  });

  it('설정한 주기마다 자동으로 배치를 실행한다', async () => {
    await boot(true, 50);
    await new Promise((r) => setTimeout(r, 300));
    expect(processor.calls).toHaveLength(1);
    expect(await readLogs()).toContain('배치 완료 claimed=1 completed=1');
  });

  it('이전 배치가 끝나지 않았으면 이번 tick 을 건너뛴다', async () => {
    await boot();
    const gate = deferred();
    processor.handler = () => gate.promise;

    const first = cron.handleTick();
    await new Promise((r) => setTimeout(r, 20));
    const second = await cron.handleTick();

    expect(second).toBeNull();
    gate.resolve();
    expect(await first).toMatchObject({ claimed: 1, completed: 1 });
    expect(await readLogs()).toContain('이번 주기를 건너뜀');
  });

  it('배치에서 예외가 나도 스케줄러가 죽지 않고 로그를 남긴다', async () => {
    await boot();
    jest
      .spyOn(app.get(JobProcessBatchUseCase), 'execute')
      .mockRejectedValueOnce(new Error('disk full'));

    expect(await cron.handleTick()).toBeNull();
    expect(await readLogs()).toContain('배치 처리 중 예외 발생: disk full');

    // 다음 tick 은 정상 동작
    expect(await cron.handleTick()).toMatchObject({ completed: 1 });
  });

  it('처리 결과를 logs.txt 에 기록한다', async () => {
    await boot();
    await cron.handleTick();
    const logs = await readLogs();
    expect(logs).toMatch(/\[INFO\] \[Scheduler\] 배치 시작 claimed=1/);
    expect(logs).toMatch(/\[INFO\] \[Scheduler\] job 처리 성공 id=/);
    expect(logs).toMatch(
      /\[INFO\] \[Scheduler\] 배치 완료 claimed=1 completed=1/,
    );
  });
});
