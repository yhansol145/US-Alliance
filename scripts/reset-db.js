/**
 * jobs.json 을 샘플 데이터로 되돌린다.
 * 서버를 실행하면 스케줄러가 pending 샘플을 처리하므로, 조회 동작을 다시 확인할 때 사용한다.
 */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
fs.copyFileSync(
  path.join(__dirname, 'jobs.sample.json'),
  path.join(root, 'jobs.json'),
);
console.log('jobs.json 을 샘플 데이터로 초기화했습니다.');
