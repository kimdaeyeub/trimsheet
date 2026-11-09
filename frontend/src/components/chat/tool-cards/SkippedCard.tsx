import { Link } from 'react-router'
import { Button } from '../../ui/Button'
import { buttonClass } from '../../ui/button-styles'
import { type ToolPart, ToolShell } from './shared'
import { str } from './util'

export function SkippedCard({ part, output, onForce }: { part: ToolPart; output: Record<string, unknown>; onForce?: () => void }) {
  const failed = output.failed === true
  const existing = str(output.existingJobUrl)
  return (
    <ToolShell part={part} tone={failed ? 'danger' : 'warning'} title={failed ? '처리하지 못했습니다' : '처리하지 않고 건너뛰었습니다'}>
      <p>{str(output.reason)}</p>
      {!failed && (
        <div className="mt-3 flex flex-wrap gap-2">
          {existing && (
            <Link to={existing} className={buttonClass('secondary', 'sm')}>
              기존 결과 보기
            </Link>
          )}
          {onForce && output.rule !== 'R1' && output.rule !== 'R5' && output.rule !== 'F1' && (
            <Button size="sm" variant="ghost" onClick={onForce}>
              그래도 정리하기
            </Button>
          )}
        </div>
      )}
    </ToolShell>
  )
}
