import styles from './Logo.module.scss';
export default function Logo({ large = false }: { large?: boolean }) {
  return (
    <span className={large ? styles.large : styles.logo}>
      AFTER<span>GG.</span>
    </span>
  );
}
