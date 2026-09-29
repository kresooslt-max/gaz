// Запуск: SUPABASE_URL=... SUPABASE_ANON_KEY=... deno test -A tests/pipeline.test.ts
// Реальные вызовы: RIV worker -> Parallel -> AI. Никаких моков.
import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
const U = Deno.env.get("SUPABASE_URL")!, K = Deno.env.get("SUPABASE_ANON_KEY")!;
const post = (fn: string, body: unknown) => fetch(`${U}/functions/v1/${fn}`, {
  method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${K}` }, body: JSON.stringify(body) });

for (const article of ["HLT-505", "YCK-813"]) {
  Deno.test({ name: `pipeline ${article}`, sanitizeOps: false, sanitizeResources: false }, async () => {
    const r1 = await post("riv-search", { article });
    const b1 = await r1.json();
    // КРИТИЧНО: TOOLTIP_NOT_READ = FAIL, а не «описание отсутствует».
    assert(r1.ok, `RIV этап упал: ${JSON.stringify(b1.error)}`);
    const riv = b1.riv;
    assertEquals(riv.article.toUpperCase(), article);
    assert(riv.photos.length > 0, "нет фото");
    assert(riv.title, "нет title");
    assert(riv.description_raw.trim().length > 0, "description_raw пуст");
    assert(riv.category_raw || riv.category_path_raw, "категория не получена (проверьте логи воркера)");
    for (const k of ["oem", "price", "vehicle_fitment", "confidence"]) assert(!(k in riv), `в riv_raw просочилось ${k}`);

    const r2 = await post("decode", { job_id: b1.job_id });
    const b2 = await r2.json();
    assert(r2.ok, `decode упал: ${b2.error}`);
    assert(b2.result.sources.length > 0, "нет источников");
    assert(b2.result.product_type !== undefined);
    assert(b2.ozon_description_plain.length > 0 && b2.ozon_title.includes(article), "Ozon-описание не создано");
  });
}
