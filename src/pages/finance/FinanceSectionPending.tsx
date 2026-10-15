import { Link } from 'react-router-dom';

interface FinanceSectionPendingProps {
  label: string;
}

/**
 * Shared "not built yet" screen for Finance hub cards whose backend doesn't
 * exist yet (custody/shifts, suppliers) — reused as-is rather than one
 * near-identical placeholder per section.
 */
export default function FinanceSectionPending({ label }: FinanceSectionPendingProps) {
  return (
    <div
      style={{
        minHeight: '60vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '14px',
        textAlign: 'center',
        padding: '32px',
      }}
    >
      <div style={{ fontSize: '40px' }}>🚧</div>
      <h2 style={{ fontSize: '22px', fontWeight: 800, color: '#111827' }}>
        قسم &quot;{label}&quot; قيد التطوير
      </h2>
      <p style={{ fontSize: '14px', color: '#4b5563', maxWidth: '480px', lineHeight: 1.7 }}>
        هذا القسم موجود ضمن خطة تطوير المالية والذمم، لكنه لم يُبنَ بعد. سيصبح متاحاً هنا فور
        اكتماله.
      </p>
      <Link
        to="/finance"
        className="toolbar-btn primary"
        style={{ fontSize: '15px', padding: '11px 20px', textDecoration: 'none', marginTop: '8px' }}
      >
        → الذمم والمالية
      </Link>
    </div>
  );
}
