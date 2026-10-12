import Papa from "papaparse"
import ExcelJS from "exceljs"

export type TabularRow = Record<string, string>

/** Normalises header names: "Primary Keyword" → "primary_keyword". */
export function normalizeHeader(h: string) {
  return h
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
}

export function parseCsv(text: string): TabularRow[] {
  const result = Papa.parse<Record<string, string>>(text.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: normalizeHeader,
    transform: (v) => (typeof v === "string" ? v.trim() : v),
  })
  return result.data.filter((r) => Object.values(r).some((v) => v))
}

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return ""
  if (v instanceof Date) return v.toISOString().slice(0, 10)
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue)
    if ("richText" in v) return v.richText.map((r) => r.text).join("")
    if ("hyperlink" in v) return String((v as { hyperlink: string }).hyperlink)
  }
  return String(v).trim()
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<TabularRow[]> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer)
  const ws = wb.worksheets[0]
  if (!ws) return []
  const headers: string[] = []
  ws.getRow(1).eachCell({ includeEmpty: true }, (cell, col) => (headers[col] = normalizeHeader(cellText(cell.value))))
  const rows: TabularRow[] = []
  for (let r = 2; r <= ws.rowCount; r++) {
    const row = ws.getRow(r)
    const out: TabularRow = {}
    headers.forEach((h, col) => {
      if (h) out[h] = cellText(row.getCell(col).value).trim()
    })
    if (Object.values(out).some(Boolean)) rows.push(out)
  }
  return rows
}

export async function parseUpload(file: File): Promise<TabularRow[]> {
  const name = file.name.toLowerCase()
  if (name.endsWith(".csv")) return parseCsv(await file.text())
  if (name.endsWith(".xlsx")) return parseXlsx(await file.arrayBuffer())
  throw new Error("Upload a .csv or .xlsx file")
}

export function splitList(v: string | undefined) {
  return (v ?? "")
    .split(/[;|\n]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

/** Accepts YYYY-MM-DD, DD/MM/YYYY or an Excel ISO date; returns YYYY-MM-DD or "" */
export function parseDateCell(v: string | undefined): string {
  const s = (v ?? "").trim()
  if (!s) return ""
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10)
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`
  return "invalid"
}
