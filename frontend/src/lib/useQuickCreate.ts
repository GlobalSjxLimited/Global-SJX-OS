import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Call with the page's "open create modal" setter. Strips ?new=1 from the URL after triggering so back/refresh doesn't reopen it. */
export function useQuickCreate(openCreate: () => void) {
  const [searchParams, setSearchParams] = useSearchParams();

  useEffect(() => {
    if (searchParams.get('new') === '1') {
      openCreate();
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
