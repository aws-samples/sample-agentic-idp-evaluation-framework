import TopNavigation from '@cloudscape-design/components/top-navigation';
import type { AuthUser } from '../../services/api';
import { clearToken } from '../../services/midway';

interface TopNavProps {
  user: AuthUser | null;
  darkMode?: boolean;
  onToggleDarkMode?: () => void;
}

export default function TopNav({ user, darkMode, onToggleDarkMode }: TopNavProps) {
  return (
    <TopNavigation
      identity={{
        href: '/',
        title: 'ONE IDP Framework',
        logo: {
          src: '/logo-dark.svg',
          alt: 'ONE IDP Framework',
        },
      }}
      utilities={[
        {
          type: 'button',
          iconName: darkMode ? 'status-positive' : 'status-stopped',
          text: darkMode ? 'Light Mode' : 'Dark Mode',
          onClick: onToggleDarkMode,
        },
        {
          type: 'button',
          text: 'GitLab',
          href: 'https://gitlab.aws.dev/sanghwa/one-idp',
          external: true,
          externalIconAriaLabel: '(opens in new tab)',
        },
        {
          type: 'button',
          text: 'Slack',
          href: 'https://amazon.enterprise.slack.com/archives/C0ATLG1TX1U',
          external: true,
          externalIconAriaLabel: '(opens in new tab)',
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
