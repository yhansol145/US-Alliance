import { Module } from '@nestjs/common';

import { JobProcessCronService } from './cron/job-process-cron.service';
import { JobProcessor, SimulatedJobProcessor } from './processor/job.processor';
import { JobProcessBatchUseCase } from './usecase/job-process-batch.usecase';

@Module({
  providers: [
    JobProcessCronService,
    JobProcessBatchUseCase,
    { provide: JobProcessor, useClass: SimulatedJobProcessor },
  ],
})
export class SchedulerModule {}
