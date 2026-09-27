import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { APP_CONFIG, AppConfig, FileLogService } from '@app/core';

import {
  BatchResult,
  JobProcessBatchUseCase,
} from '../usecase/job-process-batch.usecase';

@Injectable()
export class JobProcessCronService
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  static readonly INTERVAL_NAME = 'job-process';
  private static readonly CONTEXT = 'Scheduler';

  private running: Promise<BatchResult> | null = null;

  constructor(
    private readonly schedulerRegistry: SchedulerRegistry,
    private readonly jobProcessBatchUseCase: JobProcessBatchUseCase,
    private readonly logger: FileLogService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  async onApplicationBootstrap() {
    await this.jobProcessBatchUseCase.recoverInterrupted();

    const { enabled, intervalMs, batchSize } = this.config.scheduler;
    if (!enabled) {
      return;
    }

    // 주기를 설정값으로 주입받기 위해 @Interval 데코레이터 대신 동적으로 등록한다
    const handle = setInterval(() => void this.handleTick(), intervalMs);
    this.schedulerRegistry.addInterval(
      JobProcessCronService.INTERVAL_NAME,
      handle,
    );
    this.logger.log(
      `스케줄러 등록 intervalMs=${intervalMs} batchSize=${batchSize}`,
      JobProcessCronService.CONTEXT,
    );
  }

  /**
   * 주기 실행 진입점
   *
   * 이전 tick 이 아직 끝나지 않았으면 이번 tick 은 건너뛴다.
   * (claim 이 원자적이라 겹쳐도 중복 처리는 없지만, 처리 지연 시 배치가 누적되는 것을 막는다)
   */
  async handleTick(): Promise<BatchResult | null> {
    if (this.running) {
      this.logger.warn(
        '이전 배치가 아직 진행 중이라 이번 주기를 건너뜀',
        JobProcessCronService.CONTEXT,
      );
      return null;
    }

    this.running = this.jobProcessBatchUseCase.execute();
    try {
      return await this.running;
    } catch (e) {
      this.logger.error(
        `배치 처리 중 예외 발생: ${e.message}`,
        JobProcessCronService.CONTEXT,
        e.stack,
      );
      return null;
    } finally {
      this.running = null;
    }
  }

  /**
   * 종료 시 진행 중인 배치가 끝날 때까지 기다린다.
   * 그렇지 않으면 claim 된 job 이 processing 상태로 남는다 (부팅 시 복구되긴 한다).
   */
  async onApplicationShutdown() {
    if (this.running) {
      this.logger.log(
        '종료 대기: 진행 중인 배치 완료를 기다림',
        JobProcessCronService.CONTEXT,
      );
      await this.running.catch(() => undefined);
    }
  }
}
