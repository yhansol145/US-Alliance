# CLAUDE.md - Job Management Server

## Project Overview

NestJS 기반 작업(Job) 관리 백엔드. REST API 로 Job 을 생성·조회·검색·수정하고, 백그라운드 스케줄러가 주기적으로 Job 을 처리한다.
데이터는 `node-json-db` 로 단일 JSON 파일(`jobs.json`)에 영속화한다.

## Tech Stack

- **Framework**: NestJS v10 (TypeScript v5.4)
- **Runtime**: Node.js 18+
- **Package Manager**: npm (`npm install` 만으로 실행되어야 하므로 pnpm 사용 금지, `package-lock.json` 커밋)
- **Database**: node-json-db v2 (단일 JSON 파일)
- **Scheduler**: @nestjs/schedule v4 (`SchedulerRegistry` 동적 interval)
- **Validation**: class-validator / class-transformer
- **Test**: Jest v29 (ts-jest) + supertest
- **Build**: Webpack (NestJS CLI)

## Monorepo Structure

```
apps/
  job-server/
    src/
      main.ts, setup.ts, app.module.ts
      modules/job/          # REST API
      modules/scheduler/    # 백그라운드 처리
    test/                   # e2e 테스트, test-utils
libs/
  core/                     # 저장소, 로거, 예외 필터, 설정, 모델
  utils/                    # 상수 (JobStatus, ErrorCode)
scripts/                    # jobs.sample.json, reset-db.js
jobs.json                   # 실제 DB 파일 (샘플 데이터로 커밋됨)
logs.txt                    # 요청/스케줄러 로그 (gitignore)
```

## Architecture Patterns

- **Controller → Service → UseCase**: 비즈니스 로직은 `usecase/` 에 하나의 유스케이스당 하나의 클래스로 둔다. Service 는 위임만 한다.
- **Repository Pattern**: `IJobRepository` 인터페이스 + `CoreModule.JOB_REPO` 토큰으로 주입 (`@Inject(CoreModule.JOB_REPO)`).
- **Global Singleton Core**: `CoreModule.forRoot()` / `CoreConfigModule.forRoot()` 는 `@Global` 이며 `AppModule` 에서 한 번만 import 한다.
- **Single Process**: API 와 스케줄러는 같은 프로세스에서 동작한다. 쓰기 주체를 하나로 두는 것이 동시성 설계의 전제다.

## Module Organization

```
modules/{domain}/
  controllers/    # HTTP 어댑터
  services/       # 유스케이스 오케스트레이션
  usecase/        # 유스케이스 구현 ({domain}-{action}.usecase.ts)
  dto/            # 요청 DTO (class-validator)
  utils/          # 도메인 순수 함수 (상태 전이, ETag, 페이지네이션)
```

## 동시성 규칙 (중요)

변경 전 반드시 [json-db.service.ts](libs/core/src/database/json-db.service.ts) 의 주석을 읽을 것.

- **모든 쓰기는 `IJobRepository.transaction()` / `updateById()` / `create()` 를 통해서만** 한다. `JsonDbService` 나 파일을 직접 쓰지 않는다.
- **mutator 는 동기 함수**여야 한다. mutator 안에서 `await`, I/O, 다른 트랜잭션 호출 금지 (쓰기 큐가 막힌다).
- **검증은 mutator 안에서** 한다. 트랜잭션 밖에서 조회 → 검증 후 쓰면 그 사이 스케줄러가 상태를 바꿀 수 있다.
- mutator 에서 예외를 던지면 해당 트랜잭션만 롤백된다. 도메인 에러는 `AppException` 을 던진다.
- 읽기(`findAll`, `findById`)는 큐를 거치지 않으며 복사본을 반환한다. 내부 객체를 제자리에서 수정하지 않는다 (copy-on-write).
- 쓰기가 일어나면 `version` 을 1 올리고 `updatedAt` 을 갱신한다. 실제 변경이 없으면 버전을 올리지 않는다.
- 스케줄러의 오래 걸리는 처리는 트랜잭션 밖에서 한다 (claim → process → commit).
- `CoreModule` 을 모듈별로 다시 등록하지 않는다. 쓰기 큐 인스턴스가 분리되면 직렬화가 깨진다.

## 상태 전이 규칙

- 사용자(PATCH): `pending → canceled`, `failed → pending`(재시도, attempts 초기화), `failed → canceled`
- 스케줄러 전용: `pending → processing → completed | pending(재시도) | failed`
- title/description 수정은 `pending`, `failed` 에서만 가능
- 규칙 정의: [job-transition.ts](apps/job-server/src/modules/job/utils/job-transition.ts). 규칙을 바꾸면 README 의 상태 전이 표도 함께 수정한다.

## API 규칙

- 성공 응답: 단건 `{ data }`, 목록 `{ data, meta: { total, page, limit, totalPages } }`
- 에러 응답: `{ statusCode, error, message, details?, path, timestamp, requestId }` — `AllExceptionsFilter` 가 생성
- 상태 코드: 400 입력 오류 / 404 없음 / 409 현재 상태와 충돌 / 412 `If-Match` 버전 불일치 / 500 내부 오류 (stack 미노출)
- 새 에러 유형은 `libs/utils/src/constants/error-code.type.ts` 에 `ErrorCode` 를 추가하고 `AppException` 정적 메서드로 던진다.
- 고정 경로(`/jobs/search`)는 파라미터 경로(`/jobs/:id`)보다 먼저 선언한다.
- `ValidationPipe` 는 `whitelist + forbidNonWhitelisted` 이므로 DTO 에 없는 필드는 400 이 된다.

## 설정

- 환경변수 / `.env` 를 사용하지 않는다. 설정값은 [app.config.ts](libs/core/src/config/app.config.ts) 의 `DEFAULT_APP_CONFIG` 상수로 관리한다 (배포 없이 `npm start` 만으로 동작해야 함).
- 설정은 `@Inject(APP_CONFIG) config: AppConfig` 로 주입받는다. `process.env` 를 직접 읽지 않는다.
- 테스트는 `overrideProvider(APP_CONFIG)` 로 교체한다.

## 로깅

- 로그는 `FileLogService` 로만 남긴다 (`logs.txt` + 콘솔). 컨텍스트는 클래스명 또는 `'HTTP'`, `'Scheduler'`.
- 요청 로깅 미들웨어는 body-parser 보다 먼저 등록되어야 한다 ([setup.ts](apps/job-server/src/setup.ts)). 그래서 앱은 `bodyParser: false` 로 생성하고 `configureApp()` 에서 직접 등록한다.
- main.ts 와 e2e 테스트는 동일하게 `configureApp()` 을 사용한다. HTTP 파이프라인 설정은 main.ts 가 아닌 여기에 추가한다.
- 요청 body 는 로깅하지 않는다.

## Key Commands

```bash
npm install
npm start              # 빌드 후 실행 (http://localhost:3000)
npm run start:dev      # watch 모드
npm test               # 전체 테스트 (--runInBand)
npm run test:cov
npm run lint           # ESLint (auto-fix)
npm run format         # Prettier
npm run db:reset       # jobs.json 을 scripts/jobs.sample.json 으로 초기화
```

## Testing

- 테스트 파일: 유닛은 소스 옆 `*.spec.ts`, e2e 는 `apps/job-server/test/*.e2e-spec.ts`
- [test-utils.ts](apps/job-server/test/test-utils.ts) 사용:
  - `createWorkspace()` — 임시 디렉토리의 jobs.json / logs.txt, 스케줄러 주기 실행 off
  - `createTestApp(config, processor)` — 실제 `AppModule` + `configureApp()` 로 앱 생성
  - `ControllableProcessor` — 처리 성공/실패/지연 제어, `deferred()` — 처리 중 상태 붙잡기
  - `makeJob()` — 테스트용 Job 픽스처
- 스케줄러는 주기를 기다리지 말고 `JobProcessCronService.handleTick()` / `JobProcessBatchUseCase.execute()` 를 직접 호출한다.
- logs.txt 검증 전에는 `FileLogService.flush()` 를 호출한다.
- 레포 루트의 `jobs.json` / `logs.txt` 를 테스트에서 건드리지 않는다.
- 동시성 관련 변경 시 [job.repository.spec.ts](libs/core/src/database/repositories/job.repository.spec.ts) 와 e2e 의 "API 와 스케줄러 동시 접근" 테스트가 통과해야 한다.

## Path Aliases (tsconfig / jest)

- `@app/core` → `libs/core/src`
- `@app/utils` → `libs/utils/src`

새 alias 를 추가하면 `tsconfig.json` 과 `jest.preset.js` 의 `moduleNameMapper` 를 함께 수정한다.

## Naming Conventions

- **Files**: kebab-case + 역할 접미사 (`job-update.usecase.ts`, `job-process-cron.service.ts`)
- **Classes**: PascalCase (`JobUpdateUseCase`)
- **Enum 값 / 상수**: UPPER_SNAKE_CASE, **Enum 이름**: PascalCase
- **문서 / 주석 / 로그 / 에러 메시지**: 한국어

## TypeScript Notes

- `strictNullChecks: false`, `noImplicitAny: false`
- strictNullChecks 가 꺼져 있어 discriminated union 이 narrowing 되지 않는다. `{ ok: true } | { ok: false; reason }` 대신 `{ ok: boolean; reason?: string }` 형태를 쓴다.
- Target: ES2021, Module: CommonJS. `structuredClone` 사용 (Node 17+).

## Formatting

- Prettier: single quotes, trailing commas
- ESLint: `@typescript-eslint/recommended` + prettier

## 커밋 전 체크

- `npm test`, `npm run lint` 통과
- 서버를 실행했다면 `npm run db:reset` 으로 `jobs.json` 을 샘플 상태로 되돌린다 (스케줄러가 샘플을 처리해 diff 가 생김)
- API / 상태 전이 / 설정값을 바꿨다면 README 의 해당 섹션도 갱신한다
- 레포는 Public 이다. 과제 원문을 커밋하지 않는다.
