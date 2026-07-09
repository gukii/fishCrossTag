pragma journal_mode = wal;
pragma foreign_keys = on;

create table if not exists image_batches (
  id text primary key,
  name text not null,
  source text,
  status text not null default 'open',
  created_at text not null
);

create table if not exists images (
  id text primary key,
  batch_id text references image_batches(id) on delete set null,
  original_key text not null,
  width integer not null,
  height integer not null,
  checksum text not null,
  split text check (split in ('train', 'val', 'test')),
  created_at text not null
);

create table if not exists queues (
  id text primary key,
  name text not null,
  description text not null,
  required_replicates integer not null default 1,
  created_at text not null
);

create table if not exists tagger_sessions (
  id text primary key,
  external_image_id text not null,
  image_url text not null,
  image_name text,
  image_width integer,
  image_height integer,
  webhook_url text,
  return_url text,
  metadata_json text,
  options_json text,
  draft_json text,
  result_json text,
  status text not null default 'open',
  created_at text not null,
  updated_at text not null,
  completed_at text
);

create table if not exists annotation_tasks (
  id text primary key,
  image_id text not null references images(id) on delete cascade,
  queue_id text not null references queues(id) on delete restrict,
  status text not null default 'queued',
  required_replicates integer not null default 1,
  completed_replicates integer not null default 0,
  assigned_to text,
  created_at text not null,
  updated_at text not null
);

create table if not exists annotation_results (
  id text primary key,
  task_id text not null references annotation_tasks(id) on delete cascade,
  user_id text,
  annotation_json text not null,
  bucket_json text not null,
  status text not null default 'submitted',
  created_at text not null
);

create table if not exists model_predictions (
  id text primary key,
  image_id text not null references images(id) on delete cascade,
  model_version_id text,
  prediction_json text not null,
  created_at text not null
);

create table if not exists consensus_annotations (
  id text primary key,
  image_id text not null references images(id) on delete cascade,
  annotation_json text not null,
  source_result_id text references annotation_results(id) on delete set null,
  status text not null default 'approved',
  created_at text not null
);

create table if not exists dataset_versions (
  id text primary key,
  status text not null default 'draft',
  artifact_key text,
  manifest_json text,
  created_at text not null
);

create table if not exists training_runs (
  id text primary key,
  dataset_version_id text not null references dataset_versions(id) on delete restrict,
  base_model_key text,
  config_json text not null,
  status text not null default 'queued',
  provider text not null default 'manual',
  metrics_json text,
  result_model_key text,
  created_at text not null,
  updated_at text not null
);

create table if not exists model_versions (
  id text primary key,
  training_run_id text references training_runs(id) on delete set null,
  model_key text not null,
  metrics_json text,
  status text not null default 'candidate',
  created_at text not null
);

insert or ignore into queues (id, name, description, required_replicates, created_at)
values
  ('needs-first-pass', 'Needs first pass', 'Fresh uploads and model pre-labels waiting for human correction.', 1, datetime('now')),
  ('needs-second-pass', 'Needs second pass', 'Hard cases replicated by another user before review.', 2, datetime('now')),
  ('disagreement-review', 'Disagreement review', 'Annotations with line, fin, or crop geometry disagreement.', 3, datetime('now')),
  ('ready-for-training', 'Ready for training', 'Reviewed consensus annotations ready for the next dataset freeze.', 1, datetime('now'));
