'use client';
import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Logo from './Logo';
import SearchForm from './SearchForm';
import Notice, { useNotice } from './Notice';
import styles from './Header.module.scss';

// RootLayout에서 한 번만 배치합니다. 메인 이외 경로에서는 검색창을 표시합니다.
export default function Header() {
  const pathname = usePathname();
  const showSearch = pathname !== '/';
  const [light, setLight] = useState(false);
  const { message, notify } = useNotice();
  useEffect(() => {
    setLight(document.documentElement.dataset.theme === 'light');
  }, []);
  function toggleTheme() {
    const next = !light;
    setLight(next);
    document.documentElement.dataset.theme = next ? 'light' : 'dark';
    try {
      localStorage.setItem('aftergg-theme', next ? 'light' : 'dark');
    } catch {
      /* 저장 제한 환경에서도 전환 가능 */
    }
  }
  return (
    <>
      <header className={`${styles.header} ${showSearch ? styles.withSearch : ''}`}>
        <div className={styles.inner}>
          <Link href="/" className={styles.brand} aria-label="AFTERGG 메인페이지">
            <Logo />
          </Link>
          <nav aria-label="주 메뉴" className={styles.navigation}>
            <Link
              href="/"
              className={styles.current}
              aria-current={pathname === '/' ? 'page' : undefined}
            >
              전적 검색
            </Link>
            {/* <button type="button" onClick={() => notify('챔피언 분석은 준비 중입니다.')}>
              챔피언 분석
            </button>
            <button type="button" onClick={() => notify('아이템 분석은 준비 중입니다.')}>
              아이템 분석
            </button> */}
          </nav>
          {showSearch && (
            <div className={styles.searchSlot}>
              <SearchForm compact onNotice={notify} />
            </div>
          )}
          <button
            type="button"
            className={styles.themeButton}
            onClick={toggleTheme}
            aria-label={light ? '다크 모드로 전환' : '라이트 모드로 전환'}
          >
            <img className={styles.darkIcon} src="/assets/moon.svg" width="18" height="18" alt="" />
            <img className={styles.lightIcon} src="/assets/sun.svg" width="18" height="18" alt="" />
          </button>
        </div>
      </header>
      <Notice message={message} />
    </>
  );
}
