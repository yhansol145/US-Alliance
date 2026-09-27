import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';

import { FileLogService } from './file-log.service';

export const REQUEST_ID_HEADER = 'X-Request-Id';

/**
 * 모든 HTTP 요청을 logs.txt 에 기록한다.
 *
 * 인터셉터가 아닌 미들웨어 + `finish` 이벤트로 구현한 이유:
 * 인터셉터는 라우트가 매칭된 요청에만 실행되므로, 존재하지 않는 경로(404)나
 * body 파싱 실패(400) 같은 요청이 누락된다. 미들웨어는 모든 요청을 거치고,
 * `finish` 시점에는 예외 필터까지 반영된 최종 상태 코드를 알 수 있다.
 */
@Injectable()
export class RequestLoggingMiddleware implements NestMiddleware {
  private static readonly CONTEXT = 'HTTP';

  constructor(private readonly logger: FileLogService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const startedAt = process.hrtime.bigint();
    const requestId = req.header(REQUEST_ID_HEADER) || randomUUID();
    req.headers[REQUEST_ID_HEADER.toLowerCase()] = requestId;
    res.setHeader(REQUEST_ID_HEADER, requestId);

    let logged = false;
    const writeLog = (aborted: boolean) => {
      if (logged) return;
      logged = true;

      const durationMs =
        Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const status = aborted ? 'ABORTED' : res.statusCode;
      const message =
        `${req.method} ${req.originalUrl} ${status} ${durationMs.toFixed(1)}ms` +
        ` reqId=${requestId} ip=${req.ip} ua="${req.header('user-agent') ?? '-'}"`;

      if (aborted || res.statusCode >= 500) {
        this.logger.error(message, RequestLoggingMiddleware.CONTEXT);
      } else if (res.statusCode >= 400) {
        this.logger.warn(message, RequestLoggingMiddleware.CONTEXT);
      } else {
        this.logger.log(message, RequestLoggingMiddleware.CONTEXT);
      }
    };

    res.on('finish', () => writeLog(false));
    // 응답이 끝나기 전에 클라이언트가 연결을 끊은 경우
    res.on('close', () => writeLog(!res.writableFinished));

    next();
  }
}
