create table product_jobs (
  id uuid primary key default gen_random_uuid(),
  article text not null,
  status text not null default 'searching_riv' check (status in
    ('searching_riv','riv_found','riv_failed','researching_web','ai_processing','completed','error')),
  riv_raw jsonb,            -- неизменяемый после записи
  web_results jsonb,
  ai_result jsonb,
  ozon_title text,
  ozon_description text,
  ozon_description_plain text,
  errors jsonb not null default '[]',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create or replace function protect_riv_raw() returns trigger as $$
begin
  if old.riv_raw is not null and new.riv_raw is distinct from old.riv_raw then
    raise exception 'riv_raw is immutable';
  end if;
  new.updated_at = now();
  return new;
end $$ language plpgsql;
create trigger trg_protect_riv_raw before update on product_jobs
  for each row execute function protect_riv_raw();
alter table product_jobs enable row level security; -- доступ только через service role (edge functions)
