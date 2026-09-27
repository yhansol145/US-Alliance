import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { mkdtempSync, rmSync } from 'fs';
import os from 'os';
import path from 'path';
import {
  APP_CONFIG,
  AppConfig,
  DEFAULT_APP_CONFIG,
  Job,
  SchedulerConfig,
} from '@app/core';
import { JobStatus } from '@app/utils';

import { AppModule } from '../src/app.module';
import { JobProcessor } from '../src/modules/scheduler/processor/job.processor';
import { configureApp } from '../src/setup';

export interface TestWorkspace {
  dir: string;
  config: AppConfig;
  cleanup: () => void;
}

/**
 * 테스트마다 격리된 임시 디렉토리에 jobs.json / logs.txt 를 둔다.
 * 스케줄러 주기 실행은 끄고, 테스트에서 handleTick / execute 를 직접 호출한다.
 */
export const createWorkspace = (
  scheduler: Partial<SchedulerConfig> = {},
): TestWorkspace => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'job-server-test-'));
  return {
    dir,
    config: {
      ...DEFAULT_APP_CONFIG,
      dbPath: path.join(dir, 'jobs.json'),
      logPath: path.join(dir, 'logs.txt'),
      logToConsole: false,
      scheduler: {
        ...DEFAULT_APP_CONFIG.scheduler,
        enabled: false,
        processDelayMs: 0,
        ...scheduler,
      },
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

/** 호출 순서대로 결과를 제어할 수 있는 테스트용 processor */
export class ControllableProcessor extends JobProcessor {
  handler: (job: Job) => Promise<void> = async () => undefined;
  readonly calls: string[] = [];

  async process(job: Job): Promise<void> {
    this.calls.push(job.id);
    return this.handler(job);
  }
}

export const createTestApp = async (
  config: AppConfig,
  processor: JobProcessor = new ControllableProcessor(),
) => {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(APP_CONFIG)
    .useValue(config)
    .overrideProvider(JobProcessor)
    .useValue(processor)
    .compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    logger: false,
  });
  configureApp(app);
  // 임시 포트로 미리 listen 해 두어야 supertest 가 요청마다 서버를 다시 열지 않는다
  await app.listen(0);
  return app;
};

let seq = 0;
export const makeJob = (overrides: Partial<Job> = {}): Job => {
  seq += 1;
  const createdAt = new Date(Date.UTC(2026, 0, 1, 0, 0, seq)).toISOString();
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, '0')}`,
    title: `job ${seq}`,
    description: '',
    status: JobStatus.PENDING,
    attempts: 0,
    lastError: null,
    version: 1,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
};

/** 외부에서 resolve 할 수 있는 Promise (처리 중인 상태를 붙잡아 두는 용도) */
export const deferred = () => {
  let resolve: () => void;
  let reject: (e: Error) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};
