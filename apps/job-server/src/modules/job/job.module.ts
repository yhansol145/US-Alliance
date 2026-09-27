import { Module } from '@nestjs/common';

import { JobController } from './controllers/job.controller';
import { JobService } from './services/job.service';
import {
  JobCreateUseCase,
  JobGetUseCase,
  JobListUseCase,
  JobSearchUseCase,
  JobUpdateUseCase,
} from './usecase';

@Module({
  controllers: [JobController],
  providers: [
    JobService,
    JobCreateUseCase,
    JobGetUseCase,
    JobListUseCase,
    JobSearchUseCase,
    JobUpdateUseCase,
  ],
})
export class JobModule {}
