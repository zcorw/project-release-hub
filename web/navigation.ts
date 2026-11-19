import { useEffect, useRef, useState } from 'react';

type WorkspacePage = 'overview' | 'pending' | 'history';
interface WorkspaceRoute {
  page: WorkspacePage;
  projectId: string | null;
}

function readRoute(): WorkspaceRoute {
  const params = new URLSearchParams(window.location.search);
  const projectId = params.get('project');
  const view = params.get('view');
  return {
    page:
      projectId !== null
        ? 'overview'
        : view === 'pending' || view === 'history'
          ? view
          : 'overview',
    projectId,
  };
}

export function useWorkspaceNavigation() {
  const currentVisit = useRef(0);
  const [route, setRoute] = useState(() => ({ ...readRoute(), visit: 0 }));
  function restore() {
    setRoute({ ...readRoute(), visit: ++currentVisit.current });
  }
  useEffect(() => {
    window.addEventListener('popstate', restore);
    return () => window.removeEventListener('popstate', restore);
  }, []);

  function navigate(page: WorkspacePage, projectId: string | null = null) {
    const url = new URL(window.location.href);
    url.searchParams.delete('project');
    url.searchParams.delete('view');
    if (projectId !== null) url.searchParams.set('project', projectId);
    else if (page !== 'overview') url.searchParams.set('view', page);
    const destination = url.pathname + url.search + url.hash;
    if (destination !== window.location.pathname + window.location.search + window.location.hash)
      window.history.pushState(window.history.state, '', destination);
    restore();
  }

  return { ...route, navigate, isCurrentVisit: (visit: number) => currentVisit.current === visit };
}
