import { Inject, Injectable } from '@nestjs/common';
import {
  APP_CONFIG,
  AppConfig,
  CoreModule,
  FileLogService,
  IJobRepository,
  Job,
} from '@app/core';
import { JobStatus } from '@app/utils';

import { JobProcessor } from '../processor/job.processor';

export interface BatchResult {
  claimed: number;
  completed: number;
  retried: number;
  failed: number;
  /** commit 시점에 이미 processing 이 아니어서 결과를 반영하지 않은 건수 */
  skipped: number;
  durationMs: number;
}

interface Outcome {
  ok: boolean;
  reason?: string;
}

@Injectable()
export class JobProcessBatchUseCase {
  private static readonly CONTEXT = 'Scheduler';

  constructor(
    @Inject(CoreModule.JOB_REPO)
    private readonly jobRepo: IJobRepository,
    private readonly processor: JobProcessor,
    private readonly logger: FileLogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /**
   * 한 번의 배치 처리
   *
   * 1) claim   [트랜잭션] pending 중 오래된 순으로 batchSize 건을 processing 으로 선점
   * 2) process [트랜잭션 밖] 실제 처리. 오래 걸려도 API 요청이 막히지 않는다
   * 3) commit  [트랜잭션] 결과 반영. 여전히 processing 인 건만 반영한다
   *
   * claim 을 원자적으로 수행하므로 같은 job 이 두 번 처리되지 않고,
   * processing 상태는 사용자가 PATCH 로 바꿀 수 없어 처리 도중 내용이 바뀌지 않는다.
   */
  async execute(): Promise<BatchResult> {
    const startedAt = Date.now();
    const { batchSize } = this.config.scheduler;

    const claimed = await this.jobRepo.transaction((jobs) => {
      const now = new Date().toISOString();
      const targets = jobs
        .filter((job) => job.status === JobStatus.PENDING)
        .sort(
          (a, b) =>
            a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
        )
        .slice(0, batchSize);

      for (const job of targets) {
        job.status = JobStatus.PROCESSING;
        job.attempts += 1;
        job.startedAt = now;
        job.updatedAt = now;
        job.version += 1;
      }
      return targets;
    });

    if (claimed.length === 0) {
      const result = this.emptyResult(startedAt);
      this.logger.log(
        '처리할 pending job 없음',
        JobProcessBatchUseCase.CONTEXT,
      );
      return result;
    }

    this.logger.log(
      `배치 시작 claimed=${claimed.length} ids=${claimed.map((j) => j.id).join(',')}`,
      JobProcessBatchUseCase.CONTEXT,
    );

    const outcomes = new Map<string, Outcome>();
    await Promise.all(
      claimed.map(async (job) => {
        outcomes.set(job.id, await this.runWithTimeout(job));
      }),
    );

    const result = await this.jobRepo.transaction((jobs) => {
      const now = new Date().toISOString();
      const summary = this.emptyResult(startedAt);
      summary.claimed = claimed.length;

      for (const { id } of claimed) {
        const job = jobs.find((j) => j.id === id);
        if (!job || job.status !== JobStatus.PROCESSING) {
          summary.skipped += 1;
          continue;
        }

        const outcome = outcomes.get(id);
        if (outcome.ok) {
          this.markCompleted(job, now);
          summary.completed += 1;
        } else if (this.markFailedOrRetry(job, outcome.reason, now)) {
          summary.retried += 1;
        } else {
          summary.failed += 1;
        }
      }
      return summary;
    });

    for (const { id } of claimed) {
      const outcome = outcomes.get(id);
      if (outcome.ok) {
        this.logger.log(
          `job 처리 성공 id=${id}`,
          JobProcessBatchUseCase.CONTEXT,
        );
      } else {
        this.logger.warn(
          `job 처리 실패 id=${id} reason="${outcome.reason}"`,
          JobProcessBatchUseCase.CONTEXT,
        );
      }
    }

    result.durationMs = Date.now() - startedAt;
    this.logger.log(
      `배치 완료 claimed=${result.claimed} completed=${result.completed} retried=${result.retried} failed=${result.failed} skipped=${result.skipped} durationMs=${result.durationMs}`,
      JobProcessBatchUseCase.CONTEXT,
    );
    return result;
  }

  /**
   * 서버가 처리 도중 종료되어 processing 에 남은 job 을 복구한다 (부팅 시 1회).
   * 이미 시도 횟수에 포함되었으므로 일반 실패와 같은 규칙(재시도 / failed)을 적용한다.
   */
  async recoverInterrupted(): Promise<number> {
    const recovered = await this.jobRepo.transaction((jobs) => {
      const now = new Date().toISOString();
      const stale = jobs.filter((job) => job.status === JobStatus.PROCESSING);
      for (const job of stale) {
        this.markFailedOrRetry(
          job,
          '서버 재시작으로 처리가 중단되었습니다.',
          now,
        );
      }
      return stale.map((job) => `${job.id}→${job.status}`);
    });

    if (recovered.length > 0) {
      this.logger.warn(
        `중단된 processing job 복구 count=${recovered.length} [${recovered.join(', ')}]`,
        JobProcessBatchUseCase.CONTEXT,
      );
    }
    return recovered.length;
  }

  private async runWithTimeout(job: Job): Promise<Outcome> {
    const { processTimeoutMs } = this.config.scheduler;
    let timer: NodeJS.Timeout;
    try {
      await Promise.race([
        this.processor.process(job),
        new Promise((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`처리 시간 초과 (${processTimeoutMs}ms)`)),
            processTimeoutMs,
          );
        }),
      ]);
      return { ok: true };
    } catch (e) {
      return { ok: false, reason: e instanceof Error ? e.message : String(e) };
    } finally {
      clearTimeout(timer);
    }
  }

  private markCompleted(job: Job, now: string) {
    job.status = JobStatus.COMPLETED;
    job.lastError = null;
    job.finishedAt = now;
    job.updatedAt = now;
    job.version += 1;
  }

  /** @returns 재시도 대상(pending)으로 돌렸으면 true, 최종 실패(failed)면 false */
  private markFailedOrRetry(job: Job, reason: string, now: string): boolean {
    const retry = job.attempts < this.config.scheduler.maxAttempts;
    job.status = retry ? JobStatus.PENDING : JobStatus.FAILED;
    job.lastError = reason;
    job.finishedAt = retry ? null : now;
    job.updatedAt = now;
    job.version += 1;
    return retry;
  }

  private emptyResult(startedAt: number): BatchResult {
    return {
      claimed: 0,
      completed: 0,
      retried: 0,
      failed: 0,
      skipped: 0,
      durationMs: Date.now() - startedAt,
    };
  }
}
