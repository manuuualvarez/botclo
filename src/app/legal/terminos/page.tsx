import { LEGAL_HOLDER, LEGAL_VERSIONS } from "@/config/legal";

export const metadata = { title: "Términos y Condiciones" };

export default function TerminosPage() {
  return (
    <>
      <h1>Términos y Condiciones de Uso de Botclo</h1>
      <p className="text-xs">Versión {LEGAL_VERSIONS.tos}</p>

      <h2>1. Identificación del titular</h2>
      <p>
        El sitio <strong>botclo.com</strong> y la aplicación{" "}
        <strong>Botclo</strong> (el «Servicio» o la «Plataforma») son operados
        por <strong>{LEGAL_HOLDER.nombre}</strong>, persona humana, CUIT{" "}
        {LEGAL_HOLDER.cuit}, {LEGAL_HOLDER.ciudad}, República Argentina (el
        «Titular»). Contacto: <strong>{LEGAL_HOLDER.emailSoporte}</strong>.
      </p>
      <p>
        Botclo <strong>no es una sociedad comercial, no es una entidad
        financiera, no es un agente registrado ante la Comisión Nacional de
        Valores (CNV), no es un Proveedor de Servicios de Activos Virtuales
        (PSAV) inscripto, y no está autorizado ni supervisado por el BCRA ni
        por la CNV.</strong> Botclo es una herramienta de software.
      </p>

      <h2>2. Aceptación</h2>
      <p>
        Al crear una cuenta, marcar la casilla de aceptación o usar el
        Servicio, el Usuario declara que leyó, entendió y aceptó estos Términos,
        la Política de Privacidad y el Aviso de Riesgo, que forman parte
        integrante de este acuerdo. Solo pueden usar Botclo personas humanas
        mayores de 18 años con capacidad legal para contratar.
      </p>

      <h2>3. Objeto: qué es (y qué NO es) Botclo</h2>
      <p>
        <strong>3.1. Qué es.</strong> Botclo es un software como servicio que se
        conecta a la cuenta personal del Usuario en Binance mediante claves de
        API que el propio Usuario genera y provee. Permite visualizar la
        cartera y rendimientos, realizar backtesting (simulaciones sobre datos
        históricos) y configurar y activar un robot de trading que, siguiendo
        exclusivamente la estrategia, el par, el presupuesto y los parámetros
        que el Usuario eligió y activó, envía órdenes de compra y venta spot
        (sin apalancamiento) a la cuenta de Binance del Usuario.
      </p>
      <p>
        <strong>3.2. Qué NO es. Leer con atención:</strong>
      </p>
      <ul>
        <li>
          <strong>Botclo NO brinda asesoramiento financiero, ni de inversión,
          ni impositivo, ni legal.</strong> Nada en la Plataforma —estrategias,
          resultados de backtesting, señales, gráficos, métricas o
          cuestionarios de perfil— constituye una recomendación personalizada.
          Es información y herramientas de carácter general y educativo.
        </li>
        <li>
          <strong>Botclo NO custodia fondos ni criptoactivos.</strong> Los
          fondos permanecen siempre en la cuenta de Binance del Usuario. Botclo
          nunca recibe, guarda ni puede retirar dinero ni criptoactivos.
        </li>
        <li>
          <strong>Botclo NO garantiza rendimientos, ganancias ni resultados de
          ningún tipo.</strong>
        </li>
        <li>
          <strong>Botclo NO es un exchange, ni un broker, ni un agente de bolsa,
          ni una entidad financiera.</strong>
        </li>
      </ul>

      <h2>4. Naturaleza no custodial y claves de API</h2>
      <p>
        4.1. El Usuario conecta su cuenta generando claves de API en Binance y
        cargándolas en Botclo, que las almacena <strong>cifradas</strong>.
      </p>
      <p>
        4.2. <strong>El Usuario debe generar las claves SIN permiso de retiro
        (withdrawal) habilitado.</strong> Botclo solicita expresamente
        únicamente permisos de lectura y de operaciones spot, y no necesita ni
        pide jamás permisos de retiro. Si el Usuario habilita permisos de
        retiro contra esta instrucción, lo hace bajo su exclusiva
        responsabilidad.
      </p>
      <p>
        4.3. Al cargar sus claves y activar el robot, el Usuario{" "}
        <strong>autoriza e instruye expresamente</strong> a Botclo a transmitir
        a Binance, en su nombre y por su cuenta, las órdenes que resulten de la
        estrategia y parámetros que el propio Usuario configuró. Esta
        autorización es revocable en cualquier momento (pausando o eliminando
        el robot, borrando las claves en Botclo, o revocándolas en Binance).
      </p>
      <p>
        4.4. La relación entre el Usuario y Binance se rige exclusivamente por
        los términos de Binance. Botclo no es parte de esa relación.
      </p>

      <h2>5. El robot de trading: responsabilidad del Usuario</h2>
      <p>
        5.1. El robot ejecuta mecánicamente reglas predefinidas que el Usuario
        seleccionó. <strong>Ninguna estrategia se activa sola: se requiere
        siempre una acción expresa del Usuario.</strong>
      </p>
      <p>
        5.2. El Usuario es el único responsable de elegir la estrategia y sus
        parámetros, definir el presupuesto (dinero cuya pérdida total pueda
        afrontar), monitorear el funcionamiento, pausar el robot cuando lo
        considere y cumplir sus obligaciones impositivas.
      </p>
      <p>
        5.3. <strong>El trading automatizado puede generar pérdidas mientras el
        Usuario no está mirando.</strong> El Usuario acepta que puede perder la
        totalidad del presupuesto asignado al robot.
      </p>
      <p>
        5.4. Botclo ofrece un modo práctica (testnet, sin dinero real) y
        recomienda enfáticamente usarlo antes de operar con dinero real. El
        modo real requiere una aceptación expresa y adicional del Aviso de
        Riesgo.
      </p>

      <h2>6. Riesgos</h2>
      <p>
        El Usuario declara conocer y aceptar los riesgos desarrollados en el{" "}
        <a href="/legal/riesgo">Aviso de Riesgo</a>: volatilidad extrema y
        posibilidad de pérdida total; ausencia de garantía estatal e
        irreversibilidad de las operaciones; que el rendimiento pasado (incluido
        cualquier backtest) no predice el futuro; fallas de software, del
        servidor o de la API de Binance que pueden impedir compras, ventas o
        stops; riesgos del exchange; y riesgo regulatorio.
      </p>

      <h2>7. Sin garantía de rendimientos ni de disponibilidad</h2>
      <p>
        El Servicio se presta «tal como está» y «según disponibilidad». El
        Titular no garantiza funcionamiento ininterrumpido ni libre de errores,
        ni que las órdenes se ejecuten en un tiempo o precio determinado, ni
        resultado económico alguno. Toda cifra, proyección o backtest es
        estimativa y no constituye promesa de rentabilidad.
      </p>

      <h2>8. Limitación de responsabilidad</h2>
      <p>
        8.1. En la máxima medida permitida por la ley argentina, el Titular no
        responde por pérdidas derivadas de operaciones ejecutadas por el robot
        conforme a la configuración del Usuario; decisiones de inversión del
        Usuario; fallas, demoras o errores de servicios de terceros (Binance,
        MercadoPago, Clerk, hosting, Telegram); interrupciones por
        mantenimiento o fuerza mayor; uso de las claves contrariando el punto
        4.2; ni accesos no autorizados atribuibles a la falta de cuidado del
        Usuario.
      </p>
      <p>
        8.2. Si una autoridad judicial determinara responsabilidad del Titular,
        esta quedará limitada —en la máxima medida permitida por la ley— al
        importe abonado por el Usuario en concepto de suscripción durante los 12
        meses anteriores al hecho.
      </p>
      <p>
        8.3. <strong>Nada en estos Términos limita ni excluye derechos
        irrenunciables del Usuario como consumidor conforme a la Ley 24.240, el
        Código Civil y Comercial y normas concordantes.</strong>
      </p>

      <h2>9. Obligaciones del Usuario</h2>
      <p>
        El Usuario se obliga a brindar información veraz; usar la Plataforma
        solo con cuentas de Binance de su titularidad; no usar el Servicio para
        actividades ilícitas (lavado, financiamiento del terrorismo, evasión);
        no vulnerar la seguridad ni hacer ingeniería inversa; y mantener la
        confidencialidad de sus credenciales.
      </p>

      <h2>10. Propiedad intelectual</h2>
      <p>
        El software, el código, el diseño, la marca «Botclo», los logos y demás
        contenidos son de titularidad exclusiva del Titular o se usan bajo
        licencia, protegidos por la Ley 11.723. El Usuario recibe una licencia
        de uso personal, limitada, no exclusiva, intransferible y revocable
        mientras dure su suscripción.
      </p>

      <h2>11. Suscripciones, pagos, renovación y cancelación</h2>
      <p>
        11.1. Botclo ofrece un plan gratuito de práctica y planes pagos
        (mensual o anual), publicados en la Plataforma, en pesos argentinos.
      </p>
      <p>11.2. Los pagos se procesan a través de MercadoPago.</p>
      <p>
        11.3. <strong>Renovación automática.</strong> Las suscripciones se
        renuevan automáticamente al precio vigente, salvo cancelación previa.
        Los cambios de precio se informan con al menos 30 días de anticipación.
      </p>
      <p>
        11.4. <strong>Cancelación.</strong> El Usuario puede cancelar en
        cualquier momento desde la Plataforma, sin trámites adicionales (art. 10
        ter, Ley 24.240). La cancelación surte efecto al final del período ya
        pagado.
      </p>
      <p>
        11.5. <strong>Derecho de arrepentimiento (art. 34, Ley 24.240; arts.
        1110-1116 CCyC).</strong> El Usuario puede revocar la contratación
        dentro de los <strong>10 días corridos</strong> desde la contratación,
        sin causa ni penalidad, con devolución total. Se ejerce con el botón de
        arrepentimiento del sitio o escribiendo a {LEGAL_HOLDER.emailSoporte}.
      </p>
      <p>
        11.6. <strong>Mora.</strong> La falta de pago suspende las funciones
        pagas. Por diseño de seguridad, el robot entra en «pausa suave»: no abre
        nuevas posiciones, pero <strong>mantiene activos los stops y ventas de
        protección</strong>, para no dejar al Usuario desprotegido.
      </p>

      <h2>12. Baja de la cuenta</h2>
      <p>
        El Usuario puede eliminar su cuenta en cualquier momento. La baja
        detiene todos los robots, elimina las claves de API almacenadas y
        suprime los datos personales conforme a la Política de Privacidad. No
        afecta los fondos del Usuario, que están en Binance.
      </p>

      <h2>13. Modificaciones</h2>
      <p>
        El Titular puede modificar estos Términos. Los cambios sustanciales se
        comunican con al menos 30 días de anticipación y requieren nueva
        aceptación cuando alteren elementos esenciales. Si el Usuario no acepta,
        puede darse de baja sin penalidad.
      </p>

      <h2>14. Ley aplicable y jurisdicción</h2>
      <p>
        Estos Términos se rigen por las leyes de la República Argentina
        (incluida la Ley 24.240). Toda controversia se somete a los tribunales
        ordinarios del domicilio real del Usuario consumidor. Antes de cualquier
        acción, el Usuario puede reclamar a {LEGAL_HOLDER.emailSoporte} o acudir
        a la Ventanilla Única Federal de Defensa del Consumidor (
        <a
          href="https://www.argentina.gob.ar/defensadelconsumidor"
          target="_blank"
          rel="noopener noreferrer"
        >
          argentina.gob.ar/defensadelconsumidor
        </a>
        ).
      </p>
    </>
  );
}
