export enum JobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELED = 'canceled',
}

export const JOB_STATUSES = Object.values(JobStatus);

/**
 * 사용자가 PATCH 로 직접 지정할 수 있는 상태
 * - processing / completed / failed 는 스케줄러만 전이시킨다
 */
export const USER_SETTABLE_JOB_STATUSES = [
  JobStatus.PENDING,
  JobStatus.CANCELED,
] as const;
