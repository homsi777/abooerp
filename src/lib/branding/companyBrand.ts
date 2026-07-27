/** هوية الشركة — مسارات ثابتة للواجهة والطباعة */
export const COMPANY_NAME_AR = 'شركة عبو المحمود لنقل والخدمات الوجستية';
export const COMPANY_NAME_EN = 'ABBO AL-MAHMOUD FOR TRANSPORT & LOGISTICS';
export const COMPANY_LOGO_PATH = '/branding/company-logo.png';
export const COMPANY_FAVICON_PATH = '/branding/favicon.png';

/** عنوان مطلق للوغو داخل HTML الطباعة/PDF */
export function resolveCompanyLogoPrintSrc(baseOrigin?: string): string {
  const base = (baseOrigin ?? (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/$/, '');
  const path = `${import.meta.env.BASE_URL}${COMPANY_LOGO_PATH.replace(/^\//, '')}`.replace(/\/{2,}/g, '/');
  if (base) {
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }
  return COMPANY_LOGO_PATH;
}
