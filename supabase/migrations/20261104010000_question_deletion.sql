-- Permanent question deletion removes stored answers; only an inactive binding
-- remains so legacy information inputs cannot reappear through default settings.
alter table public.inspection_points add column if not exists is_deleted boolean not null default false;
alter table public.fire_inspection_points add column if not exists is_deleted boolean not null default false;
alter table public.firstaid_inspection_points add column if not exists is_deleted boolean not null default false;
alter table public.inspections alter column inspection_date drop not null;
alter table public.fire_inspections alter column inspection_date drop not null;
alter table public.firstaid_inspections alter column inspection_date drop not null;

-- Serialize submissions with deletion. A response started before deletion must
-- not be able to recreate the removed answer after the deletion commits.
create or replace function public.reject_deleted_question_answers()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  points_table text;
  deleted boolean;
begin
  points_table := case TG_TABLE_NAME
    when 'inspection_results' then 'inspection_points'
    when 'fire_inspection_results' then 'fire_inspection_points'
    when 'firstaid_inspection_results' then 'firstaid_inspection_points'
  end;
  execute format('select is_deleted from public.%I where id=$1 for key share', points_table)
    into deleted using NEW.inspection_point_id;
  if coalesce(deleted, false) then raise exception 'This question was permanently deleted. Reload the inspection form.'; end if;
  return NEW;
end;
$$;
drop trigger if exists reject_deleted_question_answers on public.inspection_results;
create trigger reject_deleted_question_answers before insert or update on public.inspection_results
  for each row execute function public.reject_deleted_question_answers();
drop trigger if exists reject_deleted_question_answers on public.fire_inspection_results;
create trigger reject_deleted_question_answers before insert or update on public.fire_inspection_results
  for each row execute function public.reject_deleted_question_answers();
drop trigger if exists reject_deleted_question_answers on public.firstaid_inspection_results;
create trigger reject_deleted_question_answers before insert or update on public.firstaid_inspection_results
  for each row execute function public.reject_deleted_question_answers();

create or replace function public.submit_configured_inspection(inspection_mode text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  points_table text;
  options_table text;
  inspections_table text;
  results_table text;
  config jsonb;
  field jsonb;
  question jsonb;
  answer jsonb;
  choice jsonb;
  settings jsonb := '{}'::jsonb;
  valid_answers jsonb := '[]'::jsonb;
  field_name text;
  legacy_required text[];
  v_submission_key uuid := (payload->>'submission_key')::uuid;
  inspection_id uuid;
  overall text := 'PASS';
  is_failure boolean;
begin
  case inspection_mode
    when 'ladder' then
      points_table := 'inspection_points'; options_table := 'question_options'; inspections_table := 'inspections'; results_table := 'inspection_results';
      legacy_required := array['inspector_name', 'ladder_no', 'section', 'height_feet', 'ladder_type'];
    when 'fire' then
      points_table := 'fire_inspection_points'; options_table := 'fire_question_options'; inspections_table := 'fire_inspections'; results_table := 'fire_inspection_results';
      legacy_required := array['inspector_name', 'point_no', 'location', 'quantity', 'extinguisher_type'];
    when 'firstaid' then
      points_table := 'firstaid_inspection_points'; options_table := 'firstaid_question_options'; inspections_table := 'firstaid_inspections'; results_table := 'firstaid_inspection_results';
      legacy_required := array['inspector_name', 'box_no', 'location'];
    else raise exception 'Invalid inspection mode';
  end case;
  if v_submission_key is null then raise exception 'Submission key is required'; end if;
  execute format('select id, overall_result from public.%I where submission_key=$1', inspections_table)
    into inspection_id, overall using v_submission_key;
  if inspection_id is not null then return jsonb_build_object('id', inspection_id, 'overall_result', overall); end if;
  overall := 'PASS';
  config := public.get_inspection_questionnaire(jsonb_build_object('mode', inspection_mode));
  for field in select value from jsonb_array_elements(config->'fields') loop
    field_name := public.inspection_payload_field(inspection_mode, field->>'field_key');
    if field_name is null then continue; end if;
    settings := settings || jsonb_build_object(field_name, field);
    if not (field->>'is_active')::boolean then
      payload := payload || jsonb_build_object(field_name, null);
    elsif (field->>'is_required')::boolean and nullif(btrim(payload->>field_name), '') is null then
      raise exception '% is required', field->>'question';
    elsif nullif(btrim(payload->>field_name), '') is not null and jsonb_array_length(field->'options') > 0
      and not exists (select 1 from jsonb_array_elements(field->'options') o where o->>'option_value' = payload->>field_name) then
      raise exception 'Invalid value for %', field->>'question';
    end if;
  end loop;
  foreach field_name in array legacy_required loop
    if not (settings ? field_name) and nullif(btrim(payload->>field_name), '') is null then raise exception '% is required', field_name; end if;
  end loop;
  if inspection_mode = 'ladder' and nullif(payload->>'ladder_type', '') is not null and payload->>'ladder_type' not in ('extension', 'step') then raise exception 'Invalid ladder type'; end if;
  if jsonb_typeof(coalesce(payload->'results', '[]'::jsonb)) <> 'array' then raise exception 'Results must be an array'; end if;

  -- Validate only currently active checklist points. Information fields are validated above.
  for question in select value from jsonb_array_elements(config->'questions') loop
    if inspection_mode = 'ladder' and question->>'category' not in ('general', coalesce(payload->>'ladder_type', '')) then continue; end if;
    select value into answer from jsonb_array_elements(coalesce(payload->'results', '[]'::jsonb)) a where a->>'point_id' = question->>'id' limit 1;
    if answer is null or nullif(btrim(answer->>'result'), '') is null then
      if (question->>'is_required')::boolean then raise exception 'Answer required: %', question->>'question'; end if;
      continue;
    end if;
    select value into choice from jsonb_array_elements(question->'options') o where o->>'option_value' = answer->>'result' limit 1;
    if choice is null then raise exception 'Invalid answer: %', question->>'question'; end if;
    is_failure := coalesce((choice->>'is_fail_value')::boolean, false) or answer->>'result' in ('FAIL', 'EXPIRED');
    if is_failure and nullif(btrim(answer->>'remarks'), '') is null then raise exception 'A remark is required: %', question->>'question'; end if;
    if is_failure then overall := 'FAIL'; end if;
    valid_answers := valid_answers || jsonb_build_array(jsonb_build_object(
      'point_id', question->'id', 'question', question->>'question', 'category', question->>'category',
      'display_order', question->'display_order', 'result', case when answer->>'result' in ('PASS', 'FAIL', 'N/A', 'EXPIRED') then answer->>'result' when is_failure then 'FAIL' else 'PASS' end,
      'answer_label', choice->>'option_label', 'remarks', nullif(btrim(answer->>'remarks'), '')));
  end loop;

  if inspection_mode = 'ladder' then
    insert into public.inspections (inspector_name, epf_number, inspection_date, ladder_no, section, height_feet, ladder_type, overall_result, remarks, submission_key)
    values (nullif(btrim(payload->>'inspector_name'), ''), nullif(btrim(payload->>'epf_number'), ''), case when coalesce((settings->'inspection_date'->>'is_deleted')::boolean, false) then null else coalesce(nullif(payload->>'inspection_date', '')::date, current_date) end,
      nullif(btrim(payload->>'ladder_no'), ''), nullif(btrim(payload->>'section'), ''), nullif(payload->>'height_feet', '')::numeric,
      nullif(payload->>'ladder_type', ''), overall, nullif(btrim(payload->>'remarks'), ''), v_submission_key)
    on conflict (submission_key) do nothing returning id into inspection_id;
  elsif inspection_mode = 'fire' then
    insert into public.fire_inspections (inspector_name, epf_number, inspection_date, point_no, location, quantity, extinguisher_type, pressure_weight, overall_result, remarks, submission_key)
    values (nullif(btrim(payload->>'inspector_name'), ''), nullif(btrim(payload->>'epf_number'), ''), case when coalesce((settings->'inspection_date'->>'is_deleted')::boolean, false) then null else coalesce(nullif(payload->>'inspection_date', '')::date, current_date) end,
      nullif(btrim(payload->>'point_no'), ''), nullif(btrim(payload->>'location'), ''), nullif(btrim(payload->>'quantity'), ''),
      nullif(btrim(payload->>'extinguisher_type'), ''), nullif(btrim(payload->>'pressure_weight'), ''), overall, nullif(btrim(payload->>'remarks'), ''), v_submission_key)
    on conflict (submission_key) do nothing returning id into inspection_id;
  else
    insert into public.firstaid_inspections (inspector_name, epf_number, inspection_date, box_no, location, overall_result, remarks, submission_key)
    values (nullif(btrim(payload->>'inspector_name'), ''), nullif(btrim(payload->>'epf_number'), ''), case when coalesce((settings->'inspection_date'->>'is_deleted')::boolean, false) then null else coalesce(nullif(payload->>'inspection_date', '')::date, current_date) end,
      nullif(btrim(payload->>'box_no'), ''), nullif(btrim(payload->>'location'), ''), overall, nullif(btrim(payload->>'remarks'), ''), v_submission_key)
    on conflict (submission_key) do nothing returning id into inspection_id;
  end if;
  if inspection_id is null then
    execute format('select id, overall_result from public.%I where submission_key=$1', inspections_table) into inspection_id, overall using v_submission_key;
    return jsonb_build_object('id', inspection_id, 'overall_result', overall);
  end if;
  for answer in select value from jsonb_array_elements(valid_answers) loop
    if inspection_mode = 'ladder' then
      insert into public.inspection_results (inspection_id, inspection_point_id, category_snapshot, question_text_snapshot, display_order_snapshot, result, answer_label, remarks)
      values (inspection_id, (answer->>'point_id')::integer, answer->>'category', answer->>'question', (answer->>'display_order')::integer, answer->>'result', answer->>'answer_label', answer->>'remarks');
    else
      execute format('insert into public.%I (inspection_id, inspection_point_id, question_text_snapshot, display_order_snapshot, result, answer_label, remarks) values ($1,$2,$3,$4,$5,$6,$7)', results_table)
      using inspection_id, (answer->>'point_id')::integer, answer->>'question', (answer->>'display_order')::integer, answer->>'result', answer->>'answer_label', answer->>'remarks';
    end if;
  end loop;
  return jsonb_build_object('id', inspection_id, 'overall_result', overall);
end;
$$;


revoke all on function public.submit_configured_inspection(text, jsonb) from public;
notify pgrst, 'reload schema';
