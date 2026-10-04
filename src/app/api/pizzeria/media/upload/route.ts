import { NextRequest, NextResponse } from 'next/server';
import path from 'path';
import fs from 'fs';

/**
 * POST /api/pizzeria/media/upload
 * Uploads pizza images to the pizzeria-media bucket in Supabase Storage.
 *
 * This endpoint is called once (e.g. during setup/seed) to move
 * local images from /public/pizzeria/ into the Supabase bucket,
 * making the data truly portable — the image_url column in
 * pizzeria_pizzas points to the bucket's publicUrl, so swapping
 * from waCRM to another engine only requires re-running this upload
 * under a different supabaseUrl.
 */
export async function POST(request: NextRequest) {
  try {
    const { createClient } = await import('@/lib/supabase/server');
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { account_id, filenames } = body;

    if (!account_id || !Array.isArray(filenames)) {
      return NextResponse.json(
        { error: 'Missing account_id or filenames' },
        { status: 400 }
      );
    }

    const uploaded: Array<{ filename: string; url: string }> = [];
    const errors: Array<{ filename: string; error: string }> = [];

    // Sanitize filename BEFORE touching the filesystem: strip any
    // path component so "../../.env" style payloads can't read files
    // outside /public/pizzeria. Only simple names are allowed.
    const uploads: Array<{ filename: string; buffer: Buffer; mime: string }> =
      [];

    for (const rawName of filenames) {
      if (typeof rawName !== 'string') continue;
      const filename = path.basename(rawName);
      if (
        filename !== rawName ||
        !/^[a-zA-Z0-9._-]+$/.test(filename) ||
        filename.includes('..')
      ) {
        errors.push({ filename: String(rawName), error: 'Invalid filename' });
        continue;
      }

      const localPath = path.join(
        process.cwd(),
        'public',
        'pizzeria',
        filename
      );

      if (!fs.existsSync(localPath)) {
        errors.push({ filename, error: 'File not found in /public/pizzeria/' });
        continue;
      }

      const mimeType = filename.endsWith('.png')
        ? 'image/png'
        : filename.endsWith('.webp')
          ? 'image/webp'
          : 'image/jpeg';

      uploads.push({
        filename,
        buffer: fs.readFileSync(localPath),
        mime: mimeType,
      });
    }

    for (const { filename, buffer, mime } of uploads) {
      const storagePath = `account-${account_id}/${filename}`;

      const { error: uploadError } = await supabase.storage
        .from('pizzeria-media')
        .upload(storagePath, buffer, {
          contentType: mime,
          upsert: true,
        });

      if (uploadError) {
        errors.push({ filename, error: uploadError.message });
        continue;
      }

      const {
        data: { publicUrl },
      } = supabase.storage.from('pizzeria-media').getPublicUrl(storagePath);

      uploaded.push({ filename, url: publicUrl });
    }

    return NextResponse.json({ uploaded, errors });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
