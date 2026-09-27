# Job Management Server

NestJS로 작업(Job)을 생성·조회·검색·수정하는 REST API와, 백그라운드에서 작업을 주기적으로 처리하는 스케줄러입니다.
데이터는 `node-json-db`를 통해 단일 JSON 파일(`jobs.json`)에 저장합니다.

- [실행 방법](#실행-방법)
- [API 사용법](#api-사용법)
- [구현 코멘트](#구현-코멘트)

---

## 실행 방법

Node.js 18 이상이 필요합니다. 별도의 `.env`나 외부 인프라 없이 동작합니다.

```bash
npm install

npm start            # 빌드 후 실행 (http://localhost:3000)
npm run start:dev    # watch 모드

npm test             # 전체 테스트 (unit + e2e)
npm run test:cov     # 커버리지

npm run db:reset     # jobs.json 을 샘플 데이터로 초기화
```

- `jobs.json`에는 샘플 데이터 7건(`pending` 3, `completed` 2, `failed` 1, `canceled` 1)이 들어 있습니다.
  서버를 실행하면 1분 뒤 스케줄러가 `pending` 샘플을 처리하므로, 처음 상태를 다시 보려면 `npm run db:reset`을 실행하면 됩니다.
- 요청 로그와 스케줄러 로그는 모두 실행 디렉토리의 `logs.txt`에 쌓입니다.

### 설정값

배포 설정 파일 없이 `npm start`만으로 동작하도록 설정값은 코드 상수([app.config.ts](libs/core/src/config/app.config.ts))로 두었습니다.
테스트에서는 DI 토큰(`APP_CONFIG`)을 override해 임시 디렉토리와 짧은 주기를 사용합니다.

| 항목 | 값 | 설명 |
| --- | --- | --- |
| `port` | 3000 | |
| `dbPath` / `logPath` | `./jobs.json` / `./logs.txt` | |
| `scheduler.intervalMs` | 60,000 | 처리 주기 (1분) |
| `scheduler.batchSize` | 10 | 한 번의 주기에 처리할 최대 건수 |
| `scheduler.maxAttempts` | 3 | 최대 시도 횟수. 넘으면 `failed` |
| `scheduler.processDelayMs` | 500 | 1건 처리에 걸리는 시뮬레이션 시간 |
| `scheduler.processTimeoutMs` | 30,000 | 1건 처리 제한 시간 |

---

## API 사용법

### 데이터 모델

```json
{
  "id": "0cd26197-6884-4d60-a1e1-817be17dc08e",
  "title": "Task 1",
  "description": "Do something",
  "status": "pending",
  "attempts": 0,
  "lastError": null,
  "version": 1,
  "createdAt": "2026-09-27T08:15:31.257Z",
  "updatedAt": "2026-09-27T08:15:31.257Z",
  "startedAt": null,
  "finishedAt": null
}
```

| 필드 | 설명 |
| --- | --- |
| `attempts` | 스케줄러가 처리를 시도한 횟수 |
| `lastError` | 마지막 실패 사유 |
| `version` | 변경될 때마다 1씩 증가. `ETag` 헤더로 노출되며 낙관적 잠금에 사용 |
| `startedAt` | 마지막으로 `processing`이 된 시각 |
| `finishedAt` | `completed` / `failed` / `canceled`로 끝난 시각 |

### 상태 전이

```
             ┌─────────────── 스케줄러 ───────────────┐
             │                                         ▼
 (생성) ─▶ pending ──▶ processing ──(성공)──────────▶ completed
             ▲  │            │
             │  │            ├──(실패, attempts < 3)──▶ pending (다음 주기에 재시도)
             │  │            └──(실패, attempts ≥ 3)──▶ failed
             │  │                                         │
             │  └───── 사용자 ──▶ canceled ◀── 사용자 ─────┤
             └──────────────── 사용자 (재시도) ─────────────┘
```

| 현재 상태 | 사용자가 지정할 수 있는 status | title/description 수정 |
| --- | --- | --- |
| `pending` | `canceled` | 가능 |
| `processing` | 없음 (스케줄러가 처리 중) | 불가 |
| `completed` | 없음 (종료 상태) | 불가 |
| `failed` | `pending` (재시도, `attempts` 초기화) / `canceled` | 가능 |
| `canceled` | 없음 (종료 상태) | 불가 |

### 응답 형식

```jsonc
// 단건
{ "data": { ...job } }

// 목록 / 검색
{ "data": [ ...jobs ], "meta": { "total": 7, "page": 1, "limit": 20, "totalPages": 1 } }

// 에러 (모든 엔드포인트 공통)
{
  "statusCode": 409,
  "error": "INVALID_STATUS_TRANSITION",   // 머신 리더블 코드
  "message": "canceled → pending 상태 전이는 허용되지 않습니다.",
  "details": { "from": "canceled", "to": "pending", "allowed": [] },  // 선택
  "path": "/jobs/0cd2...",
  "timestamp": "2026-09-27T08:16:33.207Z",
  "requestId": "a6eac086-..."             // X-Request-Id 헤더, logs.txt 와 대조 가능
}
```

### `POST /jobs` 작업 생성

```bash
curl -i -X POST localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"title": "Task 1", "description": "Do something"}'
```

```http
HTTP/1.1 201 Created
Location: /jobs/0cd26197-6884-4d60-a1e1-817be17dc08e
ETag: "1"

{ "data": { "id": "0cd26197-...", "title": "Task 1", "status": "pending", "version": 1, ... } }
```

| 필드 | 규칙 |
| --- | --- |
| `title` | 필수. 앞뒤 공백 제거 후 1~200자 |
| `description` | 선택 (기본값 `""`). 최대 2000자 |

그 외 필드(`status`, `id` 등)를 보내면 `400`으로 거부합니다.

### `GET /jobs` 목록 조회

```bash
curl 'localhost:3000/jobs?page=1&limit=20&order=desc'
```

| 쿼리 | 기본값 | 설명 |
| --- | --- | --- |
| `page` | 1 | 1 이상 |
| `limit` | 20 | 1~100 |
| `order` | `desc` | `createdAt` 기준 정렬. `asc` / `desc` |

### `GET /jobs/search` 검색

```bash
curl 'localhost:3000/jobs/search?title=report&status=pending,failed'

# 샘플 데이터 기준 예시: 제목에 "US Campus" 가 포함된 pending/failed 작업 (2건)
curl -G 'localhost:3000/jobs/search' --data-urlencode 'title=us campus' --data-urlencode 'status=pending,failed'
```

| 쿼리 | 설명 |
| --- | --- |
| `title` | 대소문자를 무시한 부분 일치 |
| `status` | 쉼표로 구분(`status=a,b`)하거나 파라미터를 반복(`status=a&status=b`)해 여러 개 지정 가능 (OR) |
| `page`, `limit`, `order` | 목록 조회와 동일 |

- `title`과 `status`를 함께 주면 AND로 결합합니다.
- 둘 다 없으면 `400`을 반환합니다. 조건 없는 검색은 목록 조회와 같으므로 실수로 전체를 조회하는 것을 막기 위해서입니다.

### `GET /jobs/:id` 단건 조회

```bash
curl -i localhost:3000/jobs/0cd26197-6884-4d60-a1e1-817be17dc08e
# 200 + ETag: "1"
```

### `PATCH /jobs/:id` 수정

```bash
# 내용 수정
curl -X PATCH localhost:3000/jobs/<id> -H 'Content-Type: application/json' \
  -d '{"title": "renamed"}'

# 취소 (조회한 버전에서 바뀌지 않았을 때만 적용)
curl -X PATCH localhost:3000/jobs/<id> -H 'Content-Type: application/json' \
  -H 'If-Match: "1"' -d '{"status": "canceled"}'

# 실패 건 재시도
curl -X PATCH localhost:3000/jobs/<id> -H 'Content-Type: application/json' \
  -d '{"status": "pending"}'
```

- 수정 가능한 필드는 `title`, `description`, `status`(`pending` 또는 `canceled`)입니다.
- `If-Match` 헤더는 선택입니다. 보내면 현재 `version`과 비교해 다를 때 `412`를 반환합니다.
- 실제로 바뀐 값이 없으면 `version`을 올리지 않습니다 (멱등).

### 상태 코드

| 코드 | `error` | 발생 상황 |
| --- | --- | --- |
| 200 / 201 | | 성공 |
| 400 | `VALIDATION_FAILED` | 필드 검증 실패, 허용되지 않은 필드, UUID가 아닌 id, 빈 PATCH body, 검색 조건 없음, 잘못된 `If-Match` 형식 |
| 400 | `BAD_REQUEST` | JSON 파싱 실패 |
| 404 | `JOB_NOT_FOUND` / `NOT_FOUND` | 없는 job / 없는 라우트 |
| 409 | `INVALID_STATUS_TRANSITION` | 허용되지 않은 상태 전이 (예: `processing`인 작업 취소) |
| 409 | `JOB_NOT_EDITABLE` | 수정할 수 없는 상태에서 title/description 수정 |
| 412 | `PRECONDITION_FAILED` | `If-Match` 버전 불일치 (다른 요청이나 스케줄러가 먼저 변경함) |
| 500 | `INTERNAL_SERVER_ERROR` | 예상하지 못한 오류. stack은 응답에 포함하지 않고 `logs.txt`에만 기록 |

### logs.txt 예시

```
2026-09-27T08:24:31.208Z [INFO] [Scheduler] 스케줄러 등록 intervalMs=60000 batchSize=10
2026-09-27T08:24:40.101Z [INFO] [JobCreateUseCase] job 생성 id=0cd26197-...
2026-09-27T08:24:40.102Z [INFO] [HTTP] POST /jobs 201 12.4ms reqId=b660f255-... ip=::1 ua="curl/8.7.1"
2026-09-27T08:24:41.009Z [WARN] [HTTP] PATCH /jobs/0cd2... 409 2.5ms reqId=a978b7cd-... ip=::1 ua="curl/8.7.1"
2026-09-27T08:25:31.238Z [INFO] [Scheduler] 배치 시작 claimed=3 ids=a567...,b8f0...,50d5...
2026-09-27T08:25:31.763Z [INFO] [Scheduler] job 처리 성공 id=a5678af7-...
2026-09-27T08:25:31.763Z [INFO] [Scheduler] 배치 완료 claimed=3 completed=3 retried=0 failed=0 skipped=0 durationMs=553
```

---

## 구현 코멘트

### 프로젝트 구조

평소 사용하던 NestJS 모노레포 구조(apps / libs, controller → service → usecase, 토큰 기반 repository DI)를 따랐습니다.

```
apps/job-server/src
  main.ts, setup.ts, app.module.ts
  modules/job/            controllers / services / usecase / dto / utils(상태 전이, ETag, 페이지네이션)
  modules/scheduler/      cron(주기 실행) / usecase(선점·처리·반영) / processor(실제 처리 로직)
apps/job-server/test      e2e 테스트, 테스트 유틸
libs/core/src
  database/               JsonDbService(쓰기 큐 + group commit), AtomicFileAdapter, JobRepository
  models/                 Job 엔티티, IJobRepository
  log/                    FileLogService(logs.txt), 요청 로깅 미들웨어
  common/                 공통 예외 필터, 응답 타입
  config/                 설정 상수
libs/utils/src            JobStatus, ErrorCode 상수
```

### 1. 동시성과 데이터 무결성

과제에서 가장 고민한 부분입니다.

**문제 정의.** `node-json-db`는 `getData` / `push` / `save`를 각각 호출할 때만 내부 락을 겁니다.
"조회 → 검증 → 수정 → 저장"이 여러 `await`로 나뉘면, 그 사이에 API 요청이나 스케줄러가 끼어들어 한쪽의 변경이 사라집니다(lost update).
또 기본 `FileAdapter`는 파일을 `'w'` 모드로 열어 먼저 비운 뒤 쓰기 때문에, 쓰는 도중 프로세스가 죽으면 `jobs.json`이 비거나 잘린 채로 남습니다.

**해결.**

1. **단일 쓰기 큐 (single writer).**
   모든 쓰기는 `JsonDbService.transaction(path, mutator)`을 통해서만 이뤄집니다. 큐에 들어온 순서대로 하나씩 실행되므로 동시에 요청이 와도 순차 실행과 같은 결과가 나옵니다.
   - mutator는 **동기 함수**로 제한했습니다. 큐를 잡고 있는 시간을 짧게 유지하기 위해서입니다.
   - 검증도 mutator 안에서 합니다. 트랜잭션 밖에서 검증하면 검증과 쓰기 사이에 상태가 바뀔 수 있기 때문입니다.
   - mutator가 예외를 던지면 그 트랜잭션만 취소됩니다.
2. **Group commit.**
   큐에 쌓인 트랜잭션들을 메모리에 차례로 적용한 뒤, 디스크 저장(fsync)은 한 번만 합니다. 각 요청은 자기 변경이 디스크에 저장된 뒤에 응답을 받습니다.
3. **원자적 파일 쓰기** ([AtomicFileAdapter](libs/core/src/database/atomic-file.adapter.ts)).
   임시 파일에 전체 내용을 쓰고 fsync한 다음 `rename`으로 교체합니다. 그래서 디스크에는 항상 이전 버전 전체나 새 버전 전체 중 하나만 존재합니다.
   저장이 실패하면 메모리를 디스크 상태로 되돌려, 요청은 실패했는데 메모리에는 반영된 상태가 남지 않게 했습니다.
4. **복사 후 교체 방식 읽기 (copy-on-write).**
   쓰기는 항상 새 배열로 통째로 교체하고 기존 객체를 직접 수정하지 않습니다. 그래서 읽기는 큐를 거치지 않아도 트랜잭션 단위로 일관된 상태를 봅니다. 반환값은 복사본입니다.
5. **스케줄러의 3단계 처리.**
   - claim(트랜잭션 안): 처리할 작업을 `pending → processing`으로 원자적으로 선점합니다.
   - process(트랜잭션 밖): 실제 처리를 합니다. 처리가 오래 걸려도 API 요청이 막히지 않습니다.
   - commit(트랜잭션 안): 결과를 반영합니다.

   선점이 원자적이라 같은 작업이 두 번 처리되지 않습니다. `processing` 상태는 사용자가 바꿀 수 없어, 처리 도중에 작업 내용이 바뀌지도 않습니다.
   반영할 때 이미 `processing`이 아닌 작업은 결과를 덮어쓰지 않고 `skipped`로 기록합니다.
6. **낙관적 잠금 (`version` + `ETag` / `If-Match`).**
   서버 내부의 경쟁은 큐로 해결되지만, 클라이언트가 **조회한 뒤 수정하는 사이에** 스케줄러가 상태를 바꾸는 문제는 남습니다.
   예를 들어 `pending`을 보고 제목을 고쳤는데, 그 사이 작업이 이미 완료된 경우입니다.
   `If-Match`를 보내면 이런 경우를 `412`로 알 수 있습니다. 강제하지는 않고 선택으로 두었습니다.
7. **장애 복구.**
   서버가 처리 도중 종료되어 `processing`에 멈춘 작업은 부팅할 때 일반 실패와 같은 규칙(재시도 또는 `failed`)으로 되돌립니다.
   정상 종료(SIGINT/SIGTERM) 시에는 진행 중인 배치가 끝날 때까지 기다립니다.
   `jobs.json`이 깨져 있으면 빈 데이터로 덮어쓰지 않고 부팅을 실패시킵니다.

### 2. 스케줄러

- **1분 주기, 한 번에 최대 10건, 오래된 순(`createdAt`, 같으면 `id`)** 으로 처리합니다.
  같은 배치 안의 작업들은 병렬로 처리하고, 결과는 한 번의 트랜잭션으로 반영합니다.
- 과제에 "처리"의 구체적인 내용이 정해져 있지 않아, `JobProcessor` 추상 클래스로 분리했습니다.
  기본 구현은 500ms 동안 작업하는 것을 흉내 낸 뒤 성공합니다. 테스트에서는 이 부분을 바꿔 끼워 실패, 지연, 타임아웃을 만듭니다.
- 실패하면 `lastError`를 기록하고 `pending`으로 돌려 다음 주기에 다시 시도합니다. `attempts`가 3에 도달하면 `failed`로 바꿉니다.
  처리가 멈춰 배치 전체가 막히지 않도록 1건당 제한 시간(30초)을 두었습니다.
- 이전 배치가 아직 끝나지 않았으면 이번 주기는 건너뜁니다.
  선점 덕분에 겹쳐 실행되어도 중복 처리는 없지만, 처리가 느릴 때 배치가 계속 쌓이는 것을 막기 위해서입니다.
- `@nestjs/schedule`의 `@Interval` 데코레이터 대신 `SchedulerRegistry`에 직접 등록했습니다. 주기를 설정값으로 주입받고, 테스트에서 끌 수 있게 하기 위해서입니다.

### 3. API 설계

- **`processing`, `completed`, `failed`는 스케줄러만 설정할 수 있습니다.**
  사용자가 `completed`로 바꿀 수 있으면 실제로 처리되지 않은 작업이 완료로 보이게 됩니다.
  그래서 사용자는 "취소"와 "실패 건 재시도" 두 가지 의도만 표현할 수 있습니다.
- **잘못된 요청 값은 400, 요청은 맞지만 현재 상태와 충돌하면 409, 버전 전제 조건 실패는 412로 구분했습니다.**
  클라이언트가 "요청을 고쳐야 하는지", "다시 조회해야 하는지"를 코드만 보고 판단할 수 있게 하기 위해서입니다.
- `id` 형식 검증(UUID)을 404보다 먼저 해서 400을 반환합니다.
- 조회 계열 응답은 항상 `{ data, meta? }` 형태로 감쌌습니다. 나중에 커서 페이지네이션 같은 메타 정보를 추가해도 호환이 깨지지 않습니다.
- `DELETE`는 요구사항에 없어 만들지 않았고, 대신 `canceled` 상태로 소프트 삭제 역할을 하게 했습니다.

### 4. 로깅

- 요청 로그는 인터셉터가 아닌 **미들웨어 + `res.on('finish')`** 로 남깁니다.
  인터셉터는 라우트가 매칭된 요청에서만 실행되어 404 요청이 빠집니다. `finish` 시점에는 예외 필터까지 반영된 최종 상태 코드를 알 수 있습니다.
- `logs.txt`에는 append 모드 스트림 하나로 씁니다. API 로그와 스케줄러 로그가 동시에 발생해도 줄 단위로 섞이지 않고, 요청 처리를 블로킹하지 않습니다.
- 요청마다 `X-Request-Id`를 발급하고, 같은 값을 에러 응답과 로그에 함께 남겨 서로 대조할 수 있게 했습니다.

### 5. 성능

- 쓰기 비용의 대부분은 fsync(이 환경 기준 약 24ms)입니다. 트랜잭션마다 fsync를 하면 초당 40건 정도가 한계인데, group commit으로 동시 요청 200건 생성이 **5초 이상에서 약 0.2초**로 줄었습니다.
- 목록 조회와 검색은 전체 배열을 순회합니다(O(n)). node-json-db는 저장할 때마다 파일 전체를 다시 쓰기 때문에, 이 방식이 감당할 수 있는 규모(수천 건 수준)에서는 인덱스를 둘 이득이 크지 않다고 판단했습니다.
- 변경이 없는 트랜잭션(예: 처리할 작업이 없는 스케줄러 주기)은 디스크에 쓰지 않습니다.

### 명세 해석

- **"처리"의 의미**: 정의되어 있지 않아 "일정 시간이 걸리는 작업을 실행하고, 실패할 수 있으며, 재시도한다"로 해석했습니다.
- **"모든 요청 로깅"**: 라우팅 실패(404)와 JSON 파싱 실패(400)까지 포함했습니다. 요청 body는 개인정보가 들어갈 수 있어 기록하지 않았습니다.
- **데이터 형태**: 예시와 같이 `jobs`를 배열로 두었습니다. id를 키로 하는 객체가 조회는 빠르지만, 예시 형태를 유지하는 쪽을 택했습니다.

### 고민 끝에 되돌린 결정

1. **API 서버와 스케줄러 프로세스 분리 → 단일 프로세스.**
   처음에는 API 서버와 daemon을 별도 앱으로 나누는 구조를 고려했습니다.
   그런데 node-json-db는 파일을 메모리에 올려두고 쓰기 때문에, 두 프로세스가 같은 파일을 쓰면 서로의 메모리 상태가 어긋나 변경이 덮어써집니다.
   이를 막으려면 파일 락, 매번 다시 읽기, 죽은 락 정리가 모두 필요해 설계가 불필요하게 복잡해집니다.
   그래서 쓰기 주체를 하나로 두되, 스케줄러를 독립 모듈(`modules/scheduler`)로 분리해 나중에 떼어낼 수 있게 했습니다.
2. **Mutex → 쓰기 큐 + group commit.**
   처음에는 `async-mutex`로 트랜잭션을 하나씩 직렬화했습니다. 그런데 테스트에서 동시 생성 200건이 타임아웃(5초)을 넘겼고, 원인은 트랜잭션마다 하는 fsync였습니다.
   fsync를 빼면 내구성을 포기하게 되므로, 직렬화는 그대로 두고 저장만 배치로 묶는 방식으로 바꿨습니다.
3. **라우트 미들웨어 → body-parser보다 앞선 전역 미들웨어.**
   처음에는 Nest의 `MiddlewareConsumer`로 로깅 미들웨어를 등록했습니다. 그런데 잘못된 JSON 요청은 body-parser 단계에서 끝나버려 로그에 남지 않았습니다.
   그래서 Nest 기본 body-parser를 끄고, 로깅 미들웨어 → body-parser 순서로 직접 등록했습니다([setup.ts](apps/job-server/src/setup.ts)).
   main과 e2e 테스트가 같은 설정 함수를 쓰도록 해서 테스트 환경과 실제 환경이 달라지지 않게 했습니다.

### 알려진 한계

- **dirty read 가능성.** 읽기는 큐를 거치지 않기 때문에, 같은 배치의 fsync가 끝나기 전 아주 짧은 순간에 아직 저장되지 않은 데이터가 조회될 수 있습니다.
  이후 저장이 실패하면(예: 디스크 용량 부족) 메모리는 되돌려지지만, 그 사이에 조회된 응답은 되돌릴 수 없습니다. 쓰기와 조회의 일관성 수준을 맞추는 것보다 읽기 성능을 우선했습니다.
- **처리 중 강제 종료.** 처리 도중 프로세스가 죽으면 그 시도는 `attempts`에 포함됩니다. 즉 처리 보장 수준은 at-least-once입니다. 처리 로직이 멱등하다는 전제가 필요합니다.
- **단일 프로세스 전제.** 여러 인스턴스로 수평 확장할 수 없습니다. 파일 기반 저장소를 쓰는 한 의도된 제약입니다.

### 테스트

`npm test`로 실행하며, 총 102개입니다. 테스트마다 임시 디렉토리의 `jobs.json`과 `logs.txt`를 사용해 서로 격리됩니다.

| 파일 | 검증 내용 |
| --- | --- |
| [job.repository.spec.ts](libs/core/src/database/repositories/job.repository.spec.ts) | 동시 생성 200건 유실 없음, 같은 작업을 동시에 100번 수정해도 lost update 없음, 실패한 트랜잭션 롤백, 배치 내 격리, group commit 쓰기 횟수, 깨진 파일 보호, 임시 파일 정리, 재시작 후 유지 |
| [job-process-batch.usecase.spec.ts](apps/job-server/src/modules/scheduler/usecase/job-process-batch.usecase.spec.ts) | 배치 크기와 처리 순서, 재시도 후 failed, 타임아웃, 배치 내 실패 격리, 처리 중 들어온 API 쓰기 보존, 동시 실행 시 중복 처리 없음, 반영 시점 상태 확인, 부팅 시 복구 |
| [job-process-cron.service.spec.ts](apps/job-server/src/modules/scheduler/cron/job-process-cron.service.spec.ts) | 주기 등록과 자동 실행, 겹침 방지, 예외가 나도 계속 동작, logs.txt 기록 |
| [jobs.e2e-spec.ts](apps/job-server/test/jobs.e2e-spec.ts) | 전체 엔드포인트의 정상과 에러 케이스, 상태 전이, If-Match(동시 10건 중 정확히 1건만 성공), API와 스케줄러 동시 접근, 모든 요청 logs.txt 기록 |
| [job-transition.spec.ts](apps/job-server/src/modules/job/utils/job-transition.spec.ts), [etag.spec.ts](apps/job-server/src/modules/job/utils/etag.spec.ts) | 전이 규칙, If-Match 파싱 |
