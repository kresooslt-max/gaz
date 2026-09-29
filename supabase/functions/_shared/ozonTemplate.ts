// Единственное место, где редактируется шаблон Ozon. В шаблон попадают ТОЛЬКО подтверждённые поля.
export interface Verified {
  article: string; product_type: string|null; summary: string|null;
  fitment: { brand?: string|null; model?: string|null; generation?: string|null; years?: string|null;
             body?: string|null; engine?: string|null; fuel?: string|null }[];
  oem: string[]; mpn: string[]; warnings: string[];
}
const L = (label: string, v?: string|null) => v ? `${label}: ${v}` : null;

export function generateOzonDescription(d: Verified) {
  const f = d.fitment[0] ?? {};
  const title = [d.product_type, f.brand, f.model, f.generation, f.body, f.engine].filter(Boolean).join(" ") + ` — ${d.article}`;
  const fit = d.fitment.length
    ? d.fitment.map((x) => [L("Марка", x.brand), L("Модель", x.model), L("Поколение", x.generation), L("Годы", x.years),
        L("Кузов", x.body), L("Двигатель", x.engine), L("Топливо", x.fuel)].filter(Boolean).join("\n")).join("\n\n")
    : "Применяемость не подтверждена";
  const plain = [
    "ОПИСАНИЕ:", d.summary ?? d.product_type ?? "Не подтверждено", "",
    "ПРИМЕНЯЕМОСТЬ:", fit, "",
    "АРТИКУЛ:", d.article, "",
    "OEM / ОРИГИНАЛЬНЫЕ НОМЕРА:", d.oem.join(", ") || "не подтверждено", "",
    "ПАРТНОМЕР ПРОИЗВОДИТЕЛЯ:", d.mpn.join(", ") || "не подтверждено",
    ...(d.warnings.length ? ["", "ВАЖНО:", ...d.warnings] : []),
  ].join("\n");
  return { ozon_title: title, ozon_description: plain, ozon_description_plain: plain };
}
