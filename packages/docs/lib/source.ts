import { docs } from 'collections/server';
import { loader } from 'fumadocs-core/source';

// baseUrl is relative to Next's basePath, which is already '/docs'.
// Using '/' here produces links like '/docs/<slug>' instead of '/docs/docs/<slug>'.
export const source = loader({
  baseUrl: '/',
  source: docs.toFumadocsSource(),
});
