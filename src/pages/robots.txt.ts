import site from '../../shared/site.json';
export const GET = () =>
  new Response(site.unlisted ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n', { headers: { 'Content-Type': 'text/plain' } });
