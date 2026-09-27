import { JobStatus } from '@app/utils';

export interface Job {
  id: string;
  title: string;
  description: string;
  status: JobStatus;
  /** 스케줄러가 처리를 시도한 횟수 */
  attempts: number;
  /** 마지막 실패 사유 (성공/재시도 요청 시 null 로 초기화) */
  lastError: string | null;
  /** 낙관적 잠금용 버전. 변경될 때마다 1씩 증가하며 ETag 로 노출된다 */
  version: number;
  createdAt: string;
  updatedAt: string;
  /** 마지막으로 processing 으로 전이된 시각 */
  startedAt: string | null;
  /** completed / failed / canceled 로 종료된 시각 */
  finishedAt: string | null;
}

export interface JobCollection {
  jobs: Job[];
}
