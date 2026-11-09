import { Fragment, type ReactNode } from 'react'
import { Link } from 'react-router'

// A deliberately small renderer for agent replies: paragraphs, "- " lists, **bold**,
// [text](url) and bare app paths like /jobs/job_… . No HTML is ever injected.
const INLINE = /\*\*([^*]+)\*\*|\[([^\]]+)\]\(([^)\s]+)\)|(\/jobs\/job_[A-Za-z0-9-]+)|(https?:\/\/[^\s)]+)/g

function link(href: string, text: string, key: number) {
  if (href.startsWith('/')) {
    return (
      <Link key={key} to={href} className="font-medium text-primary-600 underline underline-offset-2 hover:text-primary-700">
        {text}
      </Link>
    )
  }
  return (
    <a key={key} href={href} target="_blank" rel="noreferrer" className="font-medium text-primary-600 underline underline-offset-2">
      {text}
    </a>
  )
}

function inline(text: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let i = 0
  for (const m of text.matchAll(INLINE)) {
    if (m.index > last) out.push(text.slice(last, m.index))
    if (m[1]) out.push(<strong key={i++}>{m[1]}</strong>)
    else if (m[2] && m[3]) out.push(link(m[3], m[2], i++))
    else if (m[4]) out.push(link(m[4], '검토 화면 열기', i++))
    else if (m[5]) out.push(link(m[5], m[5], i++))
    last = m.index + m[0].length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

export function Markdown({ text }: { text: string }) {
  const blocks = text.trim().split(/\n{2,}/)
  return (
    <div className="space-y-2 leading-relaxed">
      {blocks.map((block, b) => {
        const lines = block.split('\n')
        if (lines.every((l) => /^\s*[-*•]\s+/.test(l))) {
          return (
            <ul key={b} className="list-disc space-y-0.5 pl-5">
              {lines.map((l, j) => (
                <li key={j}>{inline(l.replace(/^\s*[-*•]\s+/, ''))}</li>
              ))}
            </ul>
          )
        }
        return (
          <p key={b}>
            {lines.map((l, j) => (
              <Fragment key={j}>
                {j > 0 && <br />}
                {inline(l.replace(/^#+\s*/, ''))}
              </Fragment>
            ))}
          </p>
        )
      })}
    </div>
  )
}
