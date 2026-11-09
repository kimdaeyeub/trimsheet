import { Link } from 'react-router'
import { buttonClass } from '../components/ui/button-styles'
import { EmptyState } from '../components/ui/EmptyState'

export function NotFoundPage() {
  return (
    <EmptyState title="페이지를 찾을 수 없습니다">
      <Link to="/" className={buttonClass('secondary', 'sm', 'mt-3')}>
        처음으로
      </Link>
    </EmptyState>
  )
}
