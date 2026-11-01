import styles from './Hero.module.css';

export function Hero() {
  return (
    <div className="wrap">
      <section className={styles.hero} aria-labelledby="hero-title">
        <div>
          <span className={styles.eyebrow}>Good objects. Better everyday.</span>
          <h1 id="hero-title" className={styles.title}>
            Considered wholesale for <em>focused</em> living.
          </h1>
          <p className={styles.desc}>
            Direct from verified suppliers. Transparent wholesale pricing with live negotiation on volume orders.
          </p>

          <div className={styles.actions}>
            <a href="#collection" className={styles.primaryBtn}>
              Explore collection
            </a>
            <a href="#about" className={styles.secondaryBtn}>
              Wholesale terms
            </a>
          </div>
        </div>

        <div className={styles.heroArt}>
          <svg
            viewBox="0 0 620 500"
            role="img"
            aria-label="Illustration of a minimalist room with natural light and crafted objects"
          >
            <defs>
              <linearGradient id="wall" x2="1" y2=".8">
                <stop stopColor="#dfdcd1" />
                <stop offset="1" stopColor="#f0eee5" />
              </linearGradient>
              <linearGradient id="seat" x2=".9" y2="1">
                <stop stopColor="#8a9275" />
                <stop offset="1" stopColor="#566446" />
              </linearGradient>
              <linearGradient id="wood">
                <stop stopColor="#ab7c51" />
                <stop offset=".5" stopColor="#c3986b" />
                <stop offset="1" stopColor="#936742" />
              </linearGradient>
              <filter id="shadow">
                <feGaussianBlur stdDeviation="12" />
              </filter>
            </defs>
            <rect width="620" height="500" fill="url(#wall)" />
            <path d="M370 0h145L320 380H80Z" fill="#faf9ef" opacity=".55" />
            <path d="M0 380h620v120H0z" fill="#d4cebd" />
            <path d="M0 380h620" stroke="#c2beae" />
            <ellipse cx="323" cy="436" rx="220" ry="22" fill="#7c7a63" opacity=".2" filter="url(#shadow)" />
            <rect x="70" y="310" width="150" height="17" rx="4" fill="url(#wood)" />
            <path d="m85 327-9 111h10l16-111m100 0 15 111h9l-6-111" fill="#9a704b" />
            <path d="M127 310c-22-18-20-44-10-63l7-15h37l7 15c12 20 11 47-11 63Z" fill="#a66442" />
            <ellipse cx="142" cy="232" rx="18" ry="5" fill="#754732" />
            <path d="M143 232c-3-46 6-75 20-104M145 199c-23-8-36-25-40-39m44 22c23-5 37-20 43-37" fill="none" stroke="#596347" strokeWidth="3" />
            <g fill="#74805b">
              <ellipse cx="162" cy="140" rx="8" ry="21" transform="rotate(25 162 140)" />
              <ellipse cx="113" cy="171" rx="8" ry="20" transform="rotate(-49 113 171)" />
              <ellipse cx="183" cy="154" rx="7" ry="19" transform="rotate(40 183 154)" />
            </g>
            <path d="m300 344-15 103h12l26-103m163-2 29 105h12l-19-105" fill="#795c40" />
            <path d="M302 306c-18-45-21-108 0-120 38-22 124-13 148 18 20 28 35 75 32 103Z" fill="url(#seat)" />
            <path d="M300 205c38-24 110-15 138 8" fill="none" stroke="#a3aa8d" strokeWidth="2" />
            <path d="M282 290c4-15 23-14 27 1l9 31h145l5-32c2-16 22-17 25-1l8 40c3 23-14 44-36 44H320c-25 0-39-15-41-38Z" fill="url(#seat)" />
            <path d="M316 315q67-12 148 0v24q-78 10-145 0Z" fill="#919a7b" />
            <path d="M319 340q73 8 142 0" fill="none" stroke="#4e5c40" />
            <path d="M531 160v259" stroke="#535442" strokeWidth="6" />
            <ellipse cx="531" cy="420" rx="36" ry="7" fill="#555342" />
            <path d="M461 160q0-70 70-70t70 70Z" fill="#ded3b5" />
            <ellipse cx="531" cy="160" rx="70" ry="10" fill="#b4a88b" />
            <ellipse cx="531" cy="160" rx="54" ry="5" fill="#eee4ca" />
          </svg>
        </div>
      </section>

      <div className={styles.strip} aria-label="Collection principles">
        <span><b>01</b> Useful by design</span>
        <span><b>02</b> Made to last</span>
        <span><b>03</b> Direct wholesale pricing</span>
      </div>
    </div>
  );
}
