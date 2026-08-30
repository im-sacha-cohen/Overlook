import Image from "next/image";
import Link from "next/link";
import styles from "./landing.module.css";
import { LANDING_COPY, type LandingLang } from "./copy";

const REPO_URL = "https://github.com/im-sacha-cohen/Overlook";

const ENV_PILLS = [
  { label: "local", color: "var(--local)" },
  { label: "dev", color: "var(--dev)" },
  { label: "staging", color: "var(--staging)" },
  { label: "prod", color: "var(--prod)" },
];

export function LandingContent({ lang }: { lang: LandingLang }) {
  const c = LANDING_COPY[lang];

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <div className={styles.navInner}>
          <span className={styles.brand}>
            <Image src="/logo.svg" alt="" width={22} height={22} priority />
            Overlook
          </span>
          <div className={styles.navLinks}>
            <a href="#features">{c.nav.features}</a>
            <a href="#showcase">{c.nav.screenshots}</a>
            <Link href="/">{c.nav.openApp}</Link>
            <Link href={c.langSwitch.href} className={styles.langLink}>
              {c.langSwitch.label}
            </Link>
          </div>
          <a className={styles.navGh} href={REPO_URL} target="_blank" rel="noreferrer">
            <GhIcon /> {c.nav.github}
          </a>
        </div>
      </nav>

      <div className={styles.strip}>
        <span style={{ background: "var(--local)" }} />
        <span style={{ background: "var(--dev)" }} />
        <span style={{ background: "var(--staging)" }} />
        <span style={{ background: "var(--prod)" }} />
      </div>

      <header className={styles.hero}>
        <div className={styles.heroBg} />

        <div className={styles.badgeRow}>
          {ENV_PILLS.map((p, i) => (
            <span
              key={p.label}
              className={`${styles.envPill} ${i === 3 ? styles.on : ""}`}
              style={{ color: p.color, borderColor: `color-mix(in oklab, ${p.color} 45%, transparent)`, background: `color-mix(in oklab, ${p.color} 8%, transparent)` }}
            >
              <span className={styles.dot} style={{ background: p.color }} />
              {p.label}
            </span>
          ))}
        </div>

        <h1 className={styles.h1}>
          {c.hero.h1a}
          <br />
          {c.hero.h1b} <em>{c.hero.h1prod}</em>
        </h1>

        <p className={styles.sub}>{c.hero.sub}</p>

        <div className={styles.ctaRow}>
          <a className={styles.ctaPrimary} href={REPO_URL} target="_blank" rel="noreferrer">
            <GhIcon /> {c.hero.ctaPrimary}
          </a>
          <Link className={styles.ctaSecondary} href="/">
            {c.hero.ctaSecondary}
          </Link>
        </div>
        <div className={styles.stars}>{c.hero.stars}</div>

        <div className={styles.shot}>
          <div className={styles.shotFrame}>
            <div className={styles.shotBar}>
              <span className={styles.shotDot} />
              <span className={styles.shotDot} />
              <span className={styles.shotDot} />
            </div>
            <Image
              src="/landing/table-view.png"
              alt="Overlook table view"
              width={1440}
              height={900}
              priority
            />
          </div>
        </div>
      </header>

      <section className={styles.quoteSection}>
        <p className={styles.quote}>
          {c.quote.before}
          <span>{c.quote.highlight}</span>
          {c.quote.after}
        </p>
      </section>

      <section className={styles.features} id="features">
        <div className={styles.wrap}>
          <div className={styles.sectionHead}>
            <span className={styles.eyebrow}>{c.features.eyebrow}</span>
            <h2>
              {c.features.title.split("\n").map((line, i) => (
                <span key={i}>
                  {i > 0 && <br />}
                  {line}
                </span>
              ))}
            </h2>
          </div>
          <div className={styles.grid}>
            {c.features.items.map((f) => (
              <div className={styles.card} key={f.title}>
                <div
                  className={styles.cardIcon}
                  style={{ color: f.tone, background: `color-mix(in oklab, ${f.tone} 12%, transparent)` }}
                >
                  {f.icon}
                </div>
                <h3>{f.title}</h3>
                <p>{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className={styles.showcase} id="showcase">
        <div className={styles.wrap}>
          {c.showcase.rows.map((row, i) => (
            <div className={`${styles.showRow} ${i % 2 === 1 ? styles.rev : ""}`} key={row.title}>
              <div className={styles.showText}>
                <span className={styles.eyebrow} style={{ color: row.tone }}>
                  <span style={{ width: 6, height: 6, borderRadius: "50%", background: row.tone, display: "inline-block" }} />
                  {row.eyebrow}
                </span>
                <h3>{row.title}</h3>
                <p>{row.body}</p>
              </div>
              <div className={styles.showImg}>
                <Image src={row.img} alt={row.alt} width={1440} height={900} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className={styles.finalCta}>
        <div className={styles.heroBg} />
        <h2>{c.finalCta.title}</h2>
        <p>{c.finalCta.body}</p>
        <div className={styles.ctaRow}>
          <a className={styles.ctaPrimary} href={REPO_URL} target="_blank" rel="noreferrer">
            <GhIcon /> {c.finalCta.primary}
          </a>
          <Link className={styles.ctaSecondary} href="/">
            {c.finalCta.secondary}
          </Link>
        </div>
      </section>

      <footer className={styles.footer}>
        <div className={styles.footerInner}>
          <span>© {new Date().getFullYear()} {c.footer.license}</span>
          <div className={styles.footerLinks}>
            <a href={REPO_URL} target="_blank" rel="noreferrer">{c.footer.github}</a>
            <a href="https://buymeacoffee.com/ImSachaCOHEN/e/571161" target="_blank" rel="noreferrer">{c.footer.coffee}</a>
            <Link href="/">{c.footer.openApp}</Link>
            <Link href={c.langSwitch.href}>{c.langSwitch.label}</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}

function GhIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path d="M8 0C3.58 0 0 3.58 0 8a8 8 0 0 0 5.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8 8 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}
