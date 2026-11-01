'use client';

import styles from './Footer.module.css';

export function Footer() {
  return (
    <footer id="about" className={styles.footer}>
      <div className="wrap">
        <div className={styles.topRow}>
          <div className={styles.brandArea}>
            <h3>handshake AI</h3>
            <p>
              A considered wholesale negotiation platform. Direct supplier access, instant
              inventory verification, and fair volume pricing.
            </p>
          </div>

          <div className={styles.linksCol}>
            <h4>Wholesale catalog</h4>
            <ul>
              <li>
                <a href="#collection">Browse all products</a>
              </li>
              <li>
                <a href="#collection">Volume discounts</a>
              </li>
              <li>
                <a href="#contact">Verified suppliers</a>
              </li>
            </ul>
          </div>

          <div className={styles.linksCol}>
            <h4>Platform policies</h4>
            <ul>
              <li>
                <a href="#">Instant checkout</a>
              </li>
              <li>
                <a href="#">Reserved stock guarantee</a>
              </li>
              <li>
                <a href="#">Terms of service</a>
              </li>
            </ul>
          </div>
        </div>

        <div className={styles.bottomRow}>
          <span>© {new Date().getFullYear()} Handshake AI. All rights reserved.</span>
          <span>Verified Wholesale Marketplace</span>
        </div>
      </div>
    </footer>
  );
}
