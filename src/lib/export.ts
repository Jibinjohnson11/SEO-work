import "server-only"
import ExcelJS from "exceljs"
import Papa from "papaparse"
import { jsPDF } from "jspdf"
import { autoTable } from "jspdf-autotable"

export interface ExportSheet {
  name: string
  columns: { key: string; header: string; numeric?: boolean }[]
  rows: Record<string, string | number | null>[]
  footer?: Record<string, string | number | null>
}

export interface ExportDoc {
  title: string
  subtitle?: string
  sheets: ExportSheet[]
}

/** Neutralises spreadsheet formula injection in user-provided text. */
function safeCell(v: string | number | null | undefined) {
  if (typeof v === "string" && /^[=+\-@\t\r]/.test(v)) return `'${v}`
  return v ?? ""
}

export async function toXlsx(doc: ExportDoc): Promise<Buffer> {
  const wb = new ExcelJS.Workbook()
  wb.creator = "LinkOps"
  wb.created = new Date()
  for (const sheet of doc.sheets) {
    const ws = wb.addWorksheet(sheet.name.slice(0, 31))
    ws.addRow([doc.title]).font = { bold: true, size: 13 }
    if (doc.subtitle) ws.addRow([doc.subtitle]).font = { color: { argb: "FF64748B" } }
    ws.addRow([])
    const header = ws.addRow(sheet.columns.map((c) => c.header))
    header.font = { bold: true }
    header.eachCell((cell) => {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } }
      cell.border = { bottom: { style: "thin", color: { argb: "FFE2E8F0" } } }
    })
    for (const r of sheet.rows) ws.addRow(sheet.columns.map((c) => safeCell(r[c.key])))
    if (sheet.footer) ws.addRow(sheet.columns.map((c) => safeCell(sheet.footer![c.key]))).font = { bold: true }
    sheet.columns.forEach((c, i) => {
      const col = ws.getColumn(i + 1)
      col.width = Math.min(48, Math.max(c.header.length + 2, ...sheet.rows.slice(0, 200).map((r) => String(r[c.key] ?? "").length + 2)))
      if (c.numeric) col.alignment = { horizontal: "right" }
    })
    ws.views = [{ state: "frozen", ySplit: header.number }]
  }
  return Buffer.from(await wb.xlsx.writeBuffer())
}

export function toCsv(doc: ExportDoc): string {
  return doc.sheets
    .map((sheet) => {
      const data = sheet.rows.map((r) => sheet.columns.map((c) => safeCell(r[c.key])))
      if (sheet.footer) data.push(sheet.columns.map((c) => safeCell(sheet.footer![c.key])))
      const body = Papa.unparse({ fields: sheet.columns.map((c) => c.header), data })
      return doc.sheets.length > 1 ? `# ${sheet.name}\n${body}` : body
    })
    .join("\n\n")
}

export function toPdf(doc: ExportDoc): Buffer {
  const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" })
  pdf.setFontSize(14)
  pdf.text(doc.title, 40, 40)
  let y = 58
  if (doc.subtitle) {
    pdf.setFontSize(9)
    pdf.setTextColor(100, 116, 139)
    pdf.text(doc.subtitle, 40, y)
    pdf.setTextColor(15, 23, 42)
    y += 14
  }
  for (const sheet of doc.sheets) {
    pdf.setFontSize(11)
    pdf.text(sheet.name, 40, y + 10)
    autoTable(pdf, {
      startY: y + 18,
      head: [sheet.columns.map((c) => c.header)],
      body: sheet.rows.map((r) => sheet.columns.map((c) => String(r[c.key] ?? ""))),
      foot: sheet.footer ? [sheet.columns.map((c) => String(sheet.footer![c.key] ?? ""))] : undefined,
      styles: { fontSize: 8, cellPadding: 4 },
      headStyles: { fillColor: [37, 99, 235] },
      footStyles: { fillColor: [241, 245, 249], textColor: [15, 23, 42] },
      columnStyles: Object.fromEntries(sheet.columns.map((c, i) => [i, { halign: c.numeric ? "right" : "left" }])),
      margin: { left: 40, right: 40 },
    })
    y = (pdf as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 24
    if (y > 500) {
      pdf.addPage()
      y = 40
    }
  }
  const pages = pdf.getNumberOfPages()
  for (let i = 1; i <= pages; i++) {
    pdf.setPage(i)
    pdf.setFontSize(8)
    pdf.setTextColor(100, 116, 139)
    pdf.text(`LinkOps · generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC · page ${i}/${pages}`, 40, pdf.internal.pageSize.getHeight() - 20)
  }
  return Buffer.from(pdf.output("arraybuffer"))
}

export const EXPORT_TYPES = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
} as const
export type ExportFormat = keyof typeof EXPORT_TYPES

export async function renderExport(doc: ExportDoc, format: ExportFormat): Promise<Buffer> {
  if (format === "xlsx") return toXlsx(doc)
  if (format === "pdf") return toPdf(doc)
  return Buffer.from("﻿" + toCsv(doc), "utf8")
}
