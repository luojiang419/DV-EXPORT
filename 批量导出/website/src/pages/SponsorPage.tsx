import { useEffect, useState } from "react";
import {
  getSponsorClaim,
  listPublicSponsors,
  readPendingSponsorClaims,
  savePendingSponsorClaims,
  type SponsorClaim
} from "../api/sponsors";
import { BrandMark } from "../components/Brand";

function formatAmount(value: string): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value));
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "时间未知";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function initials(value: string): string {
  return Array.from(value.trim()).slice(0, 2).join("").toUpperCase() || "DV";
}

export function SponsorPage() {
  const [sponsors, setSponsors] = useState<SponsorClaim[]>([]);
  const [pendingClaims, setPendingClaims] = useState<SponsorClaim[]>(() => readPendingSponsorClaims());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [publicSponsors, pendingStatuses] = await Promise.all([
          listPublicSponsors(),
          Promise.allSettled(readPendingSponsorClaims().map((claim) => getSponsorClaim(claim.id)))
        ]);
        if (cancelled) {
          return;
        }
        const remainingPending = pendingStatuses
          .filter((result): result is PromiseFulfilledResult<SponsorClaim> => result.status === "fulfilled")
          .map((result) => result.value)
          .filter((claim) => claim.status === "pending");
        savePendingSponsorClaims(remainingPending);
        setPendingClaims(remainingPending);
        setSponsors(publicSponsors);
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "赞助榜暂时无法加载。");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="subpage-shell">
      <header className="subpage-header">
        <a className="brand" href="./" aria-label="返回 DV EXPORT 官网">
          <BrandMark />
          <span className="brand__copy"><span className="brand__wordmark">DV EXPORT</span><small>赞助榜</small></span>
        </a>
        <nav aria-label="赞助榜导航">
          <a href="./">官网首页</a>
          <a href="./#demo">在线体验</a>
          <a aria-current="page" href="./sponsors.html">赞助榜</a>
        </nav>
        <a className="button button--primary button--compact" href="./?support=1">我也要支持 <span>→</span></a>
      </header>

      <main className="sponsor-page-main">
        <section className="sponsor-page-heading">
          <div className="eyebrow"><span /> Special thanks</div>
          <h1>感谢每一份<br /><em>真诚支持。</em></h1>
          <p>名单只按支持时间排列，不以金额排名。新提交的记录会在人工核实到账后公开展示。</p>
          <div className="sponsor-rules" aria-label="赞助榜规则">
            <span>按支持时间排列</span><i />
            <span>不按金额排名</span><i />
            <span>到账后人工确认</span>
          </div>
        </section>

        <section className="sponsor-board">
          <header className="sponsor-board__header">
            <div><strong>{loading ? "—" : sponsors.length}</strong><span>位热心朋友</span></div>
            <a className="button button--secondary button--compact" href="./?support=1">随心支持 <span>↗</span></a>
          </header>

          {pendingClaims.length > 0 ? (
            <aside className="my-supports">
              <span aria-hidden="true" />
              <div>
                <strong>你的 {pendingClaims.length} 条赞助记录正在等待确认</strong>
                <p>管理员核实到账后，会自动出现在公开赞助榜中。</p>
              </div>
            </aside>
          ) : null}

          <div className="sponsor-list" aria-busy={loading} aria-live="polite">
            {loading ? <div className="sponsor-empty">正在加载赞助榜…</div> : null}
            {!loading && error ? <div className="sponsor-empty is-error">{error}</div> : null}
            {!loading && !error && sponsors.length === 0 ? (
              <div className="sponsor-empty">赞助榜还在等待第一位热心朋友。</div>
            ) : null}
            {!loading && !error
              ? sponsors.map((sponsor) => (
                  <article className="sponsor-item" key={sponsor.id}>
                    <span className="sponsor-avatar">{initials(sponsor.displayName)}</span>
                    <div className="sponsor-info">
                      <strong>{sponsor.displayName}</strong>
                      <time dateTime={sponsor.confirmedAt || sponsor.submittedAt}>
                        {formatTime(sponsor.confirmedAt || sponsor.submittedAt)}
                      </time>
                    </div>
                    <strong className="sponsor-amount">{formatAmount(sponsor.amount)}</strong>
                  </article>
                ))
              : null}
          </div>
        </section>

        <p className="sponsor-page-note">赞助完全自愿，软件始终可以免费下载。每一笔支持都会用于服务器开销和功能开发。</p>
      </main>

      <footer className="subpage-footer">
        <span>DV EXPORT · DaVinci Resolve 批量导出插件</span>
        <a href="./">返回产品官网</a>
      </footer>
    </div>
  );
}
