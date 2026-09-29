# 테스트 케이스

Job Management Server의 테스트 케이스(TC) 목록과 실행 결과입니다.
자동 테스트(Jest)와, 실제 서버를 띄워서 확인한 수동 스모크 테스트로 나뉩니다.

- [실행 결과 요약](#실행-결과-요약)
- [자동 테스트 TC 목록](#자동-테스트-tc-목록)
- [수동 스모크 테스트](#수동-스모크-테스트)
- [요구사항별 TC 매핑](#요구사항별-tc-매핑)

---

## 실행 결과 요약

| 항목 | 내용 |
| --- | --- |
| 실행 일시 | 2026-09-28 |
| 기준 커밋 | `fc4960d` (release/1.0.1) |
| 실행 환경 | macOS 15.7, Node.js v24.15.0, npm 11 |
| 실행 명령 | `npm test` (`jest --runInBand`) |
| **결과** | **105 / 105 통과 (실패 0)** · 테스트 스위트 6개 · 12.6초 |
| 수동 스모크 | **12 / 12 통과** |

| 구분 | 테스트 파일 | TC | 케이스 수 | 결과 |
| --- | --- | --- | --- | --- |
| Unit | [job-transition.spec.ts](apps/job-server/src/modules/job/utils/job-transition.spec.ts) | TC-U-01 ~ 04 | 14 | ✅ 14/14 |
| Unit | [etag.spec.ts](apps/job-server/src/modules/job/utils/etag.spec.ts) | TC-U-05 ~ 06 | 9 | ✅ 9/9 |
| 저장소 | [job.repository.spec.ts](libs/core/src/database/repositories/job.repository.spec.ts) | TC-R-01 ~ 13 | 13 | ✅ 13/13 |
| 스케줄러 | [job-process-batch.usecase.spec.ts](apps/job-server/src/modules/scheduler/usecase/job-process-batch.usecase.spec.ts) | TC-S-01 ~ 10 | 10 | ✅ 10/10 |
| 스케줄러 | [job-process-cron.service.spec.ts](apps/job-server/src/modules/scheduler/cron/job-process-cron.service.spec.ts) | TC-C-01 ~ 05 | 5 | ✅ 5/5 |
| API (e2e) | [jobs.e2e-spec.ts](apps/job-server/test/jobs.e2e-spec.ts) | TC-A-01 ~ 39 | 54 | ✅ 54/54 |
| **합계** | | **73개 TC** | **105** | **✅ 105/105** |

> 한 TC가 여러 입력값으로 반복 실행되는 경우(`it.each`)가 있어서, TC 수보다 실제 실행 케이스 수가 많습니다.

**테스트 격리.** 모든 테스트는 OS 임시 디렉토리에 각자 `jobs.json`과 `logs.txt`를 만들어 씁니다. 레포 루트의 파일은 건드리지 않습니다.
스케줄러는 주기 실행을 끈 상태에서 테스트 코드가 직접 호출합니다. 처리 로직(`JobProcessor`)은 성공, 실패, 지연을 조절할 수 있는 테스트용 구현으로 바꿔 끼웁니다.

---

## 자동 테스트 TC 목록

### Unit — 상태 전이 규칙

| TC | 시나리오 | 입력 | 기대 결과 | 결과 |
| --- | --- | --- | --- | --- |
| TC-U-01 | 사용자에게 허용된 상태 전이 | `pending→canceled`, `failed→pending`, `failed→canceled` | 허용(true) | ✅ 3/3 |
| TC-U-02 | 사용자에게 금지된 상태 전이 | `pending→processing`, `pending→completed`, `processing→canceled`, `processing→pending`, `completed→pending`, `canceled→pending` | 거부(false) | ✅ 6/6 |
| TC-U-03 | 내용 수정이 가능한 상태 | `pending`, `failed` | 수정 가능(true) | ✅ 2/2 |
| TC-U-04 | 내용 수정이 불가능한 상태 | `processing`, `completed`, `canceled` | 수정 불가(false) | ✅ 3/3 |

### Unit — If-Match 헤더 파싱

| TC | 시나리오 | 입력 | 기대 결과 | 결과 |
| --- | --- | --- | --- | --- |
| TC-U-05 | 올바른 형식 | 헤더 없음, `*`, `"3"`, `W/"12"`, `␣"7"␣` | 없음/`*`는 버전 검사 생략, 나머지는 숫자 버전으로 변환 | ✅ 5/5 |
| TC-U-06 | 잘못된 형식 | `3`, `abc`, `"a"`, `"1", "2"` | 400 예외 | ✅ 4/4 |

### 저장소 — 영속화와 동시성

| TC | 시나리오 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| TC-R-01 | DB 파일이 없는 상태로 부팅 | `{ "jobs": [] }`로 파일을 만들고 빈 목록 반환 | ✅ |
| TC-R-02 | 기존 파일로 부팅 | 파일의 데이터를 그대로 읽음 | ✅ |
| TC-R-03 | JSON이 깨진 파일로 부팅 | 부팅 실패, 파일 내용은 그대로 보존(빈 데이터로 덮어쓰지 않음) | ✅ |
| TC-R-04 | 200건 동시 생성 | 메모리와 디스크 모두 200건, 유실 없음 | ✅ |
| TC-R-05 | 같은 Job을 동시에 100번 read-modify-write | `attempts=100`, `version=101` (lost update 없음) | ✅ |
| TC-R-06 | 트랜잭션 도중 예외 발생 | 변경 내용이 메모리와 디스크 모두에 반영되지 않음 | ✅ |
| TC-R-07 | 같은 배치에서 한 트랜잭션만 실패 | 실패한 것만 거부되고 나머지 2건은 저장됨 | ✅ |
| TC-R-08 | 50건 동시 쓰기 (group commit) | 50건 모두 저장, 디스크 쓰기 횟수는 50회 미만 | ✅ |
| TC-R-09 | 변경이 없는 트랜잭션 | 디스크 쓰기가 일어나지 않음 | ✅ |
| TC-R-10 | 조회 결과를 호출자가 수정 | DB에는 반영되지 않음 (복사본 반환) | ✅ |
| TC-R-11 | 없는 id 수정 | `null` 반환 | ✅ |
| TC-R-12 | 원자적 쓰기 20회 후 | 디렉토리에 `.tmp` 임시 파일이 남지 않음 | ✅ |
| TC-R-13 | 인스턴스 재시작 | 이전에 저장한 데이터가 유지됨 | ✅ |

### 스케줄러 — 배치 처리

| TC | 시나리오 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| TC-S-01 | pending 5건, 배치 크기 3 | 오래된 순서대로 3건만 처리 → `completed`, `attempts=1`, `version=3`. 나머지 2건은 `pending` 유지 | ✅ |
| TC-S-02 | `completed` / `canceled` / `failed`만 있는 상태 | 선점 0건, processor 호출 없음 | ✅ |
| TC-S-03 | 처리 실패 (최대 시도 2회) | 1회차 실패 → `pending` + `lastError` 기록, 2회차 실패 → `failed` + `finishedAt` 기록, 이후 주기에서는 처리 대상 아님 | ✅ |
| TC-S-04 | 1회차 실패 후 2회차 성공 | `completed`, `attempts=2`, `lastError=null` | ✅ |
| TC-S-05 | 처리 시간 초과 (제한 50ms) | 실패로 처리하고 `lastError`에 "시간 초과" 기록 | ✅ |
| TC-S-06 | 같은 배치에서 1건 성공, 1건 실패 | 서로 영향 없이 `completed` / `failed` | ✅ |
| TC-S-07 | 처리 중에 다른 Job 수정과 신규 생성 | 처리 중인 Job은 `processing`으로 저장되어 있고, 처리 중 들어온 수정과 생성이 모두 보존됨 | ✅ |
| TC-S-08 | 배치 2개를 동시에 실행 | 선점 합계 4건, 같은 Job이 중복 처리되지 않음 | ✅ |
| TC-S-09 | 처리 중에 Job이 외부 요인으로 `canceled`로 바뀜 | 처리 결과를 덮어쓰지 않고 `skipped=1`로 기록, 상태는 `canceled` 유지 | ✅ |
| TC-S-10 | 부팅 시 `processing` 상태로 남은 Job | 시도 횟수가 남았으면 `pending` + "재시작" 사유 기록, 소진했으면 `failed` | ✅ |

### 스케줄러 — 주기 실행

| TC | 시나리오 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| TC-C-01 | 스케줄러 활성화 여부 | 활성화하면 interval이 등록되고, 비활성화하면 등록되지 않음 | ✅ |
| TC-C-02 | 50ms 주기로 자동 실행 | 기다리면 배치가 자동으로 실행되어 1건 처리 | ✅ |
| TC-C-03 | 이전 배치가 진행 중일 때 다음 주기 도래 | 이번 주기는 건너뛰고 "건너뜀" 로그 기록, 이전 배치는 정상 완료 | ✅ |
| TC-C-04 | 배치 실행 중 예외 발생 | 스케줄러가 죽지 않고 에러 로그를 남기며, 다음 주기는 정상 실행 | ✅ |
| TC-C-05 | 처리 결과 로깅 | `logs.txt`에 배치 시작, 건별 처리 성공, 배치 완료 로그 기록 | ✅ |

### API — `POST /jobs`

| TC | 시나리오 | 입력 | 기대 결과 | 결과 |
| --- | --- | --- | --- | --- |
| TC-A-01 | 정상 생성 | `{"title":"  Task 1  ","description":"Do something"}` | 201, `Location: /jobs/{id}`, `ETag: "1"`, 제목 앞뒤 공백 제거, `pending`, 파일에 저장 | ✅ |
| TC-A-02 | description 생략 | `{"title":"only title"}` | 201, `description: ""` | ✅ |
| TC-A-03 | 필드 검증 실패 | title 누락 / 공백만 / 숫자 / 201자 / 정의되지 않은 필드(`status`) | 400 `VALIDATION_FAILED`, `details`에 문제 필드 표시 | ✅ 5/5 |
| TC-A-04 | 잘못된 JSON | `{bad json` | 400 `BAD_REQUEST` | ✅ |
| TC-A-05 | 50건 동시 생성 | POST 50건을 동시에 요청 | 목록 `total=50`, 파일에 중복 없이 50건 | ✅ |

### API — `GET /jobs`

| TC | 시나리오 | 입력 | 기대 결과 | 결과 |
| --- | --- | --- | --- | --- |
| TC-A-06 | 페이지네이션 | `?page=2&limit=2` (5건 중) | `meta: {total:5, page:2, limit:2, totalPages:3}`, 최신순 3·4번째 항목 | ✅ |
| TC-A-07 | 오래된 순 정렬 | `?order=asc&limit=1` | 가장 먼저 만든 Job | ✅ |
| TC-A-08 | 기본값 | 쿼리 없음 | `page=1`, `limit=20`, 전체 5건 | ✅ |
| TC-A-09 | 잘못된 쿼리 | `page=0`, `limit=0`, `limit=101`, `page=abc`, `order=up` | 400 `VALIDATION_FAILED` | ✅ 5/5 |

### API — `GET /jobs/search`

| TC | 시나리오 | 입력 | 기대 결과 | 결과 |
| --- | --- | --- | --- | --- |
| TC-A-10 | 제목 부분 일치 (대소문자 무시) | `?title=report` | `Daily Report`, `weekly report`, `Monthly REPORT` | ✅ |
| TC-A-11 | 상태 여러 개 (쉼표) | `?status=completed,failed` | 3건 (OR 조건) | ✅ |
| TC-A-12 | 상태 여러 개 (파라미터 반복) | `?status=pending&status=completed` | 2건 | ✅ |
| TC-A-13 | 제목 + 상태 | `?title=report&status=failed` | `Monthly REPORT` 1건 (AND 조건) | ✅ |
| TC-A-14 | 결과 없음 | `?title=nothing` | 200, `data: []`, `total: 0` | ✅ |
| TC-A-15 | 검색 조건 없음 | 쿼리 없음 | 400 `VALIDATION_FAILED` | ✅ |
| TC-A-16 | 존재하지 않는 상태 | `?status=done` | 400, `details[0].field = "status"` | ✅ |

### API — `GET /jobs/:id`

| TC | 시나리오 | 입력 | 기대 결과 | 결과 |
| --- | --- | --- | --- | --- |
| TC-A-17 | 정상 조회 | 존재하는 id | 200, 생성 응답과 같은 데이터, `ETag: "1"` | ✅ |
| TC-A-18 | UUID 형식이 아닌 id | `not-a-uuid` | 400 `VALIDATION_FAILED` | ✅ |
| TC-A-19 | 없는 id | 형식은 맞지만 없는 UUID | 404 `JOB_NOT_FOUND` | ✅ |

### API — `PATCH /jobs/:id`

| TC | 시나리오 | 입력 | 기대 결과 | 결과 |
| --- | --- | --- | --- | --- |
| TC-A-20 | 내용 수정 | pending Job에 title, description 변경 | 200, `version=2`, `ETag: "2"`, `updatedAt` 갱신 | ✅ |
| TC-A-21 | 변경 없는 수정 (멱등) | 같은 title을 다시 보냄 | 200, `version=1` 유지 | ✅ |
| TC-A-22 | 취소 | pending → `{"status":"canceled"}` | 200, `canceled`, `finishedAt` 기록 | ✅ |
| TC-A-23 | 실패 건 재시도 | failed(`attempts=3`) → `{"status":"pending"}` | 200, `attempts=0`, `lastError=null`, `finishedAt=null` | ✅ |
| TC-A-24 | 스케줄러 전용 상태 지정 | `status`: `processing` / `completed` / `failed` | 400 `VALIDATION_FAILED` | ✅ 3/3 |
| TC-A-25 | 금지된 전이 | canceled → pending | 409 `INVALID_STATUS_TRANSITION`, `details: {from, to, allowed: []}` | ✅ |
| TC-A-26 | 완료된 Job 내용 수정 | completed Job의 title 변경 | 409 `JOB_NOT_EDITABLE` | ✅ |
| TC-A-27 | 잘못된 body | 빈 body / `attempts` / `id` / 빈 title | 400 `VALIDATION_FAILED` | ✅ 4/4 |
| TC-A-28 | `null` 값 | `title: null` / `description: null` / `status: null` | 400 `VALIDATION_FAILED` (`null`로 저장되지 않음) | ✅ 3/3 |
| TC-A-29 | 없는 id | 형식은 맞지만 없는 UUID | 404 | ✅ |

### API — `If-Match` 낙관적 잠금

| TC | 시나리오 | 입력 | 기대 결과 | 결과 |
| --- | --- | --- | --- | --- |
| TC-A-30 | 버전 일치 | `If-Match: "1"` (현재 버전 1) | 200 | ✅ |
| TC-A-31 | 버전 불일치 | 버전 2인 Job에 `If-Match: "1"` | 412 `PRECONDITION_FAILED`, `details: {expectedVersion:1, currentVersion:2}`, 데이터는 바뀌지 않음 | ✅ |
| TC-A-32 | 같은 버전으로 동시 수정 | `If-Match: "1"` 요청 10건 동시 | 정확히 1건만 200, 나머지 9건은 412 | ✅ |
| TC-A-33 | 스케줄러가 먼저 변경 | 스케줄러가 처리한 뒤 이전 버전으로 취소 요청 | 412 | ✅ |
| TC-A-34 | 형식 오류 | `If-Match: abc` | 400 | ✅ |

### API — API와 스케줄러 동시 접근

| TC | 시나리오 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| TC-A-35 | 처리 중인 Job에 취소/수정 요청을 보내고, 동시에 신규 10건 생성 | 조회하면 `processing`, 취소/수정은 409, 처리 완료 후 전체 11건(완료 1 + 대기 10)으로 유실 없음 | ✅ |
| TC-A-36 | 20건 생성 후 스케줄러 tick 2회, PATCH 10건, POST 20건을 한꺼번에 실행 | 파일에 중복 없이 40건, 메모리 목록과 디스크 내용 일치 | ✅ |

### API — 공통

| TC | 시나리오 | 기대 결과 | 결과 |
| --- | --- | --- | --- |
| TC-A-37 | 정의되지 않은 라우트 | 404 `NOT_FOUND`, 공통 에러 포맷, `stack` 미노출 | ✅ |
| TC-A-38 | 요청 ID | 요청마다 `X-Request-Id` 발급, 클라이언트가 보낸 값은 그대로 사용 | ✅ |
| TC-A-39 | 요청 로깅 | 201 / 200 / 400(검증 실패) / 404(없는 라우트) / 400(JSON 파싱 실패)가 모두 `logs.txt`에 기록 | ✅ |

> 모든 에러 응답은 `{ statusCode, error, message, details?, path, timestamp, requestId }` 형식인지 함께 검증합니다.

---

## 수동 스모크 테스트

빌드한 서버(`dist/apps/job-server/main.js`)를 임시 디렉토리에서 레포의 샘플 `jobs.json`으로 실행하고, `curl`로 확인했습니다.
자동 테스트에서는 바꿔 끼우는 실제 처리 로직(`SimulatedJobProcessor`)과 **실제 1분 주기**를 확인하는 것이 목적입니다.

| TC | 시나리오 | 실제 결과 | 판정 |
| --- | --- | --- | --- |
| M-01 | 샘플 데이터 목록 조회 `GET /jobs` | 200, `total=7` | ✅ |
| M-02 | 샘플 검색 `title=us campus&status=pending,failed` | 200, 2건: US Campus 수료증 발급(pending), US Campus 강의 영상 인코딩(failed) | ✅ |
| M-03 | 작업 생성 `POST /jobs` ("US Plus 해지 예정 알림") | 201, `Location: /jobs/ad019bb9-…`, `ETag: "1"` | ✅ |
| M-04 | 생성한 작업 조회 `GET /jobs/:id` | 200 | ✅ |
| M-05 | 제목 수정 (`If-Match: "1"`) | 200, `version=2` | ✅ |
| M-06 | 이전 버전으로 수정 (`If-Match: "1"`) | 412 `PRECONDITION_FAILED` | ✅ |
| M-07 | `{"title": null}` 수정 | 400 `VALIDATION_FAILED` | ✅ |
| M-08 | 샘플 failed 작업 재시도 (`status: pending`) | 200, `attempts=0` | ✅ |
| M-09 | 샘플 canceled 작업을 pending으로 변경 | 409 `INVALID_STATUS_TRANSITION` | ✅ |
| M-10 | UUID 형식이 아닌 id 조회 | 400 `VALIDATION_FAILED` | ✅ |
| M-11 | 잘못된 JSON으로 생성 | 400 `BAD_REQUEST` | ✅ |
| M-12 | 실제 1분 주기 스케줄러 | 서버 시작 약 60초 후 첫 tick. pending 5건(샘플 3 + 신규 1 + 재시도 1) 모두 처리되어 `completed` 7건, `logs.txt`에 아래 로그 기록 | ✅ |

M-12에서 기록된 `logs.txt` (id 일부 생략):

```
2026-09-28T06:06:42.509Z [INFO] [Scheduler] 스케줄러 등록 intervalMs=60000 batchSize=10
2026-09-28T06:07:42.540Z [INFO] [Scheduler] 배치 시작 claimed=5 ids=...
2026-09-28T06:07:43.065Z [INFO] [Scheduler] job 처리 성공 id=83401e33-77ab-4b5e-a5c9-18898b965f4b
  ... (4건 동일)
2026-09-28T06:07:43.065Z [INFO] [Scheduler] 배치 완료 claimed=5 completed=5 retried=0 failed=0 skipped=0 durationMs=553
```

같은 실행에서 HTTP 요청 71건이 모두 `[HTTP]` 로그로 기록된 것도 확인했습니다. 이 71건에는 스케줄러 완료를 기다리며 보낸 폴링 요청이 포함되어 있습니다.

---

## 요구사항별 TC 매핑

| 요구사항 | 검증 TC |
| --- | --- |
| REST API 5종 (생성 / 목록 / 검색 / 단건 / 수정) | TC-A-01 ~ 34, M-01 ~ 11 |
| 상태 전이 규칙 | TC-U-01 ~ 04, TC-A-22 ~ 26, M-08, M-09 |
| 모든 요청을 `logs.txt`에 기록 | TC-A-39, M-12 |
| 스케줄러 주기 처리와 배치 단위 | TC-C-01 ~ 03, TC-S-01 ~ 06, TC-S-10, M-12 |
| 처리 결과를 `logs.txt`에 기록 | TC-C-04, TC-C-05, M-12 |
| 동시 접근 시 데이터 무결성 | TC-R-04 ~ 09, TC-S-07 ~ 09, TC-A-05, TC-A-32, TC-A-33, TC-A-35, TC-A-36 |
| JSON 파일 영속화 | TC-R-01 ~ 03, TC-R-12, TC-R-13 |
| HTTP 시맨틱에 맞는 상태 코드, 일관된 에러 응답 | TC-U-06, TC-A-03, 04, 09, 15, 16, 18, 19, 24 ~ 29, 31, 34, 37 |
| 샘플 데이터로 조회 동작 확인 | M-01, M-02 |

---

## 재현 방법

```bash
npm install
npm test                 # 자동 테스트 105개
npm run test:cov         # 커버리지 리포트 (coverage/)

# 수동 스모크
npm start                # http://localhost:3000
curl localhost:3000/jobs
# 약 1분 뒤 pending 샘플이 completed 로 바뀌고 logs.txt 에 배치 로그가 남습니다
npm run db:reset         # jobs.json 을 샘플 상태로 되돌림
```
