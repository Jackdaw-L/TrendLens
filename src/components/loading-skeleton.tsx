export function LoadingSkeleton() {
  return (
    <main className="app-shell">
      <div className="app-frame">
        <div className="app-safe page-transition">
          <header className="loading-top">
            <div className="skeleton loading-logo" />
            <div className="skeleton loading-title" />
            <div className="skeleton loading-icon" />
          </header>

          <section className="loading-stack" aria-label="正在加载">
            <div className="skeleton loading-line short" />
            <div className="skeleton loading-heading" />
            <div className="skeleton loading-line medium" />
          </section>

          <section className="loading-stack">
            <LoadingCard />
            <LoadingCard compact />
          </section>
        </div>
      </div>
    </main>
  );
}

function LoadingCard({ compact = false }: { compact?: boolean }) {
  return (
    <article className="loading-card">
      <div className="loading-card__top">
        <div className="skeleton loading-chip" />
        <div className="skeleton loading-chip small" />
        <div className="skeleton loading-icon" />
      </div>
      <div className="skeleton loading-card-title" />
      <div className="skeleton loading-line" />
      {!compact && <div className="skeleton loading-line medium" />}
      <div className="loading-recommend">
        <div className="skeleton loading-icon" />
        <div className="loading-recommend__body">
          <div className="skeleton loading-line" />
          <div className="skeleton loading-line short" />
        </div>
      </div>
    </article>
  );
}
