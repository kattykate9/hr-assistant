export type MatchSummary = { percent: number; has_assessment: boolean; reviewed: number; total: number; preliminary: boolean; criteria_changed: boolean };
export function matchColors(value: MatchSummary) {
  if (!value.has_assessment) return { backgroundColor: "transparent", color: "#64748b", border: "1px dashed #cbd5e1" };
  const [backgroundColor, color] = value.percent < 30 ? ["#fcebec", "#991b1b"] : value.percent < 50 ? ["#fff0e3", "#9a3412"] : value.percent < 70 ? ["#fff8d9", "#854d0e"] : value.percent < 85 ? ["#e2f4f1", "#115e59"] : ["#e8f5ec", "#166534"];
  return { backgroundColor, color, border: "1px solid transparent" };
}
export default function MatchBadge({ value }: { value: MatchSummary }) {
  const explanation = !value.has_assessment ? "Оценка ещё не заполнена" : `Соответствие по ручной оценке: ${value.percent}%. Оценено ${value.reviewed} из ${value.total} критериев.${value.preliminary ? " Предварительный результат: есть неоценённые критерии или вопросы для уточнения." : ""}${value.criteria_changed ? " По прежним критериям вакансии." : ""}`;
  return <span title={explanation} aria-label={explanation} style={{ display: "inline-flex", alignItems: "center", gap: 5, ...matchColors(value), borderRadius: 999, padding: "4px 11px", fontSize: 12, fontWeight: 600, lineHeight: "20px", whiteSpace: "nowrap" }}>
    {value.has_assessment ? value.percent : 0}%{value.preliminary && <span style={{ fontSize: 10, fontWeight: 400 }}>предв.</span>}{value.criteria_changed && <span style={{ fontSize: 10, fontWeight: 400 }}>прежние критерии</span>}
  </span>;
}
