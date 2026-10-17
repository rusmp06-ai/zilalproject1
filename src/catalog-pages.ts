/** Never turn an incomplete catalog into plausible totals or missing accounts. */
export async function catalogPages<T>(
  page: (offset: number, limit: number) => Promise<T[]>,
  limit = 500,
) {
  if (!Number.isInteger(limit) || limit < 1) throw Error('Некорректный размер страницы.');
  const items: T[] = [];
  for (let offset = 0; ; offset += limit) {
    const rows = await page(offset, limit);
    items.push(...rows);
    if (rows.length < limit) return items;
    if (offset >= 200000) throw Error('Слишком много записей. Сузьте выборку.');
  }
}
