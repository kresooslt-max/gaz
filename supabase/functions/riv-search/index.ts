import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { rivSearch, RivError } from "../_shared/rivWorkerClient.ts";
const db = () => createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 204);
  const { article } = await req.json();
  if (!article?.trim()) return json({ error: "article required" }, 400);
  const sb = db();
  const { data: job } = await sb.from("product_jobs").insert({ article: article.trim() }).select().single();
  try {
    const raw = await rivSearch(article.trim());
    console.log(`RIV_SEARCH article=${raw.article} url=${raw.riv_url} found=true title=${raw.title} description_len=${raw.description_raw?.length} category=${raw.category_raw} photos=${raw.photos.length}`);
    await sb.from("product_jobs").update({ riv_raw: raw, status: "riv_found" }).eq("id", job.id);
    // Только исходные данные RIV — никаких OEM/цен/AI на первом этапе.
    return json({ job_id: job.id, riv: raw });
  } catch (e) {
    const err = e instanceof RivError ? e : new RivError("WORKER_UNAVAILABLE", String(e));
    console.log(`RIV_SEARCH article=${article} found=false code=${err.code}`);
    // При TOOLTIP_NOT_READ сохраняем то, что удалось получить, но статус — сбой.
    await sb.from("product_jobs").update({ status: "riv_failed", errors: [{ code: err.code, message: err.message }] }).eq("id", job.id);
    return json({ job_id: job.id, error: { code: err.code, message: err.message, partial: (err.raw as any)?.raw ?? null } }, 422);
  }
});
