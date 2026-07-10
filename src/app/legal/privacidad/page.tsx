import { LEGAL_HOLDER, LEGAL_VERSIONS } from "@/config/legal";

export const metadata = { title: "Política de Privacidad" };

export default function PrivacidadPage() {
  return (
    <>
      <h1>Política de Privacidad de Botclo</h1>
      <p className="text-xs">Versión {LEGAL_VERSIONS.privacy}</p>

      <h2>1. Responsable de la base de datos</h2>
      <p>
        Responsable del tratamiento: <strong>{LEGAL_HOLDER.nombre}</strong>,
        CUIT {LEGAL_HOLDER.cuit}, {LEGAL_HOLDER.ciudad}, Argentina. Contacto:{" "}
        <strong>{LEGAL_HOLDER.emailPrivacidad}</strong>. Esta política se rige
        por la <strong>Ley 25.326 de Protección de los Datos Personales</strong>,
        su decreto 1558/2001 y las disposiciones de la AAIP.
      </p>

      <h2>2. Qué datos recolectamos</h2>
      <ul>
        <li>
          <strong>Cuenta:</strong> nombre, correo, contraseña (hasheada por
          nuestro proveedor de autenticación), foto opcional.
        </li>
        <li>
          <strong>Claves de API de Binance:</strong> API key y secret con
          permisos de lectura y trading spot (sin retiro), que cargás vos.
        </li>
        <li>
          <strong>Datos de cartera y operaciones:</strong> balances,
          composición, historial de órdenes, snapshots de valor — obtenidos de
          Binance con tus claves.
        </li>
        <li>
          <strong>Configuración:</strong> estrategias, parámetros, presupuestos,
          respuestas al cuestionario de perfil.
        </li>
        <li>
          <strong>Pagos:</strong> plan, estado de suscripción, identificadores
          de MercadoPago. <strong>No almacenamos números de tarjeta.</strong>
        </li>
        <li>
          <strong>Notificaciones (opcional):</strong> token de bot y chat de
          Telegram si las activás.
        </li>
        <li>
          <strong>Técnicos:</strong> IP, dispositivo/navegador, registros de
          acceso, cookies estrictamente necesarias.
        </li>
        <li>
          <strong>Aceptaciones legales:</strong> fecha, hora, IP y versión de
          los documentos que aceptaste.
        </li>
      </ul>
      <p>No recolectamos datos sensibles (art. 2, Ley 25.326).</p>

      <h2>3. Para qué usamos tus datos</h2>
      <p>
        Para prestarte el servicio (mostrar tu cartera, ejecutar backtests,
        operar el robot que configuraste, enviarte notificaciones que pediste);
        gestionar tu suscripción y cobranzas; seguridad y prevención de fraude;
        y cumplir obligaciones legales. Base de licitud: tu{" "}
        <strong>consentimiento</strong> (art. 5, Ley 25.326) y la ejecución del
        contrato. No vendemos ni cedemos tus datos con fines publicitarios. No
        tomamos decisiones automatizadas sobre tu persona: el robot opera según
        reglas que <strong>vos</strong> configuraste.
      </p>

      <h2>4. Cómo protegemos tus datos — en especial tus claves de API</h2>
      <ul>
        <li>
          Tus claves se guardan <strong>cifradas con AES-256-GCM</strong>; la
          clave de cifrado se gestiona fuera de la base de datos. Nunca en texto
          plano, nunca en logs; solo se descifran en memoria al firmar una
          solicitud a Binance.
        </li>
        <li>
          Exigimos que tus claves <strong>no tengan permiso de retiro</strong>:
          aunque alguien las obtuviera, no podría transferir tus fondos.
        </li>
        <li>Tráfico cifrado con TLS (HTTPS); acceso a servidores restringido.</li>
        <li>
          Adoptamos las medidas del art. 9 de la Ley 25.326 y las
          recomendaciones de la AAIP (Res. 47/2018).
        </li>
      </ul>
      <p>
        Ante un incidente de seguridad que afecte tus datos, te lo
        notificaremos sin demora junto con las medidas recomendadas (por
        ejemplo, rotar tus claves en Binance).
      </p>

      <h2>5. Con quién compartimos datos</h2>
      <p>
        Solo con los proveedores necesarios para operar: <strong>Clerk</strong>{" "}
        (autenticación, EE.UU.), <strong>MercadoPago</strong> (pagos,
        Argentina), <strong>Binance</strong> (exchange donde está tu cuenta),{" "}
        <strong>Hostinger</strong> (infraestructura) y{" "}
        <strong>Telegram</strong> (notificaciones opcionales). Algunos procesan
        datos fuera de Argentina; al aceptar esta política prestás tu
        consentimiento a esas transferencias (art. 12, Ley 25.326). Fuera de
        estos casos, solo cederemos datos ante requerimiento de autoridad
        competente.
      </p>

      <h2>6. Cuánto tiempo conservamos los datos</h2>
      <ul>
        <li>Cuenta y configuración: mientras tu cuenta esté activa.</li>
        <li>
          Claves de API: hasta que las elimines, reemplaces o des de baja —{" "}
          <strong>se suprimen de inmediato</strong>.
        </li>
        <li>Facturación: 10 años (obligaciones impositivas).</li>
        <li>Aceptaciones legales y logs del robot: 5 años desde la baja.</li>
      </ul>

      <h2>7. Tus derechos</h2>
      <p>
        Tenés derecho a <strong>acceder</strong> (gratis, cada 6 meses — art.
        14), <strong>rectificar, actualizar y suprimir</strong> tus datos (art.
        16) y a <strong>retirar tu consentimiento</strong>. Escribí a{" "}
        {LEGAL_HOLDER.emailPrivacidad} desde el correo de tu cuenta. Además,
        podés eliminar tus claves y tu cuenta directamente desde la Plataforma.
      </p>
      <p>
        <strong>
          La Agencia de Acceso a la Información Pública, órgano de control de la
          Ley 25.326, atiende las denuncias y reclamos por incumplimiento de las
          normas de protección de datos personales
        </strong>{" "}
        —{" "}
        <a
          href="https://www.argentina.gob.ar/aaip"
          target="_blank"
          rel="noopener noreferrer"
        >
          argentina.gob.ar/aaip
        </a>
        .
      </p>

      <h2>8. Cookies</h2>
      <p>
        Botclo usa únicamente cookies estrictamente necesarias para mantener tu
        sesión y la seguridad. No usamos cookies publicitarias de terceros.
      </p>

      <h2>9. Menores</h2>
      <p>
        Botclo está dirigido exclusivamente a mayores de 18 años. No
        recolectamos deliberadamente datos de menores.
      </p>
    </>
  );
}
