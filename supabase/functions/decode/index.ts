import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { searchWeb, buildQueries } from "../_shared/webResearch.ts";
import { generateOzonDescription } from "../_shared/ozonTemplate.ts";
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

const SYSTEM = `Ты извлекаешь факты об автозапчасти ТОЛЬКО из предоставленных web-фрагментов.
Правила: не угадывай; нет подтверждения — null; артикул RIV не равен OEM; каждый факт обязан иметь source_url из списка
источников и дословный evidence; противоречия выноси в conflicts. Отвечай строго JSON:
{"product_type":str|null,"summary":str|null,"category":{"normalized":str|null,"ozon_suggestion":str|null,"basis":str|null},
"vehicle_fitment":[{"brand","model","generation","years","body","engine","fuel","notes","source_url","evidence"}],
"oem":[{"value","source_url","evidence"}],"manufacturer_part_numbers":[{"value","source_url","evidence"}],
"price":{"value":num|null,"currency":str|null,"source_url":str|null},"important_facts":[{"fact","source_url","evidence"}],
"conflicts":[str],"warnings":[str]}`;

async function ai(prompt: string) {
  const r = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", { // при смене провайдера меняется только это
    method: "POST", signal: AbortSignal.timeout(120_000),
    headers: { Authorization: `Bearer ${Deno.env.get("LOVABLE_API_KEY")}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: "google/gemini-2.5-pro", response_format: { type: "json_object" },
      messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] }),
  });
  if (r.status === 429) throw new Error("RATE_LIMIT: AI");
  if (!r.ok) throw new Error(`AI_UNAVAILABLE: ${r.status}`);
  return JSON.parse((await r.json()).choices[0].message.content);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 204);
  const { job_id } = await req.json();
  const sb = db();
  const { data: job } = await sb.from("product_jobs").select().eq("id", job_id).single();
  const riv = job?.riv_raw;
  if (!riv?.description_raw?.trim()) return json({ error: "У задачи нет description_raw — второй этап запрещён" }, 409);
  try {
    await sb.from("product_jobs").update({ status: "researching_web" }).eq("id", job_id);
    const queries = buildQueries(riv);
    const results = await searchWeb(`Определить деталь, применяемость, OEM и партномера по артикулу ${riv.article}. Данные RIV: ${riv.title}; ${riv.description_raw}`, queries);
    if (!results.length) throw new Error("WEB_SEARCH_UNAVAILABLE: пустая выдача");
    await sb.from("product_jobs").update({ web_results: { queries, results }, status: "ai_processing" }).eq("id", job_id);

    const evidence = results.map((r, i) => `[${i}] ${r.url}\n${r.title}\n${r.excerpts.join("\n")}`).join("\n\n");
    const ctx = { article: riv.article, title: riv.title, description_raw: riv.description_raw,
                  category_raw: riv.category_raw, category_path_raw: riv.category_path_raw };
    const out = await ai(`ДАННЫЕ RIV:\n${JSON.stringify(ctx)}\n\nВЕБ-ФРАГМЕНТЫ:\n${evidence}`);

    // Анти-галлюцинации: отбрасываем всё, чей source_url не из реальной выдачи Parallel.
    const ok = new Set(results.map((r) => r.url));
    const keep = <T extends { source_url?: string | null }>(a: T[] = []) => a.filter((x) => x.source_url && ok.has(x.source_url));
    const dropped = [out.vehicle_fitment, out.oem, out.manufacturer_part_numbers, out.important_facts]
      .reduce((n, a) => n + (a?.length ?? 0) - keep(a).length, 0);
    const result = {
      product_type: out.product_type ?? null, summary: out.summary ?? null,
      riv_context: { article: riv.article, title: riv.title, category_raw: riv.category_raw, category_normalized: out.category?.normalized ?? null },
      vehicle_fitment: keep(out.vehicle_fitment), oem: keep(out.oem), manufacturer_part_numbers: keep(out.manufacturer_part_numbers),
      price: out.price?.source_url && ok.has(out.price.source_url) ? out.price : { value: null, currency: null, source_url: null },
      category: { riv_category: riv.category_raw, normalized_category: out.category?.normalized ?? null,
                  ozon_suggestion: out.category?.ozon_suggestion ?? "Требует ручной проверки", basis: out.category?.basis ?? null,
                  source: riv.category_raw ? "RIV" : "WEB_AI" },
      important_facts: keep(out.important_facts), conflicts: out.conflicts ?? [],
      warnings: [...(out.warnings ?? []), ...(dropped ? [`Отброшено фактов без реального источника: ${dropped}`] : [])],
      sources: results.map((r) => ({ title: r.title, url: r.url, used_for: "web evidence" })),
    };
    const ozon = generateOzonDescription({
      article: riv.article, product_type: result.product_type, summary: result.summary,
      fitment: result.vehicle_fitment, oem: result.oem.map((x: any) => x.value),
      mpn: result.manufacturer_part_numbers.map((x: any) => x.value), warnings: result.warnings,
    });
    await sb.from("product_jobs").update({ ai_result: result, ...ozon, status: "completed" }).eq("id", job_id);
    return json({ job_id, result, ...ozon });
  } catch (e) {
    await sb.from("product_jobs").update({ status: "error", errors: [{ message: String(e) }] }).eq("id", job_id);
    return json({ error: String(e) }, 502);
  }
});
