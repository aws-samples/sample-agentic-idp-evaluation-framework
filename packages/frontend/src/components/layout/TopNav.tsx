import TopNavigation from '@cloudscape-design/components/top-navigation';
import type { AuthUser } from '../../services/api';
import { clearToken } from '../../services/midway';

interface TopNavProps {
  user: AuthUser | null;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
}

const APP_TITLE = import.meta.env.VITE_APP_TITLE || 'ONE IDP Framework';
// External links (GitLab, Slack) are surfaced only in local dev builds by
// default. `npm run dev` sets import.meta.env.DEV=true; production `vite build`
// strips them unless explicitly opted in via VITE_SHOW_LINKS=true.
const SHOW_LINKS = import.meta.env.DEV || import.meta.env.VITE_SHOW_LINKS === 'true';
const REPO_URL = SHOW_LINKS ? import.meta.env.VITE_REPO_URL || '' : '';
const REPO_LABEL = import.meta.env.VITE_REPO_LABEL || 'Source';
const CHAT_URL = SHOW_LINKS ? import.meta.env.VITE_CHAT_URL || '' : '';
const CHAT_LABEL = import.meta.env.VITE_CHAT_LABEL || 'Chat';

function externalLink(text: string, href: string) {
  return {
    type: 'button' as const,
    text,
    href,
    external: true,
    externalIconAriaLabel: '(opens in new tab)',
  };
}

export default function TopNav({ user, darkMode, onToggleDarkMode }: TopNavProps) {
  return (
    <TopNavigation
      identity={{
        href: '/',
        title: APP_TITLE,
        logo: {
          src: '/logo-dark.svg',
          alt: APP_TITLE,
        },
      }}
      utilities={[
        {
          type: 'button',
          iconName: darkMode ? 'status-positive' : 'status-stopped',
          text: darkMode ? 'Light Mode' : 'Dark Mode',
          onClick: onToggleDarkMode,
        },
        ...(REPO_URL ? [externalLink(REPO_LABEL, REPO_URL)] : []),
        ...(CHAT_URL ? [externalLink(CHAT_LABEL, CHAT_URL)] : []),
        ...(user
          ? [
              {
                type: 'menu-dropdown' as const,
                text: user.alias,
                description: user.email,
                iconName: 'user-profile' as const,
                items: [
                  { id: 'profile', text: `Signed in as ${user.alias}` },
                  { id: 'signout', text: 'Sign out' },
                ],
                onItemClick: ({ detail }: { detail: { id: string } }) => {
                  if (detail.id === 'signout') {
                    clearToken();
                    window.location.reload();
                  }
                },
              },
            ]
          : []),
      ]}
    />
  );
}
