import { Inject, Injectable } from '@nestjs/common';
import { setTimeout as sleep } from 'timers/promises';
import { APP_CONFIG, AppConfig, Job } from '@app/core';

/**
 * Job 1건의 실제 처리 로직
 *
 * 과제에 "처리" 의 구체적 내용이 정의되어 있지 않아 추상 클래스로 분리했다.
 * resolve 하면 성공(completed), reject 하면 실패(재시도 또는 failed) 로 간주한다.
 * 테스트에서는 이 토큰을 override 해 성공/실패/지연을 제어한다.
 */
export abstract class JobProcessor {
  abstract process(job: Job): Promise<void>;
}

/**
 * 기본 구현: 일정 시간이 걸리는 작업을 시뮬레이션하고 성공 처리한다.
 */
@Injectable()
export class SimulatedJobProcessor extends JobProcessor {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {
    super();
  }

  async process(): Promise<void> {
    await sleep(this.config.scheduler.processDelayMs);
  }
}
