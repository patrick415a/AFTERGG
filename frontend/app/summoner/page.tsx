import { Suspense } from 'react';
import Summoner from '@/components/Summoner';
export default function SummonerPage() {
  return (
    <Suspense
      fallback={
        <main aria-busy="true" className="route-loading">
          검색 결과를 불러오는 중입니다.
        </main>
      }
    >
      <Summoner />
    </Suspense>
  );
}
