import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

/**
 * GET /api/pizzeria/media/:filename
 *
 * Serves pizza images for the pizzeria simulation. Acts as a portable
 * image CDN: if the file exists locally in /public/pizzeria/, serves it
 * directly. Otherwise, proxies from the Supabase Storage bucket
 * 'pizzeria-media'.
 *
 * This indirection means image URLs in the pizzeria database are
 * decoupled from the storage backend — changing where images live only
 * requires updating this route, not the data rows.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ filename: string }> }
) {
  const { filename } = await params;

  // Security: only allow safe filenames
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '');
  if (safeName !== filename) {
    return NextResponse.json({ error: 'Invalid filename' }, { status: 400 });
  }

  // 1. Try local filesystem first (for local dev / when images are in repo)
  const localPath = path.join(process.cwd(), 'public', 'pizzeria', safeName);
  if (fs.existsSync(localPath)) {
    const buffer = fs.readFileSync(localPath);
    const mimeType = safeName.endsWith('.png') ? 'image/png' : 'image/jpeg';
    return new NextResponse(buffer, {
      headers: {
        'Content-Type': mimeType,
        'Cache-Control': 'public, max-age=31536000', // 1 year CDN cache
      },
    });
  }

  // 2. Fall back to Supabase Storage bucket
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const { data, error } = await supabase.storage
      .from('pizzeria-media')
      .list('', { search: safeName });

    if (error || !data || data.length === 0) {
      // Try common path pattern: account-<id>/<filename>
      // Since we don't know the account_id here, try the root
      const { data: publicData } = supabase.storage
        .from('pizzeria-media')
        .getPublicUrl(safeName);

      const resp = await fetch(publicData.publicUrl);
      if (resp.ok) {
        const buffer = await resp.arrayBuffer();
        const mimeType = safeName.endsWith('.png') ? 'image/png' : 'image/jpeg';
        return new NextResponse(buffer, {
          headers: {
            'Content-Type': mimeType,
            'Cache-Control': 'public, max-age=31536000',
          },
        });
      }
    }

    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  } catch {
    return NextResponse.json({ error: 'Image not found' }, { status: 404 });
  }
}
