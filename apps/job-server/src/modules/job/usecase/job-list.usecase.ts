import { Inject, Injectable } from '@nestjs/common';
import { CoreModule, IJobRepository, Job, PaginatedResponse } from '@app/core';

import { ListJobsQueryDto } from '../dto';
import { paginate, sortByCreatedAt } from '../utils/pagination';

@Injectable()
export class JobListUseCase {
  constructor(
    @Inject(CoreModule.JOB_REPO)
    private readonly jobRepo: IJobRepository,
  ) {}

  async execute({
    page,
    limit,
    order,
  }: ListJobsQueryDto): Promise<PaginatedResponse<Job>> {
    const jobs = await this.jobRepo.findAll();
    return paginate(sortByCreatedAt(jobs, order), page, limit);
  }
}
