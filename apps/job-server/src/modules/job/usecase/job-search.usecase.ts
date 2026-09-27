import { Inject, Injectable } from '@nestjs/common';
import {
  AppException,
  CoreModule,
  IJobRepository,
  Job,
  PaginatedResponse,
} from '@app/core';
import { ErrorCode } from '@app/utils';

import { SearchJobsQueryDto } from '../dto';
import { paginate, sortByCreatedAt } from '../utils/pagination';

@Injectable()
export class JobSearchUseCase {
  constructor(
    @Inject(CoreModule.JOB_REPO)
    private readonly jobRepo: IJobRepository,
  ) {}

  async execute({
    title,
    status,
    page,
    limit,
    order,
  }: SearchJobsQueryDto): Promise<PaginatedResponse<Job>> {
    // 조건 없는 검색은 목록 조회와 같으므로 의도치 않은 전체 조회를 막기 위해 거부한다
    if (!title && !status?.length) {
      throw AppException.badRequest(
        ErrorCode.VALIDATION_FAILED,
        '검색 조건(title 또는 status)을 하나 이상 지정해야 합니다.',
        [{ field: 'title|status', messages: ['하나 이상 필요합니다.'] }],
      );
    }

    const keyword = title?.toLowerCase();
    const statuses = status?.length ? new Set(status) : null;

    const jobs = (await this.jobRepo.findAll()).filter(
      (job) =>
        (!keyword || job.title.toLowerCase().includes(keyword)) &&
        (!statuses || statuses.has(job.status)),
    );

    return paginate(sortByCreatedAt(jobs, order), page, limit);
  }
}
