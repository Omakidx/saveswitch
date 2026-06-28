import { NextResponse } from 'next/server';
import { API_BASE } from '@/lib/api';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  
  try {
    const res = await fetch(`${API_BASE}/resources/${id}`);
    if (!res.ok) {
      return new NextResponse('Resource not found', { status: 404 });
    }
    
    const data = await res.json();
    if (!data.success || !data.resource) {
      return new NextResponse('Resource not found', { status: 404 });
    }
    
    // Redirect to the actual download URL (e.g. Cloudinary raw URL)
    // Cloudinary raw URLs force attachment downloads by default.
    return NextResponse.redirect(data.resource.content);
  } catch (error) {
    console.error("Error fetching resource:", error);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
