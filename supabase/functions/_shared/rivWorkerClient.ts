// Единственная точка связи с Render-воркером. Воркер — единственный, кто открывает RIV.KZ.
export interface RivRaw {
  article: string; title: string | null; description_raw: string | null;
  category_raw: string | null; category_path_raw: string | null;
  photos: string[]; riv_url: string | null; scraped_at: string;
}
export class RivError extends Error {
  constructor(public code: "WORKER_UNAVAILABLE"|"WORKER_AUTH"|"RIV_LOGIN_FAILED"|"ARTICLE_NOT_FOUND"|"TIMEOUT"|"TOOLTIP_NOT_READ",
              msg: string, public raw?: unknown) { super(msg); }
}
const BASE = Deno.env.get("RIV_WORKER_URL") ?? "https://startauto-riv.onrender.com";
const pick = (o: any, keys: string[]) => { for (const k of keys) if (o?.[k] != null && o[k] !== "") return o[k]; return null; };
const BAD_IMG = /logo|favicon|sprite|icon|\.svg|data:image\/svg/i;

async function call(article: string, attempt = 1): Promise<Response> {
  try {
    return await fetch(`${BASE}/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${Deno.env.get("RIV_WORKER_TOKEN")}` },
      body: JSON.stringify({ article }),
      signal: AbortSignal.timeout(150_000), // Render cold start + логин + hover
    });
  } catch (e) {
    if (attempt < 2) return call(article, attempt + 1);
    throw new RivError(e instanceof DOMException && e.name === "TimeoutError" ? "TIMEOUT" : "WORKER_UNAVAILABLE", String(e));
  }
}

export async function rivSearch(article: string): Promise<RivRaw> {
  const res = await call(article);
  const body = await res.json().catch(() => null);
  if (res.status === 401 || res.status === 403) throw new RivError("WORKER_AUTH", "Неверный RIV_WORKER_TOKEN", body);
  if (!res.ok) {
    const msg = JSON.stringify(body)?.toLowerCase() ?? "";
    if (msg.includes("login")) throw new RivError("RIV_LOGIN_FAILED", "Воркеру не удался вход в RIV", body);
    if (res.status === 404 || msg.includes("not found")) throw new RivError("ARTICLE_NOT_FOUND", "Артикул не найден в RIV", body);
    throw new RivError("WORKER_UNAVAILABLE", `Воркер вернул ${res.status}`, body);
  }
  const d = body?.data ?? body?.card ?? body?.result ?? body;
  if (d?.found === false) throw new RivError("ARTICLE_NOT_FOUND", "Артикул не найден в RIV", body);

  const photos: string[] = [...new Set(
    ((pick(d, ["photos", "images"]) ?? []) as any[]).map((p) => typeof p === "string" ? p : p?.url)
      .filter((u): u is string => !!u && !BAD_IMG.test(u)))].slice(0, 12);

  const desc = pick(d, ["description_raw", "description", "tooltip", "internal_description"]);
  const raw: RivRaw = {
    article: pick(d, ["article"]) ?? article,
    title: pick(d, ["title", "name"]),
    description_raw: typeof desc === "string" ? desc : null, // без trim/переписывания: переносы строк сохраняются
    category_raw: pick(d, ["category_raw", "category"]),
    category_path_raw: Array.isArray(d?.category_path_raw) ? d.category_path_raw.join(" > ") : pick(d, ["category_path_raw", "category_path", "breadcrumbs"]),
    photos, riv_url: pick(d, ["riv_url", "url"]), scraped_at: new Date().toISOString(),
  };
  // Пустое описание — это НЕ «в RIV нет описания», а сбой извлечения.
  if (!raw.description_raw || raw.description_raw.trim() === "")
    throw new RivError("TOOLTIP_NOT_READ", "Артикул найден, но tooltip/внутреннее описание RIV прочитать не удалось", { raw, worker: body });
  return raw;
}
