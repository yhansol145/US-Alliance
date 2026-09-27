import { Job, PaginatedResponse } from '@app/core';

import { SortOrder } from '../dto';

export const sortByCreatedAt = (jobs: Job[], order: SortOrder) => {
  const direction = order === 'asc' ? 1 : -1;
  return [...jobs].sort(
    (a, b) =>
      direction * a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
};

export const paginate = (
  jobs: Job[],
  page: number,
  limit: number,
): PaginatedResponse<Job> => ({
  data: jobs.slice((page - 1) * limit, page * limit),
  meta: {
    total: jobs.length,
    page,
    limit,
    totalPages: Math.ceil(jobs.length / limit),
  },
});
