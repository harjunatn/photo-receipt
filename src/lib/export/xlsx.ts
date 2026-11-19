import { zip } from './zip';

/** How a column's values are shown in Excel. */
export type ColumnFormat = 'text' | 'integer' | 'rupiah' | 'datetime';

export interface SheetColumn {
  header: string;
  /** Width in characters. */
  width: number;
  format?: ColumnFormat;
  /** Adds the column up in a total row under the data. */
  sum?: boolean;
}

export type SheetCell = string | number | Date | null | undefined;

// Style numbers, in the order of cellXfs in styles.xml below.
const STYLE = { text: 0, header: 1, datetime: 2, rupiah: 3, integer: 4, totalLabel: 5, totalRupiah: 6, totalInteger: 7 } as const;

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
}

/** A1-style column letters: 0 → A, 25 → Z, 26 → AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

/** Excel's day number for a moment, as the clock on this device showed it. */
export function excelDate(when: Date): number {
  const local = Date.UTC(when.getFullYear(), when.getMonth(), when.getDate(), when.getHours(), when.getMinutes(), when.getSeconds());
  return local / 86_400_000 + 25_569;
}

function cellXml(ref: string, value: SheetCell, format: ColumnFormat): string {
  if (value === null || value === undefined || value === '') return '';
  if (value instanceof Date) return `<c r="${ref}" s="${STYLE.datetime}"><v>${excelDate(value)}</v></c>`;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const style = format === 'rupiah' ? STYLE.rupiah : format === 'integer' ? STYLE.integer : STYLE.text;
    return `<c r="${ref}" s="${style}"><v>${value}</v></c>`;
  }
  return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

/** Builds a one-sheet Excel workbook (.xlsx) with a bold, frozen header row and a filter on it. */
export function buildXlsx(sheetName: string, columns: SheetColumn[], rows: SheetCell[][]): Uint8Array<ArrayBuffer> {
  const last = columnName(columns.length - 1);
  const lines: string[] = [];
  lines.push(
    `<row r="1">${columns.map((column, c) => `<c r="${columnName(c)}1" t="inlineStr" s="${STYLE.header}"><is><t>${escapeXml(column.header)}</t></is></c>`).join('')}</row>`,
  );
  rows.forEach((row, r) => {
    const n = r + 2;
    lines.push(`<row r="${n}">${columns.map((column, c) => cellXml(`${columnName(c)}${n}`, row[c], column.format ?? 'text')).join('')}</row>`);
  });
  const lastData = rows.length + 1;
  if (columns.some((column) => column.sum) && rows.length > 0) {
    const n = rows.length + 2;
    const cells = columns.map((column, c) => {
      const ref = `${columnName(c)}${n}`;
      if (c === 0) return `<c r="${ref}" t="inlineStr" s="${STYLE.totalLabel}"><is><t>Total</t></is></c>`;
      if (!column.sum) return '';
      const style = column.format === 'rupiah' ? STYLE.totalRupiah : STYLE.totalInteger;
      return `<c r="${ref}" s="${style}"><f>SUM(${columnName(c)}2:${columnName(c)}${lastData})</f></c>`;
    });
    lines.push(`<row r="${n}">${cells.join('')}</row>`);
  }

  const sheet =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    `<cols>${columns.map((column, c) => `<col min="${c + 1}" max="${c + 1}" width="${column.width}" customWidth="1"/>`).join('')}</cols>` +
    `<sheetData>${lines.join('')}</sheetData>` +
    (rows.length > 0 ? `<autoFilter ref="A1:${last}${lastData}"/>` : '') +
    '</worksheet>';

  const styles =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<numFmts count="2"><numFmt numFmtId="164" formatCode="dd/mm/yyyy hh:mm"/><numFmt numFmtId="165" formatCode="&quot;Rp&quot;#,##0"/></numFmts>' +
    '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
    '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>' +
    '<fill><patternFill patternType="solid"><fgColor rgb="FFEDEAE3"/><bgColor indexed="64"/></patternFill></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="8">' +
    '<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>' +
    '<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="165" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
    '<xf numFmtId="3" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyNumberFormat="1"/>' +
    '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>';

  const workbook =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
    `<sheets><sheet name="${escapeXml(sheetName.slice(0, 31))}" sheetId="1" r:id="rId1"/></sheets>` +
    (rows.length > 0 ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">'${escapeXml(sheetName.slice(0, 31))}'!$A$1:$${last}$${lastData}</definedName></definedNames>` : '') +
    '<calcPr calcId="191029" fullCalcOnLoad="1"/>' +
    '</workbook>';

  const encoder = new TextEncoder();
  return zip([
    {
      name: '[Content_Types].xml',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
          '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
          '<Default Extension="xml" ContentType="application/xml"/>' +
          '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
          '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
          '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
          '</Types>',
      ),
    },
    {
      name: '_rels/.rels',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
          '</Relationships>',
      ),
    },
    { name: 'xl/workbook.xml', data: encoder.encode(workbook) },
    {
      name: 'xl/_rels/workbook.xml.rels',
      data: encoder.encode(
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
          '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
          '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
          '</Relationships>',
      ),
    },
    { name: 'xl/worksheets/sheet1.xml', data: encoder.encode(sheet) },
    { name: 'xl/styles.xml', data: encoder.encode(styles) },
  ]);
}
