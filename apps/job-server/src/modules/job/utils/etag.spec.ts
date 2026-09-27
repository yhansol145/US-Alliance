import { AppException } from '@app/core';

import { parseIfMatch } from './etag';

describe('parseIfMatch', () => {
  it.each([
    [undefined, undefined],
    ['*', undefined],
    ['"3"', 3],
    ['W/"12"', 12],
    [' "7" ', 7],
  ])('%p → %p', (header, expected) => {
    expect(parseIfMatch(header)).toBe(expected);
  });

  it.each(['3', 'abc', '"a"', '"1", "2"'])(
    '잘못된 형식 %p 은 400',
    (header) => {
      expect(() => parseIfMatch(header)).toThrow(AppException);
    },
  );
});
