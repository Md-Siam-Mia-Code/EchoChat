// src/auth.js
import { sha256, jsonResponse } from './utils.js';
import { getAppConfig } from './db.js';

// --- Basic Session Management (INSECURE PLACEHOLDER - Replace with JWT) ---
// This simple token is NOT suitable for production.
// It doesn't expire properly across worker instances and is easily guessable.

const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hour (used for basic timestamp check)

/**
 * Generates a simple, insecure session token (replace with JWT).
 * Format: "userid-timestamp-random".
 */
export function generateSessionToken(userId) {
    if (typeof userId !== 'number') {
        console.error("Cannot generate token for invalid userId:", userId);
        return null; // Or throw error
    }
    const timestamp = Date.now();
    const randomPart = Math.random().toString(36).substring(2, 15);
    return `${userId}-${timestamp}-${randomPart}`;
}

/**
 * Verifies a session token from the Authorization header ("Bearer <token>").
 * Returns the userId if valid based on placeholder logic, null otherwise.
 * !!! THIS IS A PLACEHOLDER - Implement proper JWT verification here !!!
 */
export async function verifySessionToken(request) {
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return null;
    }
    const token = authHeader.substring(7); // Remove "Bearer "

    // --- !! INSECURE PLACEHOLDER VERIFICATION !! ---
    try {
        const parts = token.split('-');
        if (parts.length < 3) return null; // Invalid format
        const userId = parseInt(parts[0], 10);
        const timestamp = parseInt(parts[1], 10);

        if (isNaN(userId) || isNaN(timestamp)) return null; // Invalid parts

        // Basic expiry check based on timestamp in token
        if (Date.now() - timestamp > SESSION_DURATION_MS) {
            console.warn(`Placeholder token expired for user ${userId}`);
            return null;
        }

        // In a real JWT scenario, you would verify the signature against a secret key here.
        // Example:
        // const isValid = await verifyJwtSignature(token, env.JWT_SECRET);
        // if (!isValid) return null;
        // const payload = decodeJwt(token); // Assuming decode doesn't verify
        // if (payload.exp * 1000 < Date.now()) return null; // Check JWT expiry
        // return payload.sub; // Return user ID from JWT subject

        // For placeholder, just return the parsed userId if format is okay and timestamp isn't too old
        return userId;
    } catch (e) {
        console.error("Error verifying placeholder token:", e);
        return null;
    }
}

/**
 * Middleware-like function to protect routes.
 * Calls the handler only if the user is authenticated via verifySessionToken.
 * Adds `userId` to the request object.
 */
export async function requireAuth(request, env, ctx, handler) {
    const userId = await verifySessionToken(request);
    if (!userId) {
        // Use error object format consistent with apiCall error handling
        const error = new Error('Unauthorized');
        error.status = 401;
        throw error;
        // return jsonResponse({ error: 'Unauthorized' }, 401); // Old way
    }
    request.userId = userId; // Modify request object
    return handler(request, env, ctx); // Pass modified request
}

/**
 * Middleware-like function to protect admin routes.
 * Checks authentication and admin status in DB.
 */
export async function requireAdminAuth(request, env, ctx, handler) {
    const userId = await verifySessionToken(request);
    if (!userId) {
        const error = new Error('Unauthorized');
        error.status = 401;
        throw error;
    }

    // Check if the user is an admin in the database
    try {
        const user = await env.DB.prepare('SELECT is_admin FROM users WHERE id = ?1').bind(userId).first();
        if (!user || !user.is_admin) {
            const error = new Error('Forbidden: Admin access required');
            error.status = 403;
            throw error;
            // return jsonResponse({ error: 'Forbidden: Admin access required' }, 403); // Old way
        }
    } catch (dbError) {
        console.error("Admin check DB error:", dbError);
        const error = new Error('Internal server error during authorization');
        error.status = 500;
        throw error;
        // return jsonResponse({ error: 'Internal server error during authorization' }, 500); // Old way
    }

    request.userId = userId; // Add userId to request
    return handler(request, env, ctx);
}


/**
 * Special authentication using the Master Password.
 * Returns true if valid, false otherwise.
 */
export async function verifyMasterPassword(db, providedPassword) {
    if (!providedPassword) return false;
    const storedHash = await getAppConfig(db, 'master_password_hash');
    if (!storedHash) {
        console.error("Master password hash not found in config!");
        return false; // Should not happen after onboarding
    }
    try {
        const providedHash = await sha256(providedPassword);
        return providedHash === storedHash;
    } catch (hashError) {
        console.error("Error hashing provided master password:", hashError);
        return false;
    }
}