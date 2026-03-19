import TopNavigation from '@cloudscape-design/components/top-navigation';
import type { AuthUser } from '../../services/api';

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
        title: 'DocForge',
        logo: {
          src: '/logo.svg',
          alt: 'DocForge',
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
          text: 'GitHub',
          href: 'https://github.com/aws-samples/one-idp',
          external: true,
          externalIconAriaLabel: '(opens in new tab)',
        },
        {
          type: 'menu-dropdown',
          iconName: 'settings',
          ariaLabel: 'Settings',
          title: 'Settings',
          items: [
            { id: 'settings', text: 'Settings' },
            { id: 'about', text: 'About DocForge' },
          ],
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
              },
            ]
          : []),
      ]}
    />
  );
}
