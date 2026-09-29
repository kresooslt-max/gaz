// Заменяемый провайдер: меняются только эти две функции.
// ВНИМАНИЕ: пути/заголовки Parallel (beta) сверьте с текущей документацией.
export interface WebResult { url: string; title: string; excerpts: string[] }
const H = () => ({ "Content-Type": "application/json", "x-api-key": Deno.env.get("PARALLEL_API_KEY")!, "parallel-beta": "search-extract-2025-10-10" });

export async function searchWeb(objective: string, queries: string[]): Promise<WebResult[]> {
  const r = await fetch("https://api.parallel.ai/v1beta/search", {
    method: "POST", headers: H(), signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ objective, search_queries: queries, max_results: 8, max_chars_per_result: 3000 }),
  });
  if (r.status === 429) throw new Error("RATE_LIMIT: Parallel");
  if (!r.ok) throw new Error(`WEB_SEARCH_UNAVAILABLE: ${r.status}`);
  const j = await r.json();
  return (j.results ?? []).map((x: any) => ({ url: x.url, title: x.title ?? x.url, excerpts: x.excerpts ?? [] }));
}

export async function researchPage(url: string, objective: string): Promise<WebResult | null> {
  const r = await fetch("https://api.parallel.ai/v1beta/extract", {
    method: "POST", headers: H(), signal: AbortSignal.timeout(60_000),
    body: JSON.stringify({ urls: [url], objective, excerpts: true }),
  });
  if (!r.ok) return null;
  const x = (await r.json()).results?.[0];
  return x ? { url: x.url, title: x.title ?? x.url, excerpts: x.excerpts ?? [] } : null;
}

// Запросы строятся из ВСЕХ данных RIV, а не только из артикула.
export function buildQueries(a: { article: string; title: string|null; description_raw: string; category_raw: string|null }) {
  const desc = a.description_raw.replace(/\s+/g, " ").trim().slice(0, 160);
  const t = a.title ?? "";
  return [
    `"${a.article}" "${t}" ${desc}`,
    `"${a.article}" ${t} OEM`,
    `"${a.article}" ${desc} автомобиль`,
    `"${a.article}" ${desc} модель двигатель`,
    ...(a.category_raw ? [`"${a.article}" ${a.category_raw} применяемость`] : []),
  ];
}
