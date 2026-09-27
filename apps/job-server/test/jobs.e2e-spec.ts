import { INestApplication } from '@nestjs/common';
import { readFileSync, writeFileSync } from 'fs';
import request from 'supertest';
import { FileLogService, Job } from '@app/core';
import { JobStatus } from '@app/utils';

import { JobProcessCronService } from '../src/modules/scheduler/cron/job-process-cron.service';
import {
  ControllableProcessor,
  createTestApp,
  createWorkspace,
  deferred,
  makeJob,
  TestWorkspace,
} from './test-utils';

describe('Jobs API (e2e)', () => {
  let ws: TestWorkspace;
  let app: INestApplication;
  let processor: ControllableProcessor;
  let http: ReturnType<typeof request>;

  const boot = async (jobs: Job[] = []) => {
    ws = createWorkspace();
    writeFileSync(ws.config.dbPath, JSON.stringify({ jobs }));
    processor = new ControllableProcessor();
    app = await createTestApp(ws.config, processor);
    http = request(app.getHttpServer());
  };

  const createJob = async (title = 'task', description?: string) =>
    (await http.post('/jobs').send({ title, description }).expect(201)).body
      .data as Job;

  const readLogs = async () => {
    await app.get(FileLogService).flush();
    return readFileSync(ws.config.logPath, 'utf-8');
  };

  const expectErrorShape = (body: any, statusCode: number, error: string) => {
    expect(body).toEqual(
      expect.objectContaining({
        statusCode,
        error,
        message: expect.any(String),
        path: expect.any(String),
        timestamp: expect.any(String),
        requestId: expect.any(String),
      }),
    );
    expect(body.stack).toBeUndefined();
  };

  afterEach(async () => {
    await app?.close();
    ws?.cleanup();
  });

  describe('POST /jobs', () => {
    beforeEach(() => boot());

    it('201 과 함께 생성된 job, Location, ETag 를 반환한다', async () => {
      const res = await http
        .post('/jobs')
        .send({ title: '  Task 1  ', description: 'Do something' })
        .expect(201);

      const job = res.body.data;
      expect(job).toMatchObject({
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
        title: 'Task 1',
        description: 'Do something',
        status: JobStatus.PENDING,
        attempts: 0,
        version: 1,
      });
      expect(res.headers.location).toBe(`/jobs/${job.id}`);
      expect(res.headers.etag).toBe('"1"');

      const saved = JSON.parse(readFileSync(ws.config.dbPath, 'utf-8'));
      expect(saved.jobs).toHaveLength(1);
    });

    it('description 은 생략 가능하다', async () => {
      const job = await createJob('only title');
      expect(job.description).toBe('');
    });

    it.each([
      ['title 누락', {}, 'title'],
      ['빈 title', { title: '   ' }, 'title'],
      ['title 타입 오류', { title: 123 }, 'title'],
      ['title 길이 초과', { title: 'a'.repeat(201) }, 'title'],
      ['정의되지 않은 필드', { title: 'a', status: 'completed' }, 'status'],
    ])('%s → 400 VALIDATION_FAILED', async (_, body, field) => {
      const res = await http.post('/jobs').send(body).expect(400);
      expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
      expect(res.body.details.map((d) => d.field)).toContain(field);
    });

    it('JSON 형식이 아니면 400', async () => {
      const res = await http
        .post('/jobs')
        .set('Content-Type', 'application/json')
        .send('{bad json')
        .expect(400);
      expectErrorShape(res.body, 400, 'BAD_REQUEST');
    });

    it('동시에 50건을 생성해도 모두 저장된다', async () => {
      await Promise.all(
        Array.from({ length: 50 }, (_, i) =>
          http
            .post('/jobs')
            .send({ title: `concurrent ${i}` })
            .expect(201),
        ),
      );

      const res = await http.get('/jobs?limit=100').expect(200);
      expect(res.body.meta.total).toBe(50);
      const saved = JSON.parse(readFileSync(ws.config.dbPath, 'utf-8'));
      expect(new Set(saved.jobs.map((j) => j.id)).size).toBe(50);
    });
  });

  describe('GET /jobs', () => {
    const jobs = Array.from({ length: 5 }, () => makeJob());
    beforeEach(() => boot(jobs));

    it('최신순으로 페이지네이션하여 반환한다', async () => {
      const res = await http.get('/jobs?page=2&limit=2').expect(200);
      expect(res.body.meta).toEqual({
        total: 5,
        page: 2,
        limit: 2,
        totalPages: 3,
      });
      expect(res.body.data.map((j) => j.id)).toEqual([jobs[2].id, jobs[1].id]);
    });

    it('order=asc 로 오래된 순 정렬', async () => {
      const res = await http.get('/jobs?order=asc&limit=1').expect(200);
      expect(res.body.data[0].id).toBe(jobs[0].id);
    });

    it('기본값은 page=1, limit=20', async () => {
      const res = await http.get('/jobs').expect(200);
      expect(res.body.meta).toMatchObject({ page: 1, limit: 20 });
      expect(res.body.data).toHaveLength(5);
    });

    it.each(['page=0', 'limit=0', 'limit=101', 'page=abc', 'order=up'])(
      '잘못된 쿼리 %s → 400',
      async (query) => {
        const res = await http.get(`/jobs?${query}`).expect(400);
        expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
      },
    );
  });

  describe('GET /jobs/search', () => {
    const jobs = [
      makeJob({ title: 'Daily Report', status: JobStatus.PENDING }),
      makeJob({ title: 'weekly report', status: JobStatus.COMPLETED }),
      makeJob({ title: 'Send email', status: JobStatus.FAILED }),
      makeJob({ title: 'Monthly REPORT', status: JobStatus.FAILED }),
    ];
    beforeEach(() => boot(jobs));

    const titles = (res) => res.body.data.map((j) => j.title).sort();

    it('title 은 대소문자 무시 부분 일치', async () => {
      const res = await http.get('/jobs/search?title=report').expect(200);
      expect(titles(res)).toEqual([
        'Daily Report',
        'Monthly REPORT',
        'weekly report',
      ]);
    });

    it('status 는 쉼표로 복수 지정 (OR)', async () => {
      const res = await http
        .get('/jobs/search?status=completed,failed')
        .expect(200);
      expect(res.body.meta.total).toBe(3);
    });

    it('status 반복 파라미터도 지원', async () => {
      const res = await http
        .get('/jobs/search?status=pending&status=completed')
        .expect(200);
      expect(res.body.meta.total).toBe(2);
    });

    it('title 과 status 는 AND', async () => {
      const res = await http
        .get('/jobs/search?title=report&status=failed')
        .expect(200);
      expect(titles(res)).toEqual(['Monthly REPORT']);
    });

    it('결과가 없으면 빈 배열', async () => {
      const res = await http.get('/jobs/search?title=nothing').expect(200);
      expect(res.body).toMatchObject({ data: [], meta: { total: 0 } });
    });

    it('검색 조건이 없으면 400', async () => {
      const res = await http.get('/jobs/search').expect(400);
      expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
    });

    it('존재하지 않는 status 는 400', async () => {
      const res = await http.get('/jobs/search?status=done').expect(400);
      expect(res.body.details[0].field).toBe('status');
    });
  });

  describe('GET /jobs/:id', () => {
    beforeEach(() => boot());

    it('200 과 ETag 를 반환한다', async () => {
      const job = await createJob();
      const res = await http.get(`/jobs/${job.id}`).expect(200);
      expect(res.body.data).toEqual(job);
      expect(res.headers.etag).toBe('"1"');
    });

    it('UUID 형식이 아니면 400', async () => {
      const res = await http.get('/jobs/not-a-uuid').expect(400);
      expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
    });

    it('없으면 404 JOB_NOT_FOUND', async () => {
      const res = await http
        .get('/jobs/00000000-0000-4000-8000-000000000000')
        .expect(404);
      expectErrorShape(res.body, 404, 'JOB_NOT_FOUND');
    });
  });

  describe('PATCH /jobs/:id', () => {
    beforeEach(() => boot());

    it('pending 상태에서 title/description 을 수정하고 version 을 올린다', async () => {
      const job = await createJob();
      const res = await http
        .patch(`/jobs/${job.id}`)
        .send({ title: 'renamed', description: 'new desc' })
        .expect(200);

      expect(res.body.data).toMatchObject({
        title: 'renamed',
        description: 'new desc',
        version: 2,
      });
      expect(res.headers.etag).toBe('"2"');
      expect(res.body.data.updatedAt > job.updatedAt).toBe(true);
    });

    it('변경이 없는 요청은 version 을 올리지 않는다 (멱등)', async () => {
      const job = await createJob('same');
      const res = await http
        .patch(`/jobs/${job.id}`)
        .send({ title: 'same' })
        .expect(200);
      expect(res.body.data.version).toBe(1);
    });

    it('pending → canceled', async () => {
      const job = await createJob();
      const res = await http
        .patch(`/jobs/${job.id}`)
        .send({ status: 'canceled' })
        .expect(200);
      expect(res.body.data.status).toBe(JobStatus.CANCELED);
      expect(res.body.data.finishedAt).not.toBeNull();
    });

    it('failed → pending (재시도) 시 시도 이력을 초기화한다', async () => {
      await app.close();
      ws.cleanup();
      const failed = makeJob({
        status: JobStatus.FAILED,
        attempts: 3,
        lastError: 'boom',
        finishedAt: new Date().toISOString(),
      });
      await boot([failed]);

      const res = await http
        .patch(`/jobs/${failed.id}`)
        .send({ status: 'pending' })
        .expect(200);
      expect(res.body.data).toMatchObject({
        status: JobStatus.PENDING,
        attempts: 0,
        lastError: null,
        finishedAt: null,
      });
    });

    it.each(['processing', 'completed', 'failed'])(
      'status=%s 는 사용자가 지정할 수 없다 (400)',
      async (status) => {
        const job = await createJob();
        const res = await http
          .patch(`/jobs/${job.id}`)
          .send({ status })
          .expect(400);
        expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
      },
    );

    it('canceled → pending 은 허용되지 않는다 (409)', async () => {
      const job = await createJob();
      await http
        .patch(`/jobs/${job.id}`)
        .send({ status: 'canceled' })
        .expect(200);

      const res = await http
        .patch(`/jobs/${job.id}`)
        .send({ status: 'pending' })
        .expect(409);
      expectErrorShape(res.body, 409, 'INVALID_STATUS_TRANSITION');
      expect(res.body.details).toEqual({
        from: 'canceled',
        to: 'pending',
        allowed: [],
      });
    });

    it('completed 상태는 내용을 수정할 수 없다 (409)', async () => {
      const job = await createJob();
      await app.get(JobProcessCronService).handleTick();

      const res = await http
        .patch(`/jobs/${job.id}`)
        .send({ title: 'x' })
        .expect(409);
      expectErrorShape(res.body, 409, 'JOB_NOT_EDITABLE');
    });

    it.each([
      ['빈 body', {}],
      ['수정 불가 필드', { attempts: 10 }],
      ['id 변경 시도', { id: 'other' }],
      ['빈 title', { title: '' }],
      ['title null', { title: null }],
      ['description null', { description: null }],
      ['status null', { status: null }],
    ])('%s → 400', async (_, body) => {
      const job = await createJob();
      const res = await http.patch(`/jobs/${job.id}`).send(body).expect(400);
      expectErrorShape(res.body, 400, 'VALIDATION_FAILED');
    });

    it('없는 id 는 404', async () => {
      await http
        .patch('/jobs/00000000-0000-4000-8000-000000000000')
        .send({ title: 'x' })
        .expect(404);
    });

    describe('If-Match (낙관적 잠금)', () => {
      it('버전이 일치하면 수정된다', async () => {
        const job = await createJob();
        await http
          .patch(`/jobs/${job.id}`)
          .set('If-Match', '"1"')
          .send({ title: 'ok' })
          .expect(200);
      });

      it('버전이 다르면 412 와 현재 버전을 알려준다', async () => {
        const job = await createJob();
        await http.patch(`/jobs/${job.id}`).send({ title: 'v2' }).expect(200);

        const res = await http
          .patch(`/jobs/${job.id}`)
          .set('If-Match', '"1"')
          .send({ title: 'stale' })
          .expect(412);
        expectErrorShape(res.body, 412, 'PRECONDITION_FAILED');
        expect(res.body.details).toEqual({
          expectedVersion: 1,
          currentVersion: 2,
        });

        const current = await http.get(`/jobs/${job.id}`);
        expect(current.body.data.title).toBe('v2');
      });

      it('같은 버전으로 동시에 수정하면 정확히 하나만 성공한다', async () => {
        const job = await createJob();
        const results = await Promise.all(
          Array.from({ length: 10 }, (_, i) =>
            http
              .patch(`/jobs/${job.id}`)
              .set('If-Match', '"1"')
              .send({ title: `t${i}` }),
          ),
        );
        const codes = results.map((r) => r.status).sort();
        expect(codes.filter((c) => c === 200)).toHaveLength(1);
        expect(codes.filter((c) => c === 412)).toHaveLength(9);
      });

      it('스케줄러가 먼저 상태를 바꾸면 이전 버전 기반 수정은 412', async () => {
        const job = await createJob();
        await app.get(JobProcessCronService).handleTick();

        await http
          .patch(`/jobs/${job.id}`)
          .set('If-Match', '"1"')
          .send({ status: 'canceled' })
          .expect(412);
      });

      it('형식이 잘못되면 400', async () => {
        const job = await createJob();
        await http
          .patch(`/jobs/${job.id}`)
          .set('If-Match', 'abc')
          .send({ title: 'x' })
          .expect(400);
      });
    });
  });

  describe('API 와 스케줄러 동시 접근', () => {
    beforeEach(() => boot());

    it('처리 중(processing)인 job 은 취소/수정할 수 없고, 처리 중 들어온 다른 요청은 유실되지 않는다', async () => {
      const job = await createJob('long running');
      const gate = deferred();
      processor.handler = () => gate.promise;

      const tick = app.get(JobProcessCronService).handleTick();
      await new Promise((r) => setTimeout(r, 30));

      const current = await http.get(`/jobs/${job.id}`).expect(200);
      expect(current.body.data.status).toBe(JobStatus.PROCESSING);

      const cancel = await http
        .patch(`/jobs/${job.id}`)
        .send({ status: 'canceled' })
        .expect(409);
      expect(cancel.body.error).toBe('INVALID_STATUS_TRANSITION');
      await http.patch(`/jobs/${job.id}`).send({ title: 'x' }).expect(409);

      const created = await Promise.all(
        Array.from({ length: 10 }, (_, i) => createJob(`during ${i}`)),
      );

      gate.resolve();
      expect(await tick).toMatchObject({ completed: 1 });

      const all = (await http.get('/jobs?limit=100')).body.data as Job[];
      expect(all).toHaveLength(11);
      expect(all.find((j) => j.id === job.id).status).toBe(JobStatus.COMPLETED);
      expect(all.filter((j) => j.status === JobStatus.PENDING)).toHaveLength(
        10,
      );
      expect(created.every((c) => all.some((j) => j.id === c.id))).toBe(true);
    });

    it('API 쓰기와 스케줄러 tick 을 섞어 대량으로 실행해도 파일이 일관된 상태를 유지한다', async () => {
      const seeded = await Promise.all(
        Array.from({ length: 20 }, (_, i) => createJob(`seed ${i}`)),
      );
      const cron = app.get(JobProcessCronService);

      await Promise.all([
        cron.handleTick(),
        ...seeded
          .slice(0, 10)
          .map((j) =>
            http.patch(`/jobs/${j.id}`).send({ description: 'edited' }),
          ),
        ...Array.from({ length: 20 }, (_, i) =>
          http.post('/jobs').send({ title: `new ${i}` }),
        ),
        cron.handleTick(),
      ]);

      const saved = JSON.parse(readFileSync(ws.config.dbPath, 'utf-8'))
        .jobs as Job[];
      expect(saved).toHaveLength(40);
      expect(new Set(saved.map((j) => j.id)).size).toBe(40);
      // 메모리와 디스크가 일치해야 한다
      const listed = (await http.get('/jobs?limit=100')).body.data;
      expect(listed.map((j) => j.id).sort()).toEqual(
        saved.map((j) => j.id).sort(),
      );
    });
  });

  describe('공통', () => {
    beforeEach(() => boot());

    it('정의되지 않은 라우트는 404 공통 포맷', async () => {
      const res = await http
        .delete('/jobs/00000000-0000-4000-8000-000000000000')
        .expect(404);
      expectErrorShape(res.body, 404, 'NOT_FOUND');
    });

    it('요청마다 X-Request-Id 를 발급하고, 전달된 값은 그대로 사용한다', async () => {
      const res = await http
        .get('/jobs')
        .set('X-Request-Id', 'my-req-1')
        .expect(200);
      expect(res.headers['x-request-id']).toBe('my-req-1');
    });

    it('성공/실패/라우팅 실패/파싱 실패 요청을 모두 logs.txt 에 기록한다', async () => {
      const job = await createJob();
      await http.get(`/jobs/${job.id}`);
      await http.get('/jobs/search?status=nope');
      await http.get('/unknown');
      await http
        .post('/jobs')
        .set('Content-Type', 'application/json')
        .send('{bad');

      const logs = await readLogs();
      expect(logs).toMatch(/\[INFO\] \[HTTP\] POST \/jobs 201 /);
      expect(logs).toMatch(
        new RegExp(`\\[INFO\\] \\[HTTP\\] GET /jobs/${job.id} 200 `),
      );
      expect(logs).toMatch(
        /\[WARN\] \[HTTP\] GET \/jobs\/search\?status=nope 400 /,
      );
      expect(logs).toMatch(/\[WARN\] \[HTTP\] GET \/unknown 404 /);
      expect(logs).toMatch(/\[WARN\] \[HTTP\] POST \/jobs 400 /);
    });
  });
});
