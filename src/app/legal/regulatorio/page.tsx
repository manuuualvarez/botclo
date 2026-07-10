export const metadata = { title: "Aviso Regulatorio" };

export default function RegulatorioPage() {
  return (
    <>
      <h1>Aviso sobre Marco Regulatorio</h1>
      <p>
        Botclo es un software operado por una persona humana.{" "}
        <strong>Botclo no está inscripto como Proveedor de Servicios de Activos
        Virtuales (PSAV) en el registro de la Comisión Nacional de Valores</strong>
        , por cuanto entiende que su actividad —proveer software no custodial que
        ejecuta, en la cuenta de Binance del propio usuario, órdenes derivadas de
        estrategias que el usuario configura y activa— no constituye ninguna de
        las actividades registrables previstas en el art. 4 bis de la Ley 25.246
        (texto según Ley 27.739).
      </p>
      <p>
        Botclo no intercambia activos virtuales por moneda ni entre sí por cuenta
        propia o de terceros, no transfiere activos virtuales, no custodia ni
        administra activos virtuales ni fondos de usuarios, y no participa en la
        oferta o venta de activos virtuales. Los fondos permanecen siempre en la
        cuenta del usuario en Binance, que es quien presta el servicio de
        exchange y custodia bajo su propio encuadre regulatorio.
      </p>
      <p>
        Esta interpretación puede ser revisada por las autoridades. Si un cambio
        normativo o un criterio de la CNV exigiera el registro u otra adecuación,
        Botclo lo informará y adecuará o discontinuará el servicio según
        corresponda. Botclo tampoco brinda asesoramiento financiero ni actúa como
        agente de ninguna categoría regulada por la Ley 26.831.
      </p>
    </>
  );
}
