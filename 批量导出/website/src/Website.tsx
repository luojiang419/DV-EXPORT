import { useCallback, useEffect, useRef, useState } from "react";
import { BrandMark } from "./components/Brand";
import { DownloadSupportModal } from "./components/DownloadSupportModal";

const repositoryUrl = "https://github.com/luojiang419/DV-EXPORT";

const features = [
  {
    number: "01",
    title: "按媒体池定位",
    description: "沿用熟悉的文件夹结构浏览时间线，也可以全局搜索并跨文件夹选择。"
  },
  {
    number: "02",
    title: "一次配置，批量执行",
    description: "统一设置格式、编码器、分辨率、帧率和命名模板，减少重复进入 Deliver 页面。"
  },
  {
    number: "03",
    title: "只追加本次任务",
    description: "将所选时间线加入 Render Queue，并保留队列里原本存在的任务。"
  },
  {
    number: "04",
    title: "帧率副本工作流",
    description: "按目标帧率创建新的可编辑时间线，适配横竖屏与多平台交付场景。"
  }
];

const workflow = [
  {
    step: "01",
    title: "找到时间线",
    description: "从媒体池文件夹筛选，或直接搜索整个工程。"
  },
  {
    step: "02",
    title: "统一交付参数",
    description: "选择导出格式、编码器、分辨率、帧率与命名规则。"
  },
  {
    step: "03",
    title: "交给 Render Queue",
    description: "批量创建并启动本次任务，完成后逐条查看结果。"
  }
];

const faqs = [
  {
    question: "在线 Demo 会访问我的电脑或 Resolve 工程吗？",
    answer: "不会。在线 Demo 使用固定的模拟工程数据，所有导出和帧率转换结果都只在页面内生成。"
  },
  {
    question: "插件支持哪个版本的 DaVinci Resolve？",
    answer: "当前面向 Windows 版 DaVinci Resolve Studio 19 及以上版本，免费版 Resolve 不在支持范围内。"
  },
  {
    question: "批量导出会清空已有的 Render Queue 吗？",
    answer: "不会。插件只追加并启动本次创建的任务，不清空用户已经存在的渲染队列。"
  },
  {
    question: "安装后从哪里打开？",
    answer: "重启 Resolve 后，从 Workspace → Workflow Integrations → 达芬奇批量导出 打开插件。"
  }
];

function DemoFrame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const demoWidth = 1440;
  const demoHeight = 860;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateScale = () => setScale(Math.min(1, container.clientWidth / demoWidth));
    updateScale();
    const observer = new ResizeObserver(updateScale);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="demo-frame" ref={containerRef} style={{ height: `${demoHeight * scale}px` }}>
      {!loaded ? (
        <div className="demo-loading">
          <span className="demo-loading__dot" />
          正在载入交互演示
        </div>
      ) : null}
      <iframe
        allow="clipboard-read; clipboard-write"
        aria-label="DV EXPORT 在线交互演示"
        onLoad={() => setLoaded(true)}
        src="./demo/"
        style={{
          width: `${demoWidth}px`,
          height: `${demoHeight}px`,
          transform: `scale(${scale})`
        }}
        title="DV EXPORT 在线交互演示"
      />
    </div>
  );
}

export function Website() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [downloadOpen, setDownloadOpen] = useState(false);
  const closeDownload = useCallback(() => setDownloadOpen(false), []);

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get("support") === "1") {
      setDownloadOpen(true);
    }
  }, []);

  return (
    <div className="site-shell">
      <header className="site-header">
        <a className="brand" href="#top" aria-label="DV EXPORT 首页">
          <BrandMark />
          <span className="brand__wordmark">DV EXPORT</span>
        </a>

        <button
          aria-expanded={menuOpen}
          aria-label="打开导航"
          className="menu-button"
          onClick={() => setMenuOpen((current) => !current)}
          type="button"
        >
          <span />
          <span />
        </button>

        <nav className={`site-nav ${menuOpen ? "is-open" : ""}`} aria-label="主导航">
          <a href="#features" onClick={() => setMenuOpen(false)}>功能</a>
          <a href="#demo" onClick={() => setMenuOpen(false)}>在线体验</a>
          <a href="#workflow" onClick={() => setMenuOpen(false)}>使用方法</a>
          <a href="./sponsors.html" onClick={() => setMenuOpen(false)}>赞助榜</a>
          <a href="#requirements" onClick={() => setMenuOpen(false)}>运行要求</a>
        </nav>

        <button className="header-download" onClick={() => setDownloadOpen(true)} type="button">
          获取插件 <span>↓</span>
        </button>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-glow" aria-hidden="true" />
          <div className="hero-copy">
            <div className="eyebrow"><span /> Workflow Integration for DaVinci Resolve</div>
            <h1>把重复导出，<br /><em>变成一次选择。</em></h1>
            <p>
              DV EXPORT 直接运行在 DaVinci Resolve 内。按媒体池找到时间线，统一导出参数，
              一次批量加入 Render Queue。
            </p>
            <div className="hero-actions">
              <a className="button button--primary" href="#demo">立即体验 Demo <span>↓</span></a>
              <button className="button button--secondary" onClick={() => setDownloadOpen(true)} type="button">
                下载 Windows 版 <span>↓</span>
              </button>
            </div>
            <div className="hero-meta" aria-label="产品运行要求">
              <span><i /> Windows 10 / 11</span>
              <span><i /> Resolve Studio 19+</span>
              <span><i /> 安全保留原渲染队列</span>
            </div>
          </div>

          <div className="hero-product" aria-label="DV EXPORT 工作流预览">
            <div className="product-window">
              <div className="product-window__bar">
                <div className="product-window__brand"><BrandMark /> DV EXPORT</div>
                <div className="window-dots"><span /><span /><span /></div>
              </div>
              <div className="product-window__body">
                <div className="mini-sidebar">
                  <span className="mini-label">媒体池结构</span>
                  <div className="folder-row is-open">⌄ <b>城市节奏_宣传片</b></div>
                  <div className="folder-row">　⌄ 01_品牌主片</div>
                  <div className="folder-row is-active">　　 主版本</div>
                  <div className="folder-row">　› 02_社交媒体</div>
                </div>
                <div className="mini-timelines">
                  <div className="mini-panel-title"><span>时间线列表</span><small>3 条已选择</small></div>
                  {["城市节奏_主片_4K", "城市节奏_主片_无字幕", "城市节奏_审片_V08"].map((name, index) => (
                    <div className="timeline-row is-selected" key={name}>
                      <span>{String(index + 1).padStart(2, "0")}</span><b>{name}</b><i>✓</i>
                    </div>
                  ))}
                  <div className="timeline-row"><span>04</span><b>城市节奏_B站_60s</b></div>
                </div>
                <div className="mini-settings">
                  <div className="mini-panel-title"><span>导出设置</span><small>READY</small></div>
                  <label>格式 <strong>MP4</strong></label>
                  <label>编码器 <strong>H.265</strong></label>
                  <label>分辨率 <strong>3840 × 2160</strong></label>
                  <label>帧率 <strong>25 fps</strong></label>
                  <button type="button">导出 3 条时间线 <span>→</span></button>
                </div>
              </div>
            </div>
            <div className="floating-result">
              <span className="result-icon">✓</span>
              <div><strong>已启动 3 个任务</strong><small>全部成功加入 Render Queue</small></div>
            </div>
          </div>
        </section>

        <section className="trust-strip" aria-label="核心价值">
          <span>更少重复点击</span><i />
          <span>更清晰的批量选择</span><i />
          <span>更可控的输出命名</span><i />
          <span>更安全的队列行为</span>
        </section>

        <section className="section features-section" id="features">
          <div className="section-heading">
            <div className="eyebrow"><span /> 为多版本交付而设计</div>
            <h2>从“逐条操作”到<br />清晰的批量工作流</h2>
            <p>保留 Resolve 原有的工程与渲染逻辑，只把高频重复动作组织得更高效。</p>
          </div>
          <div className="feature-grid">
            {features.map((feature) => (
              <article className="feature-card" key={feature.number}>
                <span className="feature-card__number">{feature.number}</span>
                <div className="feature-card__icon" aria-hidden="true"><span /><span /></div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="section demo-section" id="demo">
          <div className="demo-heading">
            <div>
              <div className="eyebrow"><span /> Interactive product demo</div>
              <h2>现在就试，不用安装。</h2>
            </div>
            <div className="demo-heading__aside">
              <p>这是插件真实界面的安全模拟版本。试着选择时间线、切换导出参数，再点击底部操作按钮。</p>
              <a href="./demo/" target="_blank">在新页面打开演示 ↗</a>
            </div>
          </div>

          <div className="demo-guide">
            <span><b>1</b> 选择一条或多条时间线</span>
            <span><b>2</b> 调整格式与命名模板</span>
            <span><b>3</b> 点击导出查看模拟结果</span>
          </div>

          <div className="demo-browser">
            <div className="demo-browser__bar">
              <div className="window-dots"><span /><span /><span /></div>
              <div className="demo-address"><i /> demo.dv-export.local</div>
              <span className="demo-safe">安全演示</span>
            </div>
            <DemoFrame />
          </div>
          <p className="mobile-demo-note">在线 Demo 模拟桌面插件窗口，建议在电脑或横屏设备中体验。</p>
        </section>

        <section className="section workflow-section" id="workflow">
          <div className="workflow-copy">
            <div className="eyebrow"><span /> 3-step workflow</div>
            <h2>专注剪辑，<br />把交付流程交给插件。</h2>
            <p>不改变你的工程组织方式，也不要求迁移到新的独立工具。</p>
            <a href={repositoryUrl} rel="noreferrer" target="_blank">查看项目与更新记录 <span>↗</span></a>
          </div>
          <div className="workflow-list">
            {workflow.map((item) => (
              <article key={item.step}>
                <span>{item.step}</span>
                <div><h3>{item.title}</h3><p>{item.description}</p></div>
                <i>→</i>
              </article>
            ))}
          </div>
        </section>

        <section className="section requirements-section" id="requirements">
          <div className="requirements-card">
            <div>
              <div className="eyebrow"><span /> Compatibility</div>
              <h2>为 Resolve Studio<br />桌面工作流准备</h2>
            </div>
            <div className="requirements-grid">
              <div><span>系统</span><strong>Windows 10 / 11</strong></div>
              <div><span>软件</span><strong>DaVinci Resolve Studio</strong></div>
              <div><span>版本</span><strong>19 或更高版本</strong></div>
              <div><span>安装</span><strong>EXE 自安装包</strong></div>
            </div>
            <button className="button button--primary" onClick={() => setDownloadOpen(true)} type="button">
              下载 Windows 版 <span>↓</span>
            </button>
          </div>
        </section>

        <section className="section faq-section">
          <div className="section-heading section-heading--compact">
            <div className="eyebrow"><span /> FAQ</div>
            <h2>安装前，你可能想知道</h2>
          </div>
          <div className="faq-list">
            {faqs.map((faq, index) => (
              <details key={faq.question} open={index === 0}>
                <summary><span>{faq.question}</span><i>+</i></summary>
                <p>{faq.answer}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="final-cta">
          <div className="final-cta__glow" aria-hidden="true" />
          <BrandMark />
          <h2>让下一次批量交付，<br />从一次选择开始。</h2>
          <p>在浏览器里先体验，再把 DV EXPORT 装进 Resolve。</p>
          <div className="hero-actions">
            <a className="button button--primary" href="#demo">体验在线 Demo <span>↑</span></a>
            <button className="button button--secondary" onClick={() => setDownloadOpen(true)} type="button">
              获取插件 <span>↓</span>
            </button>
          </div>
        </section>
      </main>

      <footer className="site-footer">
        <a className="brand" href="#top"><BrandMark /><span className="brand__wordmark">DV EXPORT</span></a>
        <p>DaVinci Resolve 批量导出 Workflow Integration 插件</p>
        <div>
          <a href={repositoryUrl} rel="noreferrer" target="_blank">GitHub</a>
          <a href="#demo">在线 Demo</a>
          <a href="./sponsors.html">赞助榜</a>
        </div>
      </footer>

      <DownloadSupportModal open={downloadOpen} onClose={closeDownload} />
    </div>
  );
}
