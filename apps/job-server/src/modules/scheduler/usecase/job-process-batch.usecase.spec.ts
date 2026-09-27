import { INestApplication } from '@nestjs/common';
import { writeFileSync } from 'fs';
import { CoreModule, IJobRepository, Job } from '@app/core';
import { JobStatus } from '@app/utils';

import {
  ControllableProcessor,
  createTestApp,
  createWorkspace,
  deferred,
  makeJob,
  TestWorkspace,
} from '../../../../test/test-utils';
import { JobProcessBatchUseCase } from './job-process-batch.usecase';

describe('JobProcessBatchUseCase', () => {
  let ws: TestWorkspace;
  let app: INestApplication;
  let processor: ControllableProcessor;
  let usecase: JobProcessBatchUseCase;
  let repo: IJobRepository;

  const boot = async (
    jobs: Job[],
    scheduler: Parameters<typeof createWorkspace>[0] = {},
  ) => {
    ws = createWorkspace({ batchSize: 3, maxAttempts: 2, ...scheduler });
    writeFileSync(ws.config.dbPath, JSON.stringify({ jobs }));
    processor = new ControllableProcessor();
    app = await createTestApp(ws.config, processor);
    usecase = app.get(JobProcessBatchUseCase);
    repo = app.get(CoreModule.JOB_REPO);
  };

  const statusOf = async (id: string) => (await repo.findById(id)).status;

  afterEach(async () => {
    await app?.close();
    ws?.cleanup();
  });

  it('pending 을 오래된 순으로 batchSize 만큼만 처리한다', async () => {
    const jobs = [4, 1, 3, 2, 5].map((sec) =>
      makeJob({
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, sec)).toISOString(),
      }),
    );
    await boot(jobs);
    const byAge = [...jobs].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );

    const result = await usecase.execute();

    expect(result).toMatchObject({ claimed: 3, completed: 3, failed: 0 });
    expect(processor.calls).toEqual(byAge.slice(0, 3).map((j) => j.id));
    for (const job of byAge.slice(0, 3)) {
      expect(await repo.findById(job.id)).toMatchObject({
        status: JobStatus.COMPLETED,
        attempts: 1,
        version: 3, // claim +1, commit +1
      });
    }
    for (const job of byAge.slice(3)) {
      expect(await statusOf(job.id)).toBe(JobStatus.PENDING);
    }
  });

  it('pending 이 아닌 job 은 처리하지 않는다', async () => {
    const jobs = [
      makeJob({ status: JobStatus.COMPLETED }),
      makeJob({ status: JobStatus.CANCELED }),
      makeJob({ status: JobStatus.FAILED }),
    ];
    await boot(jobs);

    expect(await usecase.execute()).toMatchObject({ claimed: 0 });
    expect(processor.calls).toEqual([]);
  });

  it('실패하면 재시도 대기(pending)로 돌리고, maxAttempts 도달 시 failed 로 전이한다', async () => {
    const job = makeJob();
    await boot([job]);
    processor.handler = async () => {
      throw new Error('외부 API 오류');
    };

    expect(await usecase.execute()).toMatchObject({ retried: 1, failed: 0 });
    expect(await repo.findById(job.id)).toMatchObject({
      status: JobStatus.PENDING,
      attempts: 1,
      lastError: '외부 API 오류',
      finishedAt: null,
    });

    expect(await usecase.execute()).toMatchObject({ retried: 0, failed: 1 });
    const failed = await repo.findById(job.id);
    expect(failed).toMatchObject({ status: JobStatus.FAILED, attempts: 2 });
    expect(failed.finishedAt).not.toBeNull();

    // failed 는 더 이상 스케줄러 대상이 아니다
    expect(await usecase.execute()).toMatchObject({ claimed: 0 });
  });

  it('재시도에서 성공하면 lastError 를 비우고 completed 로 전이한다', async () => {
    const job = makeJob();
    await boot([job]);
    let calls = 0;
    processor.handler = async () => {
      if (++calls === 1) throw new Error('일시 오류');
    };

    await usecase.execute();
    await usecase.execute();

    expect(await repo.findById(job.id)).toMatchObject({
      status: JobStatus.COMPLETED,
      attempts: 2,
      lastError: null,
    });
  });

  it('처리 시간이 제한을 넘으면 실패로 처리한다', async () => {
    const job = makeJob();
    await boot([job], { processTimeoutMs: 50, maxAttempts: 1 });
    processor.handler = () => new Promise(() => undefined); // 영원히 끝나지 않음

    expect(await usecase.execute()).toMatchObject({ failed: 1 });
    expect((await repo.findById(job.id)).lastError).toContain('시간 초과');
  });

  it('한 job 의 실패가 같은 배치의 다른 job 에 영향을 주지 않는다', async () => {
    const [ok, bad] = [makeJob(), makeJob()];
    await boot([ok, bad], { maxAttempts: 1 });
    processor.handler = async (job) => {
      if (job.id === bad.id) throw new Error('fail');
    };

    expect(await usecase.execute()).toMatchObject({ completed: 1, failed: 1 });
    expect(await statusOf(ok.id)).toBe(JobStatus.COMPLETED);
    expect(await statusOf(bad.id)).toBe(JobStatus.FAILED);
  });

  it('처리 중(processing)에는 상태가 저장되어 있고, 그 사이 들어온 쓰기가 유실되지 않는다', async () => {
    const target = makeJob();
    const other = makeJob();
    await boot([target, other], { batchSize: 1 });
    const gate = deferred();
    processor.handler = () => gate.promise;

    const running = usecase.execute();
    await new Promise((r) => setTimeout(r, 20));

    // 처리 도중 상태: processing 으로 선점되어 있다
    expect(await statusOf(target.id)).toBe(JobStatus.PROCESSING);

    // 처리 도중 다른 job 수정 + 신규 생성 (API 요청과 경합하는 상황)
    await repo.updateById(other.id, (j) => ({
      ...j,
      title: 'edited',
      version: j.version + 1,
    }));
    await repo.create(makeJob({ title: 'created during processing' }));

    gate.resolve();
    await running;

    const jobs = await repo.findAll();
    expect(jobs).toHaveLength(3);
    expect(jobs.find((j) => j.id === target.id).status).toBe(
      JobStatus.COMPLETED,
    );
    expect(jobs.find((j) => j.id === other.id).title).toBe('edited');
    expect(jobs.some((j) => j.title === 'created during processing')).toBe(
      true,
    );
  });

  it('동시에 두 번 실행되어도 같은 job 을 중복 처리하지 않는다', async () => {
    const jobs = Array.from({ length: 4 }, () => makeJob());
    await boot(jobs, { batchSize: 10 });

    const [a, b] = await Promise.all([usecase.execute(), usecase.execute()]);

    expect(a.claimed + b.claimed).toBe(4);
    expect(new Set(processor.calls).size).toBe(processor.calls.length);
    expect(processor.calls).toHaveLength(4);
  });

  it('commit 시점에 processing 이 아니게 된 job 은 결과를 덮어쓰지 않는다', async () => {
    const job = makeJob();
    await boot([job]);
    const gate = deferred();
    processor.handler = () => gate.promise;

    const running = usecase.execute();
    await new Promise((r) => setTimeout(r, 20));
    // 외부 요인으로 상태가 바뀐 상황을 가정
    await repo.updateById(job.id, (j) => ({
      ...j,
      status: JobStatus.CANCELED,
    }));
    gate.resolve();

    expect(await running).toMatchObject({ skipped: 1, completed: 0 });
    expect(await statusOf(job.id)).toBe(JobStatus.CANCELED);
  });

  it('부팅 시 processing 에 남은 job 을 복구한다', async () => {
    const retryable = makeJob({ status: JobStatus.PROCESSING, attempts: 1 });
    const exhausted = makeJob({ status: JobStatus.PROCESSING, attempts: 2 });
    // createTestApp 의 onApplicationBootstrap 에서 복구가 실행된다
    await boot([retryable, exhausted], { maxAttempts: 2 });

    expect(await repo.findById(retryable.id)).toMatchObject({
      status: JobStatus.PENDING,
      lastError: expect.stringContaining('재시작'),
    });
    expect(await statusOf(exhausted.id)).toBe(JobStatus.FAILED);
  });
});
