import type { PreviewRecommendation, Recommendation } from '@pochamp/engine';

export function RecommendationCard({ recommendation }: { recommendation: PreviewRecommendation | Recommendation }) {
  return (
    <article className="recommendation-card">
      <div className="recommendation-top">
        <div><span className="eyebrow">1순위 추천</span><h3>{recommendation.primaryAction.label}</h3></div>
        <div className="win-rate"><strong>{recommendation.simulatedWinRate}%</strong><span>시뮬레이션 예상</span></div>
      </div>
      <div className="confidence"><span className={`dot ${recommendation.confidence}`} />신뢰도 {recommendation.confidence} · {recommendation.latencyMs}ms</div>
      <div className="reason-list">{recommendation.primaryAction.reasons.map((reason) => <span key={reason}>{reason}</span>)}</div>
      {recommendation.alternatives.length > 0 && <div className="alternatives">
        {recommendation.alternatives.map((action, index) => <div key={action.id}><b>{index + 2}순위</b><span>{action.label}</span><em>{action.simulatedWinRate}%</em></div>)}
      </div>}
      <details><summary>가정과 위험</summary>{recommendation.assumptions.map((item) => <p key={item}>• {item}</p>)}{recommendation.primaryAction.risks.map((item) => <p key={item}>• {item}</p>)}</details>
    </article>
  );
}
