import { buildOrderBy, buildPage, toSkipTake } from './paginate';

describe('pagination helpers', () => {
  const q = (page: number, pageSize: number) => ({ page, pageSize, sortOrder: 'desc' as const });

  it('computes skip/take from page and pageSize', () => {
    expect(toSkipTake(q(1, 20))).toEqual({ skip: 0, take: 20 });
    expect(toSkipTake(q(4, 25))).toEqual({ skip: 75, take: 25 });
  });

  it('builds meta with a rounded-up page count', () => {
    expect(buildPage(['a'], 41, q(1, 20)).meta).toEqual({
      page: 1,
      pageSize: 20,
      total: 41,
      totalPages: 3,
    });
    expect(buildPage([], 0, q(1, 20)).meta.totalPages).toBe(0);
  });

  it('always adds id as a tie-breaker so ordering is deterministic', () => {
    expect(buildOrderBy('createdAt', 'desc')).toEqual([{ createdAt: 'desc' }, { id: 'desc' }]);
    expect(buildOrderBy('name', 'asc')).toEqual([{ name: 'asc' }, { id: 'asc' }]);
    expect(buildOrderBy('id', 'asc')).toEqual([{ id: 'asc' }]);
  });
});
