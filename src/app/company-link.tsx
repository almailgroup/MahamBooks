import { useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router';
import { useCompany, useOpenInCompany } from './company';

/**
 * A link into a company (…?company=<id>, as the pay run approval emails
 * have it, #10): that company is opened first, then the page, above the
 * app's gate. So the gate judges the person's place in the company of the
 * link, not in the company open on this device before. A company this
 * device doesn't have (or a switch the person doesn't confirm) leaves the
 * page in the company that is open.
 */
export function CompanyOfLink({ children }: { children: ReactNode }) {
  const company = useCompany();
  const [params] = useSearchParams();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const openInCompany = useOpenInCompany();
  const wanted = params.get('company');
  // The company of a link that couldn't be opened: the page shows in this one.
  const [stayed, setStayed] = useState<string | null>(null);
  useEffect(() => {
    if (!wanted) return;
    if (wanted === company.id) {
      navigate(pathname, { replace: true });
      return;
    }
    let live = true;
    const stay = () => {
      if (!live) return;
      setStayed(wanted);
      navigate(pathname, { replace: true });
    };
    void openInCompany(wanted, pathname).then((opened) => {
      if (!opened) stay();
    }, stay);
    return () => {
      live = false;
    };
  }, [wanted, company.id, pathname, navigate, openInCompany]);
  // Nothing of this company's page while the company of the link opens.
  if (wanted && wanted !== company.id && stayed !== wanted) return null;
  return <>{children}</>;
}
