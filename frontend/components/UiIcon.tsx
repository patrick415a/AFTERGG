import styles from './UiIcon.module.scss';
type IconName = 'clock' | 'file' | 'chevron';
// 시계·문서는 제공된 SVG 원본(24px), 펼치기는 PNG 원본(10×8px)을 유지합니다.
export default function UiIcon({ name, expanded = false }: { name: IconName; expanded?: boolean }) {
  if (name === 'chevron')
    return (
      <img
        src="/assets/chevron.png"
        alt=""
        width={10}
        height={8}
        className={`${styles.chevron} ${expanded ? styles.expanded : ''}`}
      />
    );
  // 외부 SVG의 currentColor가 부모 색을 상속하지 않으므로 원본을 CSS mask로 사용합니다.
  return (
    <span
      aria-hidden="true"
      className={styles.icon}
      style={{
        maskImage: `url('/assets/${name}.svg')`,
        WebkitMaskImage: `url('/assets/${name}.svg')`,
      }}
    />
  );
}
