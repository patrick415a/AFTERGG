import type { Metadata } from 'next';
import localFont from 'next/font/local';
import './globals.scss';
import Header from '@/components/Header';

const pretendard = localFont({
  src: '../public/fonts/PretendardVariable.woff2',
  variable: '--font-pretendard',
  weight: '100 900',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'AFTERGG. | 리그 오브 레전드 전적 검색',
  description: '최근 랭크 게임의 플레이 기록을 확인하세요.',
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" suppressHydrationWarning>
      <body className={pretendard.variable}>
        {/* 저장한 테마를 화면이 그려지기 전에 적용하여 새로고침 시 깜빡임 방지 */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem('aftergg-theme')==='light')document.documentElement.dataset.theme='light'}catch{}`,
          }}
        />
        <Header />
        {children}
      </body>
    </html>
  );
}
