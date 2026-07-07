import { ArrowRight, Boxes, CheckCircle2, Database, FlaskConical, GitBranch, Images, Play, ShieldCheck, UploadCloud } from "lucide-react";
import { Button } from "./components/ui/button";
import { dashboardSeed, QueueSummary, TrainingRunSummary } from "./workflow";

function metricLabel(value: number) {
  return new Intl.NumberFormat().format(value);
}

function statusLabel(status: TrainingRunSummary["status"]) {
  if (status === "running") return "Running";
  if (status === "queued") return "Queued";
  if (status === "finished") return "Finished";
  return "Failed";
}

function QueueCard({ queue }: { queue: QueueSummary }) {
  const progress = queue.requiredReplicates > 0 ? Math.min(100, Math.round((queue.completedReplicates / queue.requiredReplicates) * 100)) : 0;

  return (
    <article className="dashboard-card queue-card">
      <div>
        <h3>{queue.name}</h3>
        <p>{queue.description}</p>
      </div>
      <div className="queue-card-footer">
        <span>{metricLabel(queue.taskCount)} tasks</span>
        <span>{progress}% replicated</span>
      </div>
      <div className="queue-progress" aria-hidden="true">
        <span style={{ width: `${progress}%` }} />
      </div>
    </article>
  );
}

function TrainingRunCard({ run }: { run: TrainingRunSummary }) {
  return (
    <article className="dashboard-card training-card">
      <div className="training-card-header">
        <div>
          <h3>{run.modelName}</h3>
          <p>
            {run.datasetVersion} · {run.provider} · {run.gpu}
          </p>
        </div>
        <span className={`run-status ${run.status}`}>{statusLabel(run.status)}</span>
      </div>
      {run.metrics ? (
        <dl className="metric-strip">
          <div>
            <dt>mAP50</dt>
            <dd>{run.metrics.map50?.toFixed(2) ?? "-"}</dd>
          </div>
          <div>
            <dt>Fin recall</dt>
            <dd>{run.metrics.finRecall?.toFixed(2) ?? "-"}</dd>
          </div>
          <div>
            <dt>Edge recall</dt>
            <dd>{run.metrics.edgeCutRecall?.toFixed(2) ?? "-"}</dd>
          </div>
        </dl>
      ) : (
        <p className="training-note">Worker is training from a frozen dataset archive and will upload metrics when finished.</p>
      )}
    </article>
  );
}

export default function Dashboard() {
  const { stats, queues, trainingRuns } = dashboardSeed;

  return (
    <main className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <span className="brand-mark">K</span>
          <div>
            <strong>Koi Tag Ops</strong>
            <span>Annotation and training</span>
          </div>
        </div>
        <nav className="dashboard-nav" aria-label="Dashboard navigation">
          <a className="active" href="#intake">
            <UploadCloud size={18} />
            Intake
          </a>
          <a href="#queues">
            <Boxes size={18} />
            Queues
          </a>
          <a href="#datasets">
            <Database size={18} />
            Datasets
          </a>
          <a href="#training">
            <FlaskConical size={18} />
            Training
          </a>
        </nav>
        <a className="tagger-link" href="/">
          Open tagger
          <ArrowRight size={16} />
        </a>
      </aside>

      <section className="dashboard-main">
        <header className="dashboard-header">
          <div>
            <h1>Image manager</h1>
            <p>Upload batches, route replicated annotation work, freeze datasets, and launch GPU training jobs.</p>
          </div>
          <div className="dashboard-actions">
            <Button>
              <Images size={16} />
              Import photos
            </Button>
            <Button variant="secondary">
              <Play size={16} />
              Start training
            </Button>
          </div>
        </header>

        <section className="stat-grid" aria-label="Workflow stats">
          <article className="stat-card">
            <Images size={20} />
            <span>Batches</span>
            <strong>{metricLabel(stats.imageBatches)}</strong>
          </article>
          <article className="stat-card">
            <Boxes size={20} />
            <span>Queued</span>
            <strong>{metricLabel(stats.queuedTasks)}</strong>
          </article>
          <article className="stat-card">
            <ShieldCheck size={20} />
            <span>Replicated</span>
            <strong>{metricLabel(stats.replicatedTasks)}</strong>
          </article>
          <article className="stat-card">
            <CheckCircle2 size={20} />
            <span>Training ready</span>
            <strong>{metricLabel(stats.trainingReady)}</strong>
          </article>
        </section>

        <section className="dashboard-section" id="intake">
          <div className="section-heading">
            <div>
              <h2>Photo intake</h2>
              <p>Each upload becomes a batch. YOLO predictions can seed candidates, but human corrections remain separate.</p>
            </div>
          </div>
          <div className="pipeline-row">
            <article className="pipeline-step">
              <UploadCloud size={20} />
              <h3>Upload batch</h3>
              <p>Originals go to object storage; SQLite stores checksums, dimensions, source, and split.</p>
            </article>
            <article className="pipeline-step">
              <GitBranch size={20} />
              <h3>Pre-label</h3>
              <p>Current YOLO model creates fish candidates for accept, correct, delete, or missed-fish add.</p>
            </article>
            <article className="pipeline-step">
              <ShieldCheck size={20} />
              <h3>Replicate</h3>
              <p>Difficult buckets can require two to four independent annotation results before consensus.</p>
            </article>
            <article className="pipeline-step">
              <Database size={20} />
              <h3>Freeze dataset</h3>
              <p>Approved labels are exported as a versioned archive for local GPU training.</p>
            </article>
          </div>
        </section>

        <section className="dashboard-section" id="queues">
          <div className="section-heading">
            <div>
              <h2>Annotation queues</h2>
              <p>Queues are worklists. Replication and disagreement review protect validation quality.</p>
            </div>
          </div>
          <div className="queue-grid">
            {queues.map((queue) => (
              <QueueCard key={queue.id} queue={queue} />
            ))}
          </div>
        </section>

        <section className="dashboard-section" id="training">
          <div className="section-heading">
            <div>
              <h2>Training runs</h2>
              <p>GPU workers download frozen dataset archives, train locally, upload metrics and weights, then shut down.</p>
            </div>
          </div>
          <div className="training-list">
            {trainingRuns.map((run) => (
              <TrainingRunCard key={run.id} run={run} />
            ))}
          </div>
        </section>
      </section>
    </main>
  );
}
