import path from 'path';

export interface SchedulerConfig {
  /** false 면 주기 실행을 등록하지 않는다 (테스트에서 수동 실행용) */
  enabled: boolean;
  /** 처리 주기 */
  intervalMs: number;
  /** 한 번의 tick 에서 선점(claim)할 최대 Job 수 */
  batchSize: number;
  /** 최대 시도 횟수. 초과 시 failed 로 전이 */
  maxAttempts: number;
  /** Job 1건 처리에 걸리는 시뮬레이션 시간 */
  processDelayMs: number;
  /** Job 1건 처리 제한 시간. 초과 시 실패로 간주 (멈춘 작업이 배치 전체를 막지 않도록) */
  processTimeoutMs: number;
}

export interface AppConfig {
  port: number;
  dbPath: string;
  logPath: string;
  /** logs.txt 외에 콘솔에도 출력할지 여부 */
  logToConsole: boolean;
  scheduler: SchedulerConfig;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

/**
 * 별도 배포 환경(.env / ecosystem 등) 없이 `npm start` 만으로 동작하도록
 * 설정값을 코드 상수로 둔다. 테스트에서는 APP_CONFIG 프로바이더를 override 한다.
 */
export const DEFAULT_APP_CONFIG: AppConfig = {
  port: 3000,
  dbPath: path.resolve(process.cwd(), 'jobs.json'),
  logPath: path.resolve(process.cwd(), 'logs.txt'),
  logToConsole: true,
  scheduler: {
    enabled: true,
    intervalMs: 60_000,
    batchSize: 10,
    maxAttempts: 3,
    processDelayMs: 500,
    processTimeoutMs: 30_000,
  },
};
