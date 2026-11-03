'use client';
import { useEffect, useState } from 'react';
import styles from './Notice.module.scss';
export function useNotice() {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(''), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);
  return { message, notify: setMessage };
}
export default function Notice({ message }: { message: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={`${styles.notice} ${message ? styles.visible : ''}`}
    >
      {message}
    </div>
  );
}
