import { Inject, Injectable } from '@nestjs/common';
import { AppException, CoreModule, IJobRepository, Job } from '@app/core';
import { ErrorCode } from '@app/utils';

@Injectable()
export class JobGetUseCase {
  constructor(
    @Inject(CoreModule.JOB_REPO)
    private readonly jobRepo: IJobRepository,
  ) {}

  async execute(id: string): Promise<Job> {
    const job = await this.jobRepo.findById(id);
    if (!job) {
      throw AppException.notFound(
        ErrorCode.JOB_NOT_FOUND,
        `id 가 ${id} 인 job 을 찾을 수 없습니다.`,
      );
    }
    return job;
  }
}
