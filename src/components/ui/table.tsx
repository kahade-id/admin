/**
 * Kahade Admin — primitif tabel + <DataTable> (§9.18).
 *
 * <Table>/<THead>/<TBody>/<TR>/<TH>/<TD>: elemen <table> HTML sungguhan.
 * Aturan visual:
 *   - Header: text-caption text-text-secondary, uppercase, di atas bg-surface
 *     dengan border-b.
 *   - Baris: border-b border-border; hover bg-surface-elevated.
 *   - Dibungkus rounded-md border seperti Card; overflow-hidden supaya
 *     background header tidak menutup sudut.
 *
 * <DataTable>: tabel sederhana dari `columns: {key, header, render?}` +
 * `rows`; state `loading` (spinner) dan `emptyText` ("Tidak ada data").
 */
"use client"

import type { ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react"
import { cn } from "@/lib/cn"
import { Spinner } from "./spinner"

// ------------------------------------------------------------------
// Primitif
// ------------------------------------------------------------------

export type TableProps = TableHTMLAttributes<HTMLTableElement> & {
  children?: ReactNode
  className?: string
  /**
   * G517/G518: label unik untuk landmark region (diambil dari caption bila
   * ada). Tanpa label unik, banyak tabel di satu halaman melanggar
   * axe landmark-unique — jadi role="region" hanya dipasang bila label ada.
   */
  regionLabel?: string
}

export function Table({ children, className, regionLabel, ...rest }: TableProps) {
  // G517 (reflow): overflow-x-auto — di viewport sempit / zoom 400% tabel
  // lebar bisa di-scroll horizontal, bukan terpotong. tabindex=0 agar region
  // scroll bisa dicapai & dioperasikan keyboard.
  return (
    <div
      role={regionLabel ? "region" : undefined}
      aria-label={regionLabel}
      tabIndex={0}
      className={cn(
        "w-full overflow-x-auto rounded-md border border-border bg-background",
        className,
      )}
    >
      <table className="w-full border-collapse" {...rest}>
        {children}
      </table>
    </div>
  )
}

export function THead({
  children,
  className,
  ...rest
}: TableHTMLAttributes<HTMLTableSectionElement> & { children?: ReactNode; className?: string }) {
  return (
    <thead className={cn("bg-surface", className)} {...rest}>
      {children}
    </thead>
  )
}

export function TBody({
  children,
  className,
  ...rest
}: TableHTMLAttributes<HTMLTableSectionElement> & { children?: ReactNode; className?: string }) {
  // Baris terakhir tidak perlu border-b — via :last-child agar TR tetap generik.
  return (
    <tbody className={cn("[&_tr:last-child]:border-b-0", className)} {...rest}>
      {children}
    </tbody>
  )
}

export function TR({
  children,
  className,
  ...rest
}: TableHTMLAttributes<HTMLTableRowElement> & { children?: ReactNode; className?: string }) {
  return (
    <tr className={cn("border-b border-border", className)} {...rest}>
      {children}
    </tr>
  )
}

export type THProps = ThHTMLAttributes<HTMLTableCellElement> & {
  children?: ReactNode
  className?: string
}

export function TH({ children, className, ...rest }: THProps) {
  return (
    <th
      className={cn(
        "px-4 py-3 text-left text-caption font-semibold uppercase text-text-secondary",
        className,
      )}
      {...rest}
    >
      {children}
    </th>
  )
}

export type TDProps = TdHTMLAttributes<HTMLTableCellElement> & {
  children?: ReactNode
  className?: string
}

export function TD({ children, className, ...rest }: TDProps) {
  return (
    <td className={cn("px-4 py-3 text-body text-text-primary", className)} {...rest}>
      {children}
    </td>
  )
}

// ------------------------------------------------------------------
// DataTable
// ------------------------------------------------------------------

export type DataTableAlign = "left" | "center" | "right"

export type DataTableColumn<Row extends Record<string, unknown>> = {
  key: string
  header: string
  /** Render kustom sel; default String(row[key]) */
  render?: (row: Row) => ReactNode
  align?: DataTableAlign
}

export type DataTableProps<Row extends Record<string, unknown>> = {
  columns: DataTableColumn<Row>[]
  rows: Row[]
  /** Kunci unik baris; default index */
  rowKey?: (row: Row, index: number) => string
  loading?: boolean
  emptyText?: string
  className?: string
  /** G518: caption untuk screen reader (WCAG 1.3.1) — tidak wajib tampil visual. */
  caption?: string
  /** Kelas tambahan per baris (mis. sorotan baris aktif keyboard). */
  rowClassName?: (row: Row, index: number) => string | undefined
}

const alignTextClass: Record<DataTableAlign, string> = {
  left: "text-left",
  center: "text-center",
  right: "text-right",
}

export function DataTable<Row extends Record<string, unknown>>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyText = "Tidak ada data",
  className,
  caption,
  rowClassName,
}: DataTableProps<Row>) {
  const cellContent = (col: DataTableColumn<Row>, row: Row): ReactNode =>
    col.render ? col.render(row) : String(row[col.key] ?? "")

  return (
    <Table className={className} regionLabel={caption}>
      {caption ? <caption className="sr-only">{caption}</caption> : null}
      <THead>
        <TR>
          {columns.map((col) => (
            // G513/axe empty-table-header: kolom tanpa header visual (kolom
            // aksi/checkbox) tetap butuh label untuk screen reader.
            <TH key={col.key} className={alignTextClass[col.align ?? "left"]}>
              {col.header ? col.header : <span className="sr-only">Aksi</span>}
            </TH>
          ))}
        </TR>
      </THead>
      <TBody>
        {loading ? (
          <TR>
            <TD colSpan={columns.length} className="py-8">
              <span className="flex items-center justify-center gap-2 text-text-secondary">
                <Spinner size="sm" />
                <span className="text-body">Memuat…</span>
              </span>
            </TD>
          </TR>
        ) : rows.length === 0 ? (
          <TR>
            <TD colSpan={columns.length} className="py-8 text-center text-body text-text-secondary">
              {emptyText}
            </TD>
          </TR>
        ) : (
          rows.map((row, i) => (
            <TR
              key={rowKey ? rowKey(row, i) : String(i)}
              className={cn("hover:bg-surface-elevated", rowClassName?.(row, i))}
            >
              {columns.map((col) => (
                <TD key={col.key} className={alignTextClass[col.align ?? "left"]}>
                  {cellContent(col, row)}
                </TD>
              ))}
            </TR>
          ))
        )}
      </TBody>
    </Table>
  )
}
