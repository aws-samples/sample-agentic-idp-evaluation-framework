import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

export const baseOptions: BaseLayoutProps = {
  nav: {
    title: 'ONE IDP Docs',
  },
  links: [
    { text: 'App', url: '/', external: true },
    { text: 'GitHub', url: 'https://github.com/aws-samples/sample-agentic-idp-evaluation-framework', external: true },
  ],
};
