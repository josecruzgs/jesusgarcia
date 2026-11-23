import { NextResponse } from "next/server";

/**
 * LA PLANTILLA PARA SUBIR LA BASE, COMO EXCEL DE VERDAD (.xlsx).
 *
 * Un CSV no sirve de plantilla: Excel decide el separador según la configuración regional de cada computadora, y con la
 * equivocada abre todo en una sola columna. Un .xlsx abre igual en todas. La columna del teléfono va con formato de
 * texto para que Excel no lo vuelva número (ni notación científica), y las demás también, para que un ID o un distrito no pierdan los ceros.
 *
 * Solo encabezados, sin renglones de ejemplo: un ejemplo que se queda en el archivo acaba en la base y la asistente le
 * marca. Los nombres de columna son los que reconoce cargarFilas (lib/encuestas/base.ts).
 *
 * El .xlsx se arma aquí, sin librerías: es un zip (sin comprimir) con seis XML.
 */
// Todas van con formato de texto: así Excel no le quita los ceros a la izquierda a un ID, un distrito («05») o una sección («0123»), ni vuelve número el teléfono.
const COLUMNAS = [
  { titulo: "ID", ancho: 14, texto: true },
  { titulo: "Teléfono", ancho: 16, texto: true },
  { titulo: "Municipio", ancho: 24, texto: true },
  { titulo: "Distrito", ancho: 14, texto: true },
  { titulo: "Sección electoral", ancho: 18, texto: true },
  // Cualquier dato que el cliente necesite y no tenga columna propia.
  { titulo: "Otro", ancho: 30, texto: true },
];
const LETRA = "ABCDEFGHIJ";

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const ARCHIVOS: Record<string, string> = {
  "[Content_Types].xml": XML +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    "</Types>",
  "_rels/.rels": XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    "</Relationships>",
  "xl/workbook.xml": XML +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    '<sheets><sheet name="Base" sheetId="1" r:id="rId1"/></sheets></workbook>',
  "xl/_rels/workbook.xml.rels": XML +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    "</Relationships>",
  // Estilos: 0 normal, 1 encabezado en negritas con fondo, 2 texto (numFmt 49 = «@»).
  "xl/styles.xml": XML +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFFCE4B6"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    "</cellXfs></styleSheet>",
  "xl/worksheets/sheet1.xml": XML +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    // El encabezado se queda fijo al bajar.
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    "<cols>" + COLUMNAS.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho}" customWidth="1"${c.texto ? ' style="2"' : ""}/>`).join("") + "</cols>" +
    '<sheetData><row r="1">' +
    COLUMNAS.map((c, i) => `<c r="${LETRA[i]}1" t="inlineStr" s="1"><is><t>${c.titulo}</t></is></c>`).join("") +
    "</row></sheetData></worksheet>",
};

const TABLA_CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer) {
  let c = 0xffffffff;
  for (const x of b) c = TABLA_CRC[(c ^ x) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Un zip sin comprimir (método 0): es lo mínimo que Excel acepta y no necesita nada fuera de Node. */
function zip(archivos: Record<string, string>) {
  const locales: Buffer[] = [], centrales: Buffer[] = [];
  let desplazamiento = 0;
  for (const [nombre, texto] of Object.entries(archivos)) {
    const datos = Buffer.from(texto, "utf8"), n = Buffer.from(nombre, "utf8"), crc = crc32(datos);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);
    local.writeUInt32LE(crc, 14); local.writeUInt32LE(datos.length, 18); local.writeUInt32LE(datos.length, 22); local.writeUInt16LE(n.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0x0800, 8);
    central.writeUInt32LE(crc, 16); central.writeUInt32LE(datos.length, 20); central.writeUInt32LE(datos.length, 24); central.writeUInt16LE(n.length, 28);
    central.writeUInt32LE(desplazamiento, 42);
    locales.push(local, n, datos);
    centrales.push(central, n);
    desplazamiento += 30 + n.length + datos.length;
  }
  const dir = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0);
  fin.writeUInt16LE(Object.keys(archivos).length, 8); fin.writeUInt16LE(Object.keys(archivos).length, 10);
  fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(desplazamiento, 16);
  return Buffer.concat([...locales, dir, fin]);
}

export function GET() {
  return new NextResponse(new Uint8Array(zip(ARCHIVOS)), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-base-encuestas.xlsx"',
      "Cache-Control": "no-store",
    },
  });
}
