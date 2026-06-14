import { NextResponse } from 'next/server';

const UNSPLASH_API = 'https://api.unsplash.com/search/photos';

export const runtime = 'nodejs';
export const revalidate = 60;

function buildQuery(params: URLSearchParams) {
  const q = params.get('query') || params.get('category') || '';
  const page = params.get('page') || '1';
  const perPage = params.get('per_page') || params.get('limit') || '12';
  return { q, page, perPage };
}

export async function GET(request: Request) {
  try {
    const accessKey = process.env.UNSPLASH_ACCESS_KEY;
    if (!accessKey) {
      return NextResponse.json({ error: 'Falta UNSPLASH_ACCESS_KEY' }, { status: 500 });
    }

    const { searchParams } = new URL(request.url);
    const { q, page, perPage } = buildQuery(searchParams);
    if (!q) {
      return NextResponse.json({ error: 'Parámetro query/category requerido' }, { status: 400 });
    }

    const url = new URL(UNSPLASH_API);
    url.searchParams.set('query', q);
    url.searchParams.set('page', page);
    url.searchParams.set('per_page', perPage);
    url.searchParams.set('order_by', searchParams.get('order_by') || 'relevant');
    url.searchParams.set('content_filter', searchParams.get('content_filter') || 'high');

    const orientation = searchParams.get('orientation');
    if (orientation) url.searchParams.set('orientation', orientation);

    const resp = await fetch(url.toString(), {
      headers: {
        Authorization: `Client-ID ${accessKey}`,
        'Accept-Version': 'v1',
      },
      next: { revalidate },
    });

    if (!resp.ok) {
      const text = await resp.text();
      return NextResponse.json({ error: 'Error Unsplash', status: resp.status, body: text }, { status: 502 });
    }

    const data = await resp.json();
    const results = Array.isArray(data?.results) ? data.results : [];
    const mapped = results.map((p: any) => ({
      id: p?.id,
      width: p?.width,
      height: p?.height,
      alt: p?.alt_description || p?.description || '',
      photographer: p?.user?.name,
      link: p?.links?.html,
      urls: {
        raw: p?.urls?.raw,
        full: p?.urls?.full,
        regular: p?.urls?.regular,
        small: p?.urls?.small,
        thumb: p?.urls?.thumb,
      },
    }));

    return NextResponse.json({ query: q, page: Number(page), per_page: Number(perPage), results: mapped });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Error inesperado' }, { status: 500 });
  }
}
