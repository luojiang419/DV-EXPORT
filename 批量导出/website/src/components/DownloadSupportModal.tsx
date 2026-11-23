import { FormEvent, useEffect, useRef, useState } from "react";
import { savePendingSponsorClaim, submitSponsorClaim, type PaymentChannel } from "../api/sponsors";
import {
  formatFileSize,
  installerChecksumUrl,
  installerFileName,
  installerUrl,
  productVersion
} from "../product";

interface DownloadSupportModalProps {
  open: boolean;
  onClose(): void;
}

interface PreviewImage {
  src: string;
  alt: string;
}

const paymentImages: Array<PreviewImage & { channel: PaymentChannel; label: string; caption: string }> = [
  {
    channel: "wechat",
    label: "微信赞赏",
    caption: "使用微信扫一扫，点击二维码可全屏查看",
    src: "./support/wechat-support.jpg",
    alt: "DV EXPORT 微信赞赏码"
  },
  {
    channel: "alipay",
    label: "支付宝",
    caption: "使用支付宝扫一扫，点击二维码可全屏查看",
    src: "./support/alipay-support.jpg",
    alt: "DV EXPORT 支付宝赞赏码"
  }
];

export function DownloadSupportModal({ open, onClose }: DownloadSupportModalProps) {
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previewTriggerRef = useRef<HTMLButtonElement | null>(null);
  const [previewImage, setPreviewImage] = useState<PreviewImage | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [installerSize, setInstallerSize] = useState("正在读取文件大小…");
  const [submitting, setSubmitting] = useState(false);
  const [formStatus, setFormStatus] = useState<{ tone: "success" | "error" | "neutral"; text: string }>({
    tone: "neutral",
    text: ""
  });

  useEffect(() => {
    if (!open) {
      setPreviewImage(null);
      previewTriggerRef.current = null;
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();
    void fetch(installerUrl, { method: "HEAD" })
      .then((response) => {
        if (!response.ok) {
          throw new Error("安装包暂时不可用");
        }
        setInstallerSize(formatFileSize(Number(response.headers.get("content-length"))));
      })
      .catch(() => setInstallerSize("大小以下载响应为准"));

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }
      if (previewImage) {
        setPreviewImage(null);
        window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
      } else {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [onClose, open, previewImage]);

  if (!open) {
    return null;
  }

  function openImage(image: PreviewImage, trigger: HTMLButtonElement) {
    previewTriggerRef.current = trigger;
    setPreviewImage(image);
  }

  function closePreview() {
    setPreviewImage(null);
    window.requestAnimationFrame(() => previewTriggerRef.current?.focus());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) {
      return;
    }

    const formData = new FormData(form);
    setSubmitting(true);
    setFormStatus({ tone: "neutral", text: "正在提交赞助记录…" });
    try {
      const claim = await submitSponsorClaim({
        displayName: String(formData.get("displayName") || "").trim(),
        amount: String(formData.get("amount") || "").trim(),
        paymentChannel: String(formData.get("paymentChannel") || "wechat") as PaymentChannel,
        website: String(formData.get("website") || "")
      });
      savePendingSponsorClaim(claim);
      form.reset();
      setFormStatus({ tone: "success", text: "提交成功。管理员核实到账后会显示在赞助榜。" });
    } catch (error) {
      setFormStatus({
        tone: "error",
        text: error instanceof Error ? error.message : "提交失败，请稍后再试。"
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div className="support-modal" role="presentation">
        <button className="support-modal__backdrop" aria-label="关闭下载窗口" onClick={onClose} type="button" />
        <section className="support-modal__card" aria-labelledby="download-dialog-title" aria-modal="true" role="dialog">
          <button className="support-modal__close" onClick={onClose} ref={closeButtonRef} type="button" aria-label="关闭">
            ×
          </button>

          <header className="support-modal__heading">
            <span className="support-modal__icon" aria-hidden="true">↓</span>
            <div>
              <span className="modal-kicker">免费下载 · 自愿支持</span>
              <h2 id="download-dialog-title">下载 DV EXPORT</h2>
              <p>Windows 10/11 · DaVinci Resolve Studio 19+ · v{productVersion}</p>
            </div>
          </header>

          <section className="download-file-card">
            <div>
              <strong>{installerFileName}</strong>
              <span>Windows EXE 自安装包 · {installerSize}</span>
              <a href={installerChecksumUrl} download>SHA256 校验文件</a>
            </div>
            <a className="button button--primary" href={installerUrl} download>
              下载最新版 <span>↓</span>
            </a>
          </section>

          <p className="support-message">
            软件始终可以免费下载。如果它帮你节省了重复导出的时间，也欢迎随心赞助，用于服务器开销和后续功能开发。
          </p>

          <div className="support-modal__layout">
            <section className="support-payment-panel" aria-labelledby="support-payment-title">
              <div className="support-panel-title">
                <div>
                  <span className="modal-kicker">随心赞助</span>
                  <h3 id="support-payment-title">选择支付方式</h3>
                </div>
                <div className="support-panel-cta">
                  <p>完成赞助后可提交称呼和金额，人工核实到账后会作为特别鸣谢展示在赞助榜。</p>
                  <button className="button button--primary button--compact" onClick={() => setShowForm(true)} type="button">
                    提交赞助记录 <span>→</span>
                  </button>
                </div>
              </div>

              <div className="support-qr-grid">
                {paymentImages.map((image) => (
                  <figure className={`support-qr-card support-qr-card--${image.channel}`} key={image.channel}>
                    <span>{image.label}</span>
                    <button
                      aria-label={`全屏查看${image.label}二维码`}
                      onClick={(event) => openImage(image, event.currentTarget)}
                      type="button"
                    >
                      <img alt={image.alt} decoding="async" loading="lazy" src={image.src} />
                    </button>
                    <figcaption>{image.caption}</figcaption>
                  </figure>
                ))}
              </div>

              {showForm ? (
                <form className="support-form" onSubmit={handleSubmit} noValidate>
                  <div className="support-form__grid">
                    <label>
                      <span>你的称呼</span>
                      <input name="displayName" type="text" maxLength={24} autoComplete="nickname" placeholder="例如：热心朋友" required />
                    </label>
                    <label>
                      <span>实际赞助金额（元）</span>
                      <input name="amount" type="number" min="0.01" max="99999.99" step="0.01" inputMode="decimal" placeholder="例如：10" required />
                    </label>
                  </div>
                  <fieldset>
                    <legend>实际支付方式</legend>
                    <label><input type="radio" name="paymentChannel" value="wechat" defaultChecked /> 微信</label>
                    <label><input type="radio" name="paymentChannel" value="alipay" /> 支付宝</label>
                  </fieldset>
                  <label className="support-honeypot" aria-hidden="true">
                    网站<input name="website" type="text" tabIndex={-1} autoComplete="off" />
                  </label>
                  <p className="support-privacy">提交即同意在核实到账后公开显示称呼、金额和支持时间，请勿填写敏感信息。</p>
                  <button className="button button--primary button--compact" disabled={submitting} type="submit">
                    {submitting ? "正在提交…" : "我已赞助，提交记录"}
                  </button>
                  <p className={`support-form__status is-${formStatus.tone}`} aria-live="polite">{formStatus.text}</p>
                </form>
              ) : null}
            </section>

            <aside className="support-info-panel">
              <span className="modal-kicker">公开透明</span>
              <h3>赞助榜规则</h3>
              <ol>
                <li><span>01</span> 赞助完全自愿，不影响免费下载。</li>
                <li><span>02</span> 提交记录后由管理员人工核实到账。</li>
                <li><span>03</span> 只按支持时间展示，不按金额排名。</li>
              </ol>
              <a className="button button--secondary button--compact" href="./sponsors.html">查看赞助榜 <span>↗</span></a>
            </aside>
          </div>
        </section>
      </div>

      {previewImage ? (
        <div className="qr-preview" role="dialog" aria-modal="true" aria-label={previewImage.alt}>
          <button className="qr-preview__backdrop" onClick={closePreview} type="button" aria-label="关闭二维码预览" />
          <div className="qr-preview__card">
            <button className="qr-preview__close" onClick={closePreview} type="button" aria-label="关闭">×</button>
            <img alt={previewImage.alt} src={previewImage.src} />
            <p>使用对应应用扫码，按 Esc 返回下载窗口</p>
          </div>
        </div>
      ) : null}
    </>
  );
}
