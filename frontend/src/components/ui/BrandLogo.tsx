/** The Global SJX company logo (served from /logo.png — the same image used in e-mails and PDFs). */
export function BrandLogo({ size = 34, rounded = 9 }: { size?: number; rounded?: number }) {
  return <img src="/logo.png" alt="Global SJX" width={size} height={size} style={{ width: size, height: size, borderRadius: rounded, objectFit: 'contain', background: '#fff', flexShrink: 0 }} />;
}
