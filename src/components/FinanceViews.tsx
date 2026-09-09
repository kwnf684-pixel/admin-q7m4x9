import {AnimatedModal,FinancialValue} from './premium/MotionUI';
import type { ReactNode } from "react";
import "../pages/transferList.css";
export const FinanceModal=AnimatedModal;
export function FinanceRows({
  headers,
  rows,
}: {
  headers: string[];
  rows: { id: string; cells: ReactNode[] }[];
}) {
  return rows.length ? (
    <>
      <div
        className="tl-table-scroll"
        tabIndex={0}
        role="region"
        aria-label="جدول البيانات"
      >
        <table>
          <thead>
            <tr>
              {headers.map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                {r.cells.map((cell, i) => (
                  <td key={headers[i]}><FinancialValue value={cell}/></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tl-mobile-cards">
        {rows.map((r) => (
          <article className="tl-mobile-card" key={r.id}>
            <dl>
              {r.cells.map((cell, i) => (
                <div key={headers[i]}>
                  <dt>{headers[i]}</dt>
                  <dd><FinancialValue value={cell}/></dd>
                </div>
              ))}
            </dl>
          </article>
        ))}
      </div>
    </>
  ) : (
    <div className="tl-empty">
      <h2>لا توجد نتائج مطابقة</h2>
      <p>جرّب تغيير الفلاتر.</p>
    </div>
  );
}
export function FinanceDetails({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="tl-details">
      {items.map(([label, value]) => (
        <div key={label}>
          <dt>{label}</dt>
          <dd><FinancialValue value={value}/></dd>
        </div>
      ))}
    </dl>
  );
}
