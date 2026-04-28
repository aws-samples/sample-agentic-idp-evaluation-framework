import TopNavigation from '@cloudscape-design/components/top-navigation';
import type { AuthUser } from '../../services/api';

interface TopNavProps {
  user: AuthUser | null;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
}

const APP_TITLE = import.meta.env.VITE_APP_TITLE || 'ONE IDP Framework';

// External links are only shown when explicitly opted in via VITE_SHOW_LINKS=true.
const SHOW_LINKS = import.meta.env.VITE_SHOW_LINKS === 'true';

const REPO_URL = SHOW_LINKS
  ? (import.meta.env.VITE_REPO_URL || 'https://github.com/aws-samples/sample-agentic-idp-evaluation-framework')
  : '';
const REPO_LABEL = import.meta.env.VITE_REPO_LABEL || 'GitHub';
const CHAT_URL = SHOW_LINKS
  ? (import.meta.env.VITE_CHAT_URL || '')
  : '';
const CHAT_LABEL = import.meta.env.VITE_CHAT_LABEL || 'Slack';

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
          text: 'Docs',
          href: '/docs',
        },
        // GitLab + Slack sit right after Docs — easier to find from the nav.
        ...(REPO_URL ? [externalLink(REPO_LABEL, REPO_URL)] : []),
        ...(CHAT_URL ? [externalLink(CHAT_LABEL, CHAT_URL)] : []),
        {
          type: 'button',
          iconName: darkMode ? 'status-positive' : 'status-stopped',
          text: darkMode ? 'Light Mode' : 'Dark Mode',
          onClick: onToggleDarkMode,
        },
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
