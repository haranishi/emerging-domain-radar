/**
 * `searchParams`（Next.js 16 では Promise で渡るプレーンオブジェクト）を
 * `URLSearchParams` に直す。フィルターの解釈は `parseKeywordFilters` 1 か所に任せたいので、
 * 画面も Route Handler も同じ `URLSearchParams` を渡す（architecture §8）。
 */
export type SearchParamsRecord = Record<string, string | string[] | undefined>;

export function toURLSearchParams(record: SearchParamsRecord): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      for (const one of value) params.append(key, one);
    } else {
      params.set(key, value);
    }
  }
  return params;
}

export function firstValue(value: string | string[] | undefined): string | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value[0] : value;
}
