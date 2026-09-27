import { NestExpressApplication } from '@nestjs/platform-express';
import { FileLogService, RequestLoggingMiddleware } from '@app/core';

/**
 * main.ts 와 e2e 테스트가 공유하는 HTTP 파이프라인 설정
 *
 * NestFactory.create(AppModule, { bodyParser: false }) 로 생성한 앱에 적용한다.
 */
export const configureApp = (app: NestExpressApplication) => {
  // 요청 로깅을 body-parser 보다 먼저 등록해야 잘못된 JSON 등
  // 파싱 단계에서 거절되는 요청까지 logs.txt 에 남는다
  const requestLogger = new RequestLoggingMiddleware(app.get(FileLogService));
  app.use(requestLogger.use.bind(requestLogger));

  app.useBodyParser('json', { limit: '100kb' });

  // Express 기본 weak ETag 를 끈다. ETag 는 job.version 기반으로 직접 발급한다
  app.set('etag', false);

  return app;
};
