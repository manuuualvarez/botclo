import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";

// Rutas visibles sin iniciar sesión. Todo lo demás (dashboard, API propia,
// etc.) exige usuario autenticado. El tick del bot tiene su propia
// autenticación por secreto compartido (x-cron-secret).
const isPublicRoute = createRouteMatcher([
  "/",
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/legal(.*)", // documentos legales, accesibles sin login
  "/arrepentimiento", // botón de arrepentimiento (Res. 424/2020 SCI)
  "/api/bot/tick",
  "/api/mp/webhook", // firmado con MP_WEBHOOK_SECRET, no con Clerk
]);

export default clerkMiddleware(async (auth, request) => {
  if (!isPublicRoute(request)) {
    await auth.protect();
  }
});

export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
    "/__clerk/:path*",
  ],
};
