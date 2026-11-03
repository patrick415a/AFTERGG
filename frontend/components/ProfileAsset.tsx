'use client';
import { useState } from 'react';
import styles from './Summoner.module.scss';
// 네트워크 오류나 이미지 주소 누락 시 같은 크기의 회색 자리를 유지합니다.
export default function ProfileAsset({
  src,
  label,
  width,
  height,
  className = '',
}: {
  src?: string | null;
  label: string;
  width: number;
  height: number;
  className?: string;
}) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  return src && failedSrc !== src ? (
    <img
      src={src}
      alt={label}
      width={width}
      height={height}
      className={className}
      onError={() => setFailedSrc(src)}
    />
  ) : (
    <span
      className={`${styles.pendingAsset} ${className}`}
      style={{ width, height }}
      role="img"
      aria-label={`${label} 이미지 없음`}
    />
  );
}
