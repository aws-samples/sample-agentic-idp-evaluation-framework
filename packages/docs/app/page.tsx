import { redirect } from 'next/navigation';

// Next auto-prefixes basePath ('/docs'), so '/' here resolves to '/docs/'
// at the edge (the docs home). Keeps `/docs` root from 404'ing.
export default function HomePage() {
  redirect('/');
}
