"use client";

import { useHydrated, useLiveNow } from "./WorldClocks";
import styles from "./FlipClock.module.css";

function clockParts(now: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true,
  }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return { digits: `${get("hour")}${get("minute")}${get("second")}`, period: get("dayPeriod") };
}

export function FlipClock({ timeZone = "Asia/Kolkata" }: { timeZone?: string }) {
  const now = useLiveNow();
  const mounted = useHydrated();
  const current = mounted ? clockParts(now, timeZone) : { digits: "------", period: "--" };
  const previous = mounted ? clockParts(now - 1000, timeZone) : current;
  const readable = `${current.digits.slice(0, 2)}:${current.digits.slice(2, 4)}:${current.digits.slice(4)} ${current.period}`;

  return (
    <div className={styles.clock}>
      <div className={styles.caption}>Current time <span>{timeZone}</span></div>
      <time aria-label={`${readable}, ${timeZone}`} dateTime={mounted ? new Date(now).toISOString() : undefined}>
        <span className={styles.digits} aria-hidden="true">
          {current.digits.split("").map((digit, index) => (
            <span className={styles.position} key={index}>
              {(index === 2 || index === 4) && <span className={styles.colon}>:</span>}
              <span className={styles.tile}>
                <span className={styles.top}><span>{digit}</span></span>
                <span className={styles.bottom}><span>{digit}</span></span>
                {mounted && digit !== previous.digits[index] && (
                  <span key={`${index}-${now}`} className={styles.animation}>
                    <span className={styles.fallingTop}><span>{previous.digits[index]}</span></span>
                    <span className={styles.fallingBottom}><span>{digit}</span></span>
                  </span>
                )}
              </span>
            </span>
          ))}
          <span className={styles.period}>{current.period}</span>
        </span>
      </time>
    </div>
  );
}
