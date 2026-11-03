// 화면 라벨과 DB의 실제 포지션 코드를 연결합니다.
export const positions = ['전체', '탑', '정글', '미드', '원딜', '서폿'] as const;
export type Position = (typeof positions)[number];
export const positionKeys = {
  전체: 'all',
  탑: 'TOP',
  정글: 'JUNGLE',
  미드: 'MIDDLE',
  원딜: 'BOTTOM',
  서폿: 'UTILITY',
} as const;
export const patchNotesUrl = 'https://www.leagueoflegends.com/ko-kr/news/tags/patch-notes/';
