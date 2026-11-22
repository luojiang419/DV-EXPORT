import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  listAdminClaims,
  updateSponsorClaim,
  type SponsorClaim,
  type SponsorClaimStatus
} from "../api/sponsors";
import { BrandMark } from "../components/Brand";

const tokenStorageKey = "dv-export:sponsor-admin-token";

function formatAmount(value: string): string {
  return new Intl.NumberFormat("zh-CN", { style: "currency", currency: "CNY" }).format(Number(value));
}

function formatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "时间未知"
    : new Intl.DateTimeFormat("zh-CN", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
      }).format(date);
}

export function SponsorAdminPage() {
  const [token, setToken] = useState(() => sessionStorage.getItem(tokenStorageKey) || "");
  const [authenticated, setAuthenticated] = useState(false);
  const [activeStatus, setActiveStatus] = useState<SponsorClaimStatus>("pending");
  const [claims, setClaims] = useState<SponsorClaim[]>([]);
  const [statusText, setStatusText] = useState("");
  const [loading, setLoading] = useState(false);

  const loadClaims = useCallback(async (nextToken = token, nextStatus = activeStatus) => {
    if (!nextToken) {
      return;
    }
    setLoading(true);
    setStatusText("正在加载…");
    try {
      const items = await listAdminClaims(nextStatus, nextToken);
      setClaims(items);
      setAuthenticated(true);
      setStatusText(`共 ${items.length} 条${nextStatus === "pending" ? "待确认" : nextStatus === "confirmed" ? "已确认" : "已拒绝"}记录`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "加载失败";
      setStatusText(message);
      if (/令牌|未授权|401/.test(message)) {
        sessionStorage.removeItem(tokenStorageKey);
        setAuthenticated(false);
      }
    } finally {
      setLoading(false);
    }
  }, [activeStatus, token]);

  useEffect(() => {
    if (token) {
      void loadClaims(token, activeStatus);
    }
  }, []);

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const nextToken = String(formData.get("token") || "").trim();
    if (!nextToken) {
      return;
    }
    sessionStorage.setItem(tokenStorageKey, nextToken);
    setToken(nextToken);
    await loadClaims(nextToken, activeStatus);
  }

  async function changeStatus(nextStatus: SponsorClaimStatus) {
    setActiveStatus(nextStatus);
    await loadClaims(token, nextStatus);
  }

  async function handleAction(claim: SponsorClaim, action: "confirm" | "reject") {
    const verb = action === "confirm" ? "确认到账并公开上榜" : "拒绝这条记录";
    if (!window.confirm(`${verb}：${claim.displayName} ${formatAmount(claim.amount)}？`)) {
      return;
    }
    try {
      await updateSponsorClaim(claim.id, action, token);
      await loadClaims(token, activeStatus);
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "操作失败");
    }
  }

  function logout() {
    sessionStorage.removeItem(tokenStorageKey);
    setToken("");
    setAuthenticated(false);
    setClaims([]);
    setStatusText("");
  }

  return (
    <div className="admin-page-shell">
      <header className="admin-page-header">
        <a className="brand" href="./" aria-label="返回 DV EXPORT 官网">
          <BrandMark />
          <span className="brand__copy"><span className="brand__wordmark">DV EXPORT</span><small>赞助记录管理</small></span>
        </a>
        <a className="button button--secondary button--compact" href="./sponsors.html">查看公开赞助榜 <span>↗</span></a>
      </header>

      {!authenticated ? (
        <main className="admin-login-card">
          <div className="eyebrow"><span /> Admin verification</div>
          <h1>核实赞助记录</h1>
          <p>输入服务器配置的管理员令牌。令牌只保存在当前浏览器标签页，关闭后自动清除。</p>
          <form onSubmit={handleLogin}>
            <label>
              <span>管理员令牌</span>
              <input name="token" type="password" autoComplete="off" required />
            </label>
            <button className="button button--primary" disabled={loading} type="submit">
              {loading ? "正在验证…" : "进入管理"}
            </button>
          </form>
          <p className="admin-status" aria-live="polite">{statusText}</p>
        </main>
      ) : (
        <main className="admin-workspace">
          <section className="admin-toolbar">
            <div><div className="eyebrow"><span /> Sponsor records</div><h1>人工确认中心</h1><p>请先在微信或支付宝核实到账，再确认公开。</p></div>
            <div><button className="button button--secondary button--compact" onClick={() => void loadClaims()} type="button">刷新</button><button className="button button--secondary button--compact" onClick={logout} type="button">退出</button></div>
          </section>

          <nav className="admin-tabs" aria-label="记录状态筛选">
            {(["pending", "confirmed", "rejected"] as SponsorClaimStatus[]).map((status) => (
              <button className={activeStatus === status ? "is-active" : ""} key={status} onClick={() => void changeStatus(status)} type="button">
                {status === "pending" ? "待确认" : status === "confirmed" ? "已确认" : "已拒绝"}
              </button>
            ))}
          </nav>

          <div className="admin-summary" aria-live="polite">{statusText}</div>
          <div className="admin-claims" aria-busy={loading}>
            {!loading && claims.length === 0 ? <div className="admin-empty">当前没有记录。</div> : null}
            {claims.map((claim) => (
              <article className="admin-claim" key={claim.id}>
                <div className="admin-claim__main">
                  <div><strong>{claim.displayName}</strong><span>{claim.paymentChannel === "alipay" ? "支付宝" : "微信"}</span></div>
                  <div><strong className="admin-claim__amount">{formatAmount(claim.amount)}</strong><span>用户自报金额</span></div>
                  <div><time dateTime={claim.submittedAt}>{formatTime(claim.submittedAt)}</time><span>提交时间</span></div>
                </div>
                {activeStatus === "pending" ? (
                  <div className="admin-claim__actions">
                    <button className="is-confirm" onClick={() => void handleAction(claim, "confirm")} type="button">确认到账</button>
                    <button className="is-reject" onClick={() => void handleAction(claim, "reject")} type="button">拒绝</button>
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </main>
      )}
    </div>
  );
}
