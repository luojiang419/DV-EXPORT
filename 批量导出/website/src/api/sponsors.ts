export type PaymentChannel = "wechat" | "alipay";
export type SponsorClaimStatus = "pending" | "confirmed" | "rejected";

export interface SponsorClaim {
  id: string;
  displayName: string;
  amount: string;
  paymentChannel: PaymentChannel;
  submittedAt: string;
  confirmedAt: string;
  status?: SponsorClaimStatus;
}

export interface SponsorClaimInput {
  displayName: string;
  amount: string;
  paymentChannel: PaymentChannel;
  website: string;
}

const pendingClaimStorageKey = "dv-export:pending-sponsor-claims";
const explicitApiBase = String(import.meta.env.VITE_SPONSOR_API_BASE || "").trim().replace(/\/+$/, "");
const isLocalPreview = ["127.0.0.1", "localhost"].includes(window.location.hostname);
const apiBase = explicitApiBase || (isLocalPreview ? "http://127.0.0.1:3013" : "");

function endpoint(path: string): string {
  return `${apiBase}/api/dv-export-support/v1${path}`;
}

async function readJsonResponse<T>(response: Response): Promise<T> {
  const payload = (await response.json().catch(() => ({}))) as T & { detail?: string };
  if (!response.ok) {
    throw new Error(payload.detail || "请求失败，请稍后再试。");
  }
  return payload;
}

export async function listPublicSponsors(): Promise<SponsorClaim[]> {
  const response = await fetch(endpoint("/sponsors"), {
    headers: { Accept: "application/json" }
  });
  const payload = await readJsonResponse<{ sponsors?: SponsorClaim[] }>(response);
  return Array.isArray(payload.sponsors) ? payload.sponsors : [];
}

export async function submitSponsorClaim(input: SponsorClaimInput): Promise<SponsorClaim> {
  const response = await fetch(endpoint("/claims"), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const payload = await readJsonResponse<{ claim: SponsorClaim }>(response);
  return payload.claim;
}

export async function getSponsorClaim(publicId: string): Promise<SponsorClaim> {
  const response = await fetch(endpoint(`/claims/${encodeURIComponent(publicId)}`), {
    headers: { Accept: "application/json" }
  });
  const payload = await readJsonResponse<{ claim: SponsorClaim }>(response);
  return payload.claim;
}

export async function listAdminClaims(status: SponsorClaimStatus, token: string): Promise<SponsorClaim[]> {
  const response = await fetch(endpoint(`/admin/claims?claim_status=${encodeURIComponent(status)}`), {
    headers: { Accept: "application/json", "X-Admin-Token": token }
  });
  const payload = await readJsonResponse<{ claims?: SponsorClaim[] }>(response);
  return Array.isArray(payload.claims) ? payload.claims : [];
}

export async function updateSponsorClaim(
  publicId: string,
  action: "confirm" | "reject",
  token: string
): Promise<SponsorClaim> {
  const response = await fetch(endpoint(`/admin/claims/${encodeURIComponent(publicId)}`), {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json", "X-Admin-Token": token },
    body: JSON.stringify({ action })
  });
  const payload = await readJsonResponse<{ claim: SponsorClaim }>(response);
  return payload.claim;
}

export function readPendingSponsorClaims(): SponsorClaim[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(pendingClaimStorageKey) || "[]") as SponsorClaim[];
    return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item.id === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
}

export function savePendingSponsorClaim(claim: SponsorClaim): void {
  const next = [claim, ...readPendingSponsorClaims().filter((item) => item.id !== claim.id)].slice(0, 8);
  localStorage.setItem(pendingClaimStorageKey, JSON.stringify(next));
}

export function savePendingSponsorClaims(claims: SponsorClaim[]): void {
  localStorage.setItem(pendingClaimStorageKey, JSON.stringify(claims.slice(0, 8)));
}
