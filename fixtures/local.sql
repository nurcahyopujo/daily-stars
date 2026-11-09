-- Synthetic local data only. Repeatable and separate from schema migrations.
-- Stable UUIDs make repeated inserts harmless; existing revisions are preserved.
INSERT INTO children (id, display_name, start_date, revision, created_at) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Sunny', '2026-11-09', 1, '2026-11-09T00:00:00Z'),
  ('22222222-2222-4222-8222-222222222222', 'Robin', '2026-11-09', 1, '2026-11-09T00:00:00Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO templates (id, created_at) VALUES
  ('33333333-3333-4333-8333-333333333333', '2026-11-09T00:00:00Z')
ON CONFLICT(id) DO NOTHING;

INSERT INTO template_versions
  (template_id, revision, effective_date, name, retired, activities_json, actor_id, actor_email, recorded_at_utc)
VALUES (
  '33333333-3333-4333-8333-333333333333', 1, '2026-11-09', 'Morning routine', 0,
  '[{"id":"44444444-4444-4444-8444-444444444444","label":"Make the bed","reward":5,"penalty":0,"weekdays":[1,2,3,4,5,6,7]},{"id":"55555555-5555-4555-8555-555555555555","label":"Pack the school bag","reward":3,"penalty":1,"weekdays":[1,2,3,4,5]}]',
  '66666666-6666-4666-8666-666666666666', 'parent@example.test', '2026-11-09T00:00:00Z'
)
ON CONFLICT(template_id, revision) DO NOTHING;

INSERT INTO assignment_versions
  (child_id, revision, effective_date, template_ids_json, actor_id, actor_email, recorded_at_utc)
VALUES
  ('11111111-1111-4111-8111-111111111111', 1, '2026-11-09', '["33333333-3333-4333-8333-333333333333"]', '66666666-6666-4666-8666-666666666666', 'parent@example.test', '2026-11-09T00:00:00Z'),
  ('22222222-2222-4222-8222-222222222222', 1, '2026-11-09', '["33333333-3333-4333-8333-333333333333"]', '66666666-6666-4666-8666-666666666666', 'parent@example.test', '2026-11-09T00:00:00Z')
ON CONFLICT(child_id, revision) DO NOTHING;
