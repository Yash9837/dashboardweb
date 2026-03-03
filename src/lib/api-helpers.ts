/**
 * External API — CORS + Auth helpers
 *
 * All /api/external/* endpoints use these for:
 * - CORS headers (allow any origin for external apps)
 * - Optional API key authentication
 * - Standard error response format
 */

import { NextResponse } from 'next/server';

const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-API-Key',
    'Access-Control-Max-Age': '86400',
};

export function corsHeaders() {
    return CORS_HEADERS;
}

export function optionsResponse() {
    return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export function jsonResponse(data: any, status = 200) {
    return NextResponse.json(data, { status, headers: CORS_HEADERS });
}

export function errorResponse(message: string, status = 500) {
    return NextResponse.json(
        { success: false, error: message, timestamp: new Date().toISOString() },
        { status, headers: CORS_HEADERS },
    );
}

/**
 * Validate API key if EXTERNAL_API_KEY env var is set.
 * Returns null if valid, or an error response if invalid.
 */
export function validateApiKey(request: Request): NextResponse | null {
    const requiredKey = process.env.EXTERNAL_API_KEY;
    if (!requiredKey) return null; // no auth required

    const headerKey = request.headers.get('x-api-key') || request.headers.get('authorization')?.replace('Bearer ', '');
    const { searchParams } = new URL(request.url);
    const queryKey = searchParams.get('api_key');

    const providedKey = headerKey || queryKey;
    if (providedKey !== requiredKey) {
        return errorResponse('Invalid or missing API key. Pass via X-API-Key header or api_key query param.', 401);
    }
    return null;
}
