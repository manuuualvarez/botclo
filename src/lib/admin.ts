import { currentUser } from "@clerk/nextjs/server";

// Rol admin por lista de emails en .env (ADMIN_EMAILS, separados por coma).
// Simple, auditable y sin tocar el dashboard de Clerk.
//
// SEGURIDAD: solo cuenta el email PRIMARIO y VERIFICADO. Un email secundario
// no verificado igual aparece en user.emailAddresses, así que cualquiera
// podría agregar el mail de un admin a su cuenta y escalar privilegios si no
// filtramos por verificación + primario.
export async function isAdmin(): Promise<boolean> {
  // currentUser() va PRIMERO a propósito: es la API dinámica que le dice a
  // Next que la ruta se renderiza por request. Si el allowlist se evalúa
  // antes y ADMIN_EMAILS no existe en el entorno del BUILD (en CI no está),
  // el short-circuit devuelve false sin tocar ninguna API dinámica y Next
  // prerenderiza el notFound() del layout como 404 ESTÁTICO — /admin queda
  // muerto en producción aunque el runtime tenga la variable bien puesta.
  const user = await currentUser();
  if (!user) return false;

  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (allowed.length === 0) return false;

  const primary = user.emailAddresses.find(
    (e) => e.id === user.primaryEmailAddressId
  );
  if (!primary || primary.verification?.status !== "verified") return false;

  return allowed.includes(primary.emailAddress.toLowerCase());
}
