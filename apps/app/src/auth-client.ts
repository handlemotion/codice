import { emailOTPClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** The browser's client of `/api/auth/*`, used by the sign-in page. */
export const authClient = createAuthClient({ plugins: [emailOTPClient()] });
