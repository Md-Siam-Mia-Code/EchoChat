// src/utils.js

/** Performs SHA-256 hashing. */
export async function sha256(str) {
     try {
          const buffer = new TextEncoder().encode(str);
          const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
          const hashArray = Array.from(new Uint8Array(hashBuffer));
          const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
          return hashHex;
     } catch (error) {
          console.error("FATAL: Error in sha256 function:", error);
          throw new Error("Password hashing failed internally.");
     }
}

/** Utility function for consistent JSON responses with CORS headers. */
export function jsonResponse(body, status = 200, headers = {}) {
     // Default CORS headers (restrict in production)
     const defaultCorsHeaders = {
          'Access-Control-Allow-Origin': '*', // WARNING: Use specific origin in production
          'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Authorization', // Include Authorization
     };
     const finalHeaders = {
          ...defaultCorsHeaders,
          ...headers, // Allow overriding defaults
          'Content-Type': 'application/json',
     };
     return new Response(JSON.stringify(body), { status, headers: finalHeaders });
}

/** Handles CORS preflight (OPTIONS) requests. */
export function handleOptions(request) {
     let headers = request.headers;
     if (
          headers.get("Origin") !== null &&
          headers.get("Access-Control-Request-Method") !== null &&
          headers.get("Access-Control-Request-Headers") !== null
     ) {
          // Reflect requested headers for preflight response
          let respHeaders = {
               "Access-Control-Allow-Origin": "*", // WARNING: Restrict in production
               "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
               "Access-Control-Allow-Headers": headers.get("Access-Control-Request-Headers"),
               "Access-Control-Max-Age": "86400", // Cache preflight for 1 day
          };
          return new Response(null, { headers: respHeaders });
     } else {
          // Handle standard OPTIONS request
          return new Response(null, {
               headers: { "Allow": "GET, POST, PUT, DELETE, OPTIONS" },
          });
     }
}

/** Basic input validation helper */
export function validateInput(data, requiredFields) {
     if (!data) return "Request body is missing or invalid.";
     for (const field of requiredFields) {
          if (data[field] === undefined || data[field] === null || (typeof data[field] === 'string' && data[field].trim() === '')) {
               return `Missing or empty required field: ${field}`;
          }
     }
     // Add more specific validations
     if (data.username && (typeof data.username !== 'string' || data.username.length < 3)) return "Username must be a string of at least 3 characters.";
     if (data.password && (typeof data.password !== 'string' || data.password.length < 8)) return "Password must be a string of at least 8 characters.";
     if (data.masterPassword && (typeof data.masterPassword !== 'string' || data.masterPassword.length < 10)) return "Master Password must be a string of at least 10 characters.";
     if (data.content && typeof data.content !== 'string') return "Message content must be a string.";
     if (data.name && typeof data.name !== 'string') return "Group name must be a string.";
     if (data.userId && typeof data.userId !== 'number') return "User ID must be a number.";
     if (data.partnerId && typeof data.partnerId !== 'number') return "Partner ID must be a number.";
     if (data.members && !Array.isArray(data.members)) return "Group members must be an array.";

     return null; // Validation passed
}