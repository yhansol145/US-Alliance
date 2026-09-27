import { JobStatus } from '@app/utils';

import { canUserTransition, isEditable } from './job-transition';

describe('job-transition', () => {
  it.each([
    [JobStatus.PENDING, JobStatus.CANCELED, true],
    [JobStatus.FAILED, JobStatus.PENDING, true],
    [JobStatus.FAILED, JobStatus.CANCELED, true],
    [JobStatus.PENDING, JobStatus.PROCESSING, false],
    [JobStatus.PENDING, JobStatus.COMPLETED, false],
    [JobStatus.PROCESSING, JobStatus.CANCELED, false],
    [JobStatus.PROCESSING, JobStatus.PENDING, false],
    [JobStatus.COMPLETED, JobStatus.PENDING, false],
    [JobStatus.CANCELED, JobStatus.PENDING, false],
  ])('%s → %s 사용자 전이 허용: %s', (from, to, expected) => {
    expect(canUserTransition(from, to)).toBe(expected);
  });

  it.each([
    [JobStatus.PENDING, true],
    [JobStatus.FAILED, true],
    [JobStatus.PROCESSING, false],
    [JobStatus.COMPLETED, false],
    [JobStatus.CANCELED, false],
  ])('%s 상태 내용 수정 가능: %s', (status, expected) => {
    expect(isEditable(status)).toBe(expected);
  });
});
