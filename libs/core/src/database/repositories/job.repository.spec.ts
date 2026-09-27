import { Test } from '@nestjs/testing';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'fs';
import os from 'os';
import path from 'path';
import { JobStatus } from '@app/utils';

import { DEFAULT_APP_CONFIG } from '../../config/app.config';
import { CoreConfigModule } from '../../config/config.module';
import { CoreModule } from '../../core.module';
import { AtomicFileAdapter } from '../atomic-file.adapter';
import { Job } from '../../models/entities';
import { IJobRepository } from '../../models/repositories';

const makeJob = (i: number, overrides: Partial<Job> = {}): Job => ({
  id: `job-${i}`,
  title: `job ${i}`,
  description: '',
  status: JobStatus.PENDING,
  attempts: 0,
  lastError: null,
  version: 1,
  createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  updatedAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  startedAt: null,
  finishedAt: null,
  ...overrides,
});

describe('JobRepository (node-json-db + 쓰기 큐)', () => {
  let dir: string;
  let dbPath: string;

  const createRepo = async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        CoreConfigModule.forRoot({
          ...DEFAULT_APP_CONFIG,
          dbPath,
          logPath: path.join(dir, 'logs.txt'),
          logToConsole: false,
        }),
        CoreModule.forRoot(),
      ],
    }).compile();
    await moduleRef.init();
    return {
      moduleRef,
      repo: moduleRef.get<IJobRepository>(CoreModule.JOB_REPO),
    };
  };

  const readFile = () =>
    JSON.parse(readFileSync(dbPath, 'utf-8')) as { jobs: Job[] };

  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'job-repo-test-'));
    dbPath = path.join(dir, 'jobs.json');
  });

  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('파일이 없으면 { jobs: [] } 로 초기화한다', async () => {
    const { moduleRef, repo } = await createRepo();
    expect(await repo.findAll()).toEqual([]);
    expect(readFile()).toEqual({ jobs: [] });
    await moduleRef.close();
  });

  it('기존 파일의 데이터를 그대로 읽는다', async () => {
    writeFileSync(dbPath, JSON.stringify({ jobs: [makeJob(1)] }));
    const { moduleRef, repo } = await createRepo();
    expect(await repo.findById('job-1')).toMatchObject({ title: 'job 1' });
    await moduleRef.close();
  });

  it('JSON 이 깨진 파일은 덮어쓰지 않고 부팅을 실패시킨다', async () => {
    writeFileSync(dbPath, '{"jobs": [');
    await expect(createRepo()).rejects.toThrow();
    expect(readFileSync(dbPath, 'utf-8')).toBe('{"jobs": [');
  });

  it('동시에 200건을 생성해도 한 건도 유실되지 않는다', async () => {
    const { moduleRef, repo } = await createRepo();

    await Promise.all(
      Array.from({ length: 200 }, (_, i) => repo.create(makeJob(i))),
    );

    expect(await repo.findAll()).toHaveLength(200);
    // 디스크에도 온전한 JSON 으로 200건이 저장되어 있어야 한다
    expect(readFile().jobs).toHaveLength(200);
    await moduleRef.close();
  });

  it('같은 job 에 대한 동시 read-modify-write 가 lost update 없이 직렬화된다', async () => {
    const { moduleRef, repo } = await createRepo();
    await repo.create(makeJob(1));

    await Promise.all(
      Array.from({ length: 100 }, () =>
        repo.updateById('job-1', (job) => ({
          ...job,
          attempts: job.attempts + 1,
          version: job.version + 1,
        })),
      ),
    );

    const job = await repo.findById('job-1');
    expect(job.attempts).toBe(100);
    expect(job.version).toBe(101);
    expect(readFile().jobs[0].attempts).toBe(100);
    await moduleRef.close();
  });

  it('mutator 가 예외를 던지면 아무것도 저장하지 않는다', async () => {
    const { moduleRef, repo } = await createRepo();
    await repo.create(makeJob(1));

    await expect(
      repo.transaction((jobs) => {
        jobs[0].title = 'changed';
        throw new Error('abort');
      }),
    ).rejects.toThrow('abort');

    expect((await repo.findById('job-1')).title).toBe('job 1');
    expect(readFile().jobs[0].title).toBe('job 1');
    await moduleRef.close();
  });

  it('같은 배치에서 한 트랜잭션이 실패해도 나머지는 저장된다', async () => {
    const { moduleRef, repo } = await createRepo();

    const results = await Promise.allSettled([
      repo.create(makeJob(1)),
      repo.transaction(() => {
        throw new Error('boom');
      }),
      repo.create(makeJob(2)),
    ]);

    expect(results.map((r) => r.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
    ]);
    expect(readFile().jobs.map((j) => j.id)).toEqual(['job-1', 'job-2']);
    await moduleRef.close();
  });

  it('동시 쓰기는 group commit 으로 묶여 디스크 쓰기 횟수가 요청 수보다 적다', async () => {
    const { moduleRef, repo } = await createRepo();
    const writeSpy = jest.spyOn(AtomicFileAdapter.prototype, 'writeAsync');

    await Promise.all(
      Array.from({ length: 50 }, (_, i) => repo.create(makeJob(i))),
    );

    expect(readFile().jobs).toHaveLength(50);
    expect(writeSpy.mock.calls.length).toBeLessThan(50);
    writeSpy.mockRestore();
    await moduleRef.close();
  });

  it('변경이 없는 트랜잭션은 디스크에 쓰지 않는다', async () => {
    const { moduleRef, repo } = await createRepo();
    const writeSpy = jest.spyOn(AtomicFileAdapter.prototype, 'writeAsync');

    await repo.transaction((jobs) => jobs.length);

    expect(writeSpy).not.toHaveBeenCalled();
    writeSpy.mockRestore();
    await moduleRef.close();
  });

  it('조회 결과는 복사본이라 수정해도 DB 에 반영되지 않는다', async () => {
    const { moduleRef, repo } = await createRepo();
    await repo.create(makeJob(1));

    const job = await repo.findById('job-1');
    job.title = 'mutated';

    expect((await repo.findById('job-1')).title).toBe('job 1');
    await moduleRef.close();
  });

  it('없는 id 를 수정하면 null 을 반환한다', async () => {
    const { moduleRef, repo } = await createRepo();
    expect(await repo.updateById('nope', (job) => job)).toBeNull();
    await moduleRef.close();
  });

  it('원자적 쓰기 후 임시 파일이 남지 않는다', async () => {
    const { moduleRef, repo } = await createRepo();
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => repo.create(makeJob(i))),
    );
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    await moduleRef.close();
  });

  it('재시작(새 인스턴스) 후에도 데이터가 유지된다', async () => {
    const first = await createRepo();
    await first.repo.create(makeJob(1));
    await first.moduleRef.close();

    const second = await createRepo();
    expect(await second.repo.findById('job-1')).not.toBeNull();
    await second.moduleRef.close();
  });
});
