import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { APP_CONFIG, AppConfig } from '@app/core';

import { AppModule } from './app.module';
import { configureApp } from './setup';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  configureApp(app);
  // SIGINT/SIGTERM 시 진행 중 배치 완료 대기 & 로그 스트림 flush
  app.enableShutdownHooks();

  const config = app.get<AppConfig>(APP_CONFIG);
  await app.listen(config.port);
  console.log(`job-server listening on http://localhost:${config.port}`);
}
bootstrap();
