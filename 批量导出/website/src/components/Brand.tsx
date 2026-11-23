export function BrandMark() {
  return (
    <span className="brand-mark" aria-hidden="true">
      <span />
      <span />
      <span />
    </span>
  );
}

export function Brand({ detail }: { detail?: string }) {
  return (
    <span className="brand">
      <BrandMark />
      <span className="brand__copy">
        <span className="brand__wordmark">DV EXPORT</span>
        {detail ? <small>{detail}</small> : null}
      </span>
    </span>
  );
}
