import { Inject, Injectable } from '@nestjs/common';
import {
  AppException,
  CoreModule,
  FileLogService,
  IJobRepository,
  Job,
} from '@app/core';
import { ErrorCode, JobStatus } from '@app/utils';

import { UpdateJobDto } from '../dto';
import {
  canUserTransition,
  EDITABLE_STATUSES,
  isEditable,
  USER_TRANSITIONS,
} from '../utils/job-transition';

@Injectable()
export class JobUpdateUseCase {
  constructor(
    @Inject(CoreModule.JOB_REPO)
    private readonly jobRepo: IJobRepository,
    private readonly logger: FileLogService,
  ) {}

  /**
   * @param expectedVersion If-Match 로 전달된 버전. 지정 시 현재 버전과 다르면 412.
   *
   * 검증과 변경을 모두 repository 트랜잭션 안(mutator)에서 수행한다.
   * 트랜잭션 밖에서 "조회 → 검증" 후 쓰면, 그 사이 스케줄러가 상태를 바꿨을 때
   * 이미 무효가 된 검증 결과로 덮어쓰게 되기 때문이다.
   */
  async execute(
    id: string,
    dto: UpdateJobDto,
    expectedVersion?: number,
  ): Promise<Job> {
    const hasContentChange =
      dto.title !== undefined || dto.description !== undefined;

    if (!hasContentChange && dto.status === undefined) {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        '수정할 필드(title, description, status)를 하나 이상 지정해야 합니다.',
      );
    }

    let changed = false;

    const updated = await this.jobRepo.updateById(id, (job) => {
      if (expectedVersion !== undefined && job.version !== expectedVersion) {
        throw AppException.preconditionFailed(
          'job 이 다른 요청 또는 스케줄러에 의해 변경되었습니다. 최신 상태를 다시 조회하세요.',
          { expectedVersion, currentVersion: job.version },
        );
      }

      if (hasContentChange && !isEditable(job.status)) {
        throw AppException.conflict(
          ErrorCode.JOB_NOT_EDITABLE,
          `${job.status} 상태의 job 은 title/description 을 수정할 수 없습니다.`,
          { status: job.status, editableStatuses: EDITABLE_STATUSES },
        );
      }

      const now = new Date().toISOString();
      const next: Job = { ...job };

      if (dto.status !== undefined && dto.status !== job.status) {
        if (!canUserTransition(job.status, dto.status)) {
          throw AppException.conflict(
            ErrorCode.INVALID_STATUS_TRANSITION,
            `${job.status} → ${dto.status} 상태 전이는 허용되지 않습니다.`,
            {
              from: job.status,
              to: dto.status,
              allowed: USER_TRANSITIONS[job.status],
            },
          );
        }
        next.status = dto.status;

        if (dto.status === JobStatus.PENDING) {
          // 재시도: 처리 이력 초기화
          next.attempts = 0;
          next.lastError = null;
          next.startedAt = null;
          next.finishedAt = null;
        } else if (dto.status === JobStatus.CANCELED) {
          next.finishedAt = now;
        }
      }

      if (dto.title !== undefined) next.title = dto.title;
      if (dto.description !== undefined) next.description = dto.description;

      changed =
        next.status !== job.status ||
        next.title !== job.title ||
        next.description !== job.description;

      // 실제 변경이 없으면 버전을 올리지 않는다 (멱등)
      if (!changed) {
        return job;
      }

      next.version = job.version + 1;
      next.updatedAt = now;
      return next;
    });

    if (!updated) {
      throw AppException.notFound(
        ErrorCode.JOB_NOT_FOUND,
        `id 가 ${id} 인 job 을 찾을 수 없습니다.`,
      );
    }

    if (changed) {
      this.logger.log(
        `job 수정 id=${id} fields=${Object.keys(dto).join(',')} status=${updated.status} version=${updated.version}`,
        JobUpdateUseCase.name,
      );
    }
    return updated;
  }
}
