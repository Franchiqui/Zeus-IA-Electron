export type ImageResult = {
  id: string;
  width: number;
  height: number;
  alt: string;
  photographer?: string;
  link?: string;
  urls: {
    raw?: string;
    full?: string;
    regular?: string;
    small?: string;
    thumb?: string;
  };
};

export async function searchImages(params: {
  query?: string;
  category?: string;
  limit?: number;
  orientation?: 'landscape' | 'portrait' | 'squarish';
}): Promise<ImageResult[]> {
  const q = params.query || params.category || '';
  if (!q) return [];
  const url = new URL('/api/images', typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  url.searchParams.set('query', q);
  if (params.limit) url.searchParams.set('limit', String(params.limit));
  if (params.orientation) url.searchParams.set('orientation', params.orientation);

  const res = await fetch(url.toString(), { cache: 'no-store' });
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data?.results) ? data.results : [];
}