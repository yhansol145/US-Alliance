import { Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CoreModule, FileLogService, IJobRepository, Job } from '@app/core';
import { JobStatus } from '@app/utils';

import { CreateJobDto } from '../dto';

@Injectable()
export class JobCreateUseCase {
  constructor(
    @Inject(CoreModule.JOB_REPO)
    private readonly jobRepo: IJobRepository,
    private readonly logger: FileLogService,
  ) {}

  async execute({ title, description }: CreateJobDto): Promise<Job> {
    const now = new Date().toISOString();
    const job = await this.jobRepo.create({
      id: randomUUID(),
      title,
      description: description ?? '',
      status: JobStatus.PENDING,
      attempts: 0,
      lastError: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      startedAt: null,
      finishedAt: null,
    });

    this.logger.log(`job 생성 id=${job.id}`, JobCreateUseCase.name);
    return job;
  }
}
