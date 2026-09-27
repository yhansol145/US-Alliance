import { JobStatus } from '@app/utils';

/**
 * 사용자(PATCH) 가 수행할 수 있는 상태 전이
 *
 *   pending ──▶ canceled          (처리 전 취소)
 *   failed  ──▶ pending           (재시도: attempts 초기화)
 *   failed  ──▶ canceled          (실패 건 종료)
 *
 * processing / completed / canceled 에서 나가는 전이는 사용자에게 허용하지 않는다.
 * (processing 은 스케줄러가 소유한 상태이고, completed / canceled 는 종료 상태)
 */
export const USER_TRANSITIONS: Readonly<
  Record<JobStatus, readonly JobStatus[]>
> = {
  [JobStatus.PENDING]: [JobStatus.CANCELED],
  [JobStatus.PROCESSING]: [],
  [JobStatus.COMPLETED]: [],
  [JobStatus.FAILED]: [JobStatus.PENDING, JobStatus.CANCELED],
  [JobStatus.CANCELED]: [],
};

/** title / description 수정이 가능한 상태 (아직 처리되지 않았거나 재시도 대기 중) */
export const EDITABLE_STATUSES: readonly JobStatus[] = [
  JobStatus.PENDING,
  JobStatus.FAILED,
];

export const canUserTransition = (from: JobStatus, to: JobStatus) =>
  USER_TRANSITIONS[from].includes(to);

export const isEditable = (status: JobStatus) =>
  EDITABLE_STATUSES.includes(status);
